from __future__ import annotations

import json
import time
from collections import defaultdict
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai_utils import (
    ANALYZE_SYSTEM,
    CHANGE_IMPACT_SYSTEM,
    COVERAGE_REVIEW_SYSTEM,
    GENERATION_SYSTEM,
    IMPROVE_REQUIREMENTS_SYSTEM,
    REFINEMENT_SYSTEM,
    chat_completion,
    clean_gherkin_output,
    input_type_guidance,
    normalize_input_type,
    parse_json_response,
    validate_requirements,
)

app = FastAPI(title="TestGPT API")

app.add_middleware(
    CORSMiddleware,
    # Vite may use 5173, 5174, etc. when the default port is busy
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory rate limit (nice-to-have for dev)
_RATE_WINDOW_SEC = 60
_RATE_MAX_REQUESTS = 30
_MIN_GHERKIN_LEN = 10
_rate_buckets: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(client_id: str) -> None:
    now = time.time()
    bucket = _rate_buckets[client_id]
    _rate_buckets[client_id] = [t for t in bucket if now - t < _RATE_WINDOW_SEC]
    if len(_rate_buckets[client_id]) >= _RATE_MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again shortly.")
    _rate_buckets[client_id].append(now)


def _client_id(request: Request) -> str:
    return request.client.host if request.client else "default"


class RequirementsInput(BaseModel):
    requirements: str
    inputType: str = "requirements"


class CoverageReviewInput(BaseModel):
    requirements: str
    gherkin: str
    inputType: str = "requirements"


class RefinementInput(BaseModel):
    messages: list[dict[str, Any]]


class ChangeImpactInput(BaseModel):
    oldRequirements: str = Field(..., min_length=1)
    newRequirements: str = Field(..., min_length=1)


class ImproveRequirementsInput(BaseModel):
    requirements: str
    warnings: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/")
def read_root():
    return {"status": "TestGPT backend running", "version": "1.1.0"}


def _normalize_analysis(parsed: dict) -> dict:
    warnings = parsed.get("warnings") or []
    for i, w in enumerate(warnings):
        if not w.get("id"):
            w["id"] = f"W{i + 1}"

    behaviors = parsed.get("behaviors") or []
    for i, b in enumerate(behaviors):
        if not b.get("id"):
            b["id"] = f"B{i + 1}"

    business_rules = parsed.get("businessRules") or []
    for i, r in enumerate(business_rules):
        if not r.get("id"):
            r["id"] = f"BR{i + 1}"

    assumptions = parsed.get("assumptions") or []
    for i, a in enumerate(assumptions):
        if not a.get("id"):
            a["id"] = f"A{i + 1}"

    return {
        "qualityScore": int(parsed.get("qualityScore", 0)),
        "summary": parsed.get("summary", ""),
        "behaviors": behaviors,
        "businessRules": business_rules,
        "assumptions": assumptions,
        "warnings": warnings,
    }


def _generation_user_message(text: str, input_type: str) -> str:
    guidance = input_type_guidance(input_type)
    label = normalize_input_type(input_type).replace("_", " ")
    return (
        f"Input type: {label}\n"
        f"Guidance: {guidance}\n\n"
        f"Generate Gherkin acceptance tests for this input:\n\n{text}"
    )


@app.post("/analyze")
def analyze_requirements(data: RequirementsInput, request: Request):
    _check_rate_limit(_client_id(request))
    try:
        text = validate_requirements(data.requirements)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    input_type = normalize_input_type(data.inputType)
    guidance = input_type_guidance(input_type)

    try:
        response = chat_completion(
            [
                {"role": "system", "content": ANALYZE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Input type: {input_type.replace('_', ' ')}\n"
                        f"Guidance: {guidance}\n\n"
                        f"Analyze this input:\n\n{text}"
                    ),
                },
            ]
        )
        raw = response.choices[0].message.content or "{}"
        parsed = parse_json_response(raw)
        return _normalize_analysis(parsed)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI returned invalid analysis JSON") from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {exc}") from exc


@app.post("/improve-requirements")
def improve_requirements(data: ImproveRequirementsInput, request: Request):
    _check_rate_limit(_client_id(request))
    try:
        text = validate_requirements(data.requirements)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not data.warnings:
        raise HTTPException(
            status_code=400,
            detail="No quality warnings provided. Run Analyze Quality first.",
        )

    warnings_text = "\n".join(
        f"- [{w.get('id', '?')}] ({w.get('type', 'issue')}, {w.get('severity', 'medium')}): "
        f"{w.get('message', '')}"
        + (f" Suggestion: {w.get('suggestion')}" if w.get("suggestion") else "")
        + (f" Ref: {w.get('requirementRef')}" if w.get("requirementRef") else "")
        for w in data.warnings
    )

    try:
        response = chat_completion(
            [
                {"role": "system", "content": IMPROVE_REQUIREMENTS_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"CURRENT REQUIREMENTS:\n{text}\n\n"
                        f"QUALITY WARNINGS TO FIX:\n{warnings_text}\n\n"
                        "Return the improved requirements text only."
                    ),
                },
            ]
        )
        improved = (response.choices[0].message.content or "").strip()
        if improved.startswith("```"):
            improved = clean_gherkin_output(improved)
        improved = validate_requirements(improved)
        return {"requirements": improved}
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Improve requirements failed: {exc}") from exc


@app.post("/change-impact")
def change_impact(data: ChangeImpactInput, request: Request):
    _check_rate_limit(_client_id(request))
    try:
        old_t = validate_requirements(data.oldRequirements)
        new_t = validate_requirements(data.newRequirements)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        response = chat_completion(
            [
                {"role": "system", "content": CHANGE_IMPACT_SYSTEM},
                {
                    "role": "user",
                    "content": f"OLD REQUIREMENTS:\n{old_t}\n\nNEW REQUIREMENTS:\n{new_t}",
                },
            ]
        )
        raw = response.choices[0].message.content or "{}"
        return parse_json_response(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI returned invalid change-impact JSON") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Change-impact analysis failed: {exc}") from exc


@app.post("/coverage-review")
def coverage_review(data: CoverageReviewInput, request: Request):
    _check_rate_limit(_client_id(request))
    try:
        req_text = validate_requirements(data.requirements)
        gherkin = (data.gherkin or "").strip()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if len(gherkin) < _MIN_GHERKIN_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Gherkin output must be at least {_MIN_GHERKIN_LEN} characters",
        )

    input_type = normalize_input_type(data.inputType)
    guidance = input_type_guidance(input_type)

    try:
        response = chat_completion(
            [
                {"role": "system", "content": COVERAGE_REVIEW_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Input type: {input_type.replace('_', ' ')}\n"
                        f"Guidance: {guidance}\n\n"
                        f"REQUIREMENTS:\n{req_text}\n\n"
                        f"GENERATED GHERKIN:\n{gherkin}"
                    ),
                },
            ]
        )
        raw = response.choices[0].message.content or "{}"
        parsed = parse_json_response(raw)
        reviews = parsed.get("reviews") or []
        for i, review in enumerate(reviews):
            if not review.get("requirementRef"):
                review["requirementRef"] = f"REQ-{i + 1}"
            review.setdefault("status", "partial")
            review.setdefault("rationale", "")
            review.setdefault("missingFlows", [])
            review.setdefault("scenarioRefs", [])
        return {
            "summary": parsed.get("summary", ""),
            "reviews": reviews,
        }
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI returned invalid coverage-review JSON") from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Coverage review failed: {exc}") from exc


@app.post("/generate")
def generate_tests(data: RequirementsInput, request: Request):
    _check_rate_limit(_client_id(request))
    try:
        text = validate_requirements(data.requirements)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        response = chat_completion(
            [
                {"role": "system", "content": GENERATION_SYSTEM},
                {
                    "role": "user",
                    "content": _generation_user_message(text, data.inputType),
                },
            ]
        )
        result = clean_gherkin_output(response.choices[0].message.content)
        return {"result": result}
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Generation failed: {exc}") from exc


@app.post("/generate/stream")
def generate_tests_stream(data: RequirementsInput, request: Request):
    _check_rate_limit(_client_id(request))
    try:
        text = validate_requirements(data.requirements)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def event_stream():
        try:
            stream = chat_completion(
                [
                    {"role": "system", "content": GENERATION_SYSTEM},
                    {
                        "role": "user",
                        "content": _generation_user_message(text, data.inputType),
                    },
                ],
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield f"data: {json.dumps({'token': delta})}\n\n"
            yield "data: {\"done\": true}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/refine")
def refine_tests(data: RefinementInput, request: Request):
    _check_rate_limit(_client_id(request))
    if not data.messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    final_messages = [{"role": "system", "content": REFINEMENT_SYSTEM}]
    for msg in data.messages:
        role = msg.get("role", "user")
        if role not in ("system", "user", "assistant"):
            role = "user"
        final_messages.append({"role": role, "content": msg.get("content", "")})

    try:
        response = chat_completion(final_messages)
        result = clean_gherkin_output(response.choices[0].message.content)
        return {"result": result}
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Refinement failed: {exc}") from exc
