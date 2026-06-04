"""Shared AI helpers: prompts, Groq calls, response cleaning."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from groq import Groq

# Load backend/.env regardless of cwd when uvicorn is started
_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env")

MODEL = "llama-3.3-70b-versatile"
MAX_REQUIREMENTS_LEN = 50_000
MIN_REQUIREMENTS_LEN = 10

GENERATION_SYSTEM = """You are an expert software tester. Given software requirements,
generate comprehensive acceptance test scenarios in Gherkin format (Given/When/Then).
For each requirement, generate:
- At least one happy path scenario
- At least one alternative flow scenario
- At least one edge case scenario
- At least one negative scenario

CRITICAL Requirement Traceability Rule:
Identify which specific requirement or line number from the input text (e.g. 1, 2, or REQ-1) each scenario is based on.
You MUST prefix each Gherkin scenario with tags mapping back to that requirement (e.g. `@REQ-1`) and scenario type (e.g. `@happy-path`, `@alternative-flow`, `@edge-case`, `@negative`).

Example:
  @REQ-1 @happy-path
  Scenario: Successful login

Format your output as valid Gherkin feature files only. No extra explanation.
Do NOT wrap the output in markdown code blocks. Return raw Gherkin text only."""

REFINEMENT_SYSTEM = """You are an expert software tester. Given software requirements and modification history,
generate or update acceptance test scenarios in Gherkin format (Given/When/Then).

CRITICAL Requirement Traceability Rule:
Prefix each scenario with `@REQ-n` and type tags (`@happy-path`, `@alternative-flow`, `@edge-case`, `@negative`).

Scenario Numbering Mapping:
The user may refer to scenarios by @1, #1, or "scenario 1" (1-based index in the feature file).

Format: valid Gherkin only, no markdown fences. Return the complete updated feature file."""

ANALYZE_SYSTEM = """You are a senior business analyst and QA lead. Analyze software requirements BEFORE test design.

Return ONLY valid JSON (no markdown) with this exact structure:
{
  "qualityScore": <integer 0-100>,
  "summary": "<one sentence overall assessment>",
  "warnings": [
    {
      "id": "<unique string like W1>",
      "type": "ambiguity" | "inconsistency" | "missing_validation" | "missing_precondition" | "not_testable" | "conflicting_rules",
      "severity": "low" | "medium" | "high",
      "message": "<what is wrong>",
      "suggestion": "<how to fix>",
      "requirementRef": "<REQ-n or line reference or null>"
    }
  ]
}

Rules:
- qualityScore: 100 = excellent, 0 = unusable
- Include at least one warning if any issue exists; empty array if requirements are excellent
- Use severity "high" for major blockers: ambiguous criteria, untestable requirements, missing preconditions, direct contradictions
- type guide:
  - ambiguity: vague/subjective terms, unclear actors or outcomes
  - inconsistency: conflicting statements between requirements
  - missing_validation: missing error handling, boundaries, or acceptance criteria
  - missing_precondition: required setup/state/system conditions not defined
  - not_testable: cannot be verified objectively or lacks measurable criteria
  - conflicting_rules: business rules that contradict each other
- Be specific and actionable in suggestions"""

IMPROVE_REQUIREMENTS_SYSTEM = """You are a senior business analyst improving software requirements.

You receive:
1) The current requirements text
2) Quality warnings (ambiguity, inconsistency, missing validation) with suggestions

Rewrite the requirements to address ALL warnings while preserving intent and structure.

Rules:
- Return ONLY the improved requirements as plain text (no markdown fences, no JSON, no commentary)
- Keep numbered requirements (1., 2., …) or REQ-n style if present
- Be specific: define actors, validations, error cases, measurable criteria where warnings flagged gaps
- Do not invent unrelated features; only clarify and complete what the original text implies
- Write in the same language as the input requirements"""

CHANGE_IMPACT_SYSTEM = """You are a QA change-impact analyst. Compare OLD and NEW requirements.

Return ONLY valid JSON:
{
  "summary": "<brief impact summary>",
  "impactedAreas": ["<area1>", "<area2>"],
  "recommendedActions": [
    {"action": "<regenerate|review|add_scenarios>", "detail": "<what to do>"}
  ],
  "affectedRequirementRefs": ["REQ-1", "REQ-2"]
}"""


def get_client() -> Groq:
    api_key = (os.getenv("GROQ_API_KEY") or "").strip()
    if not api_key or api_key == "your_groq_api_key_here":
        raise ValueError(
            "GROQ_API_KEY is not configured. Create backend/.env with: GROQ_API_KEY=your_key "
            "(get a free key at https://console.groq.com)"
        )
    return Groq(api_key=api_key)


def validate_requirements(text: str) -> str:
    cleaned = (text or "").strip()
    if len(cleaned) < MIN_REQUIREMENTS_LEN:
        raise ValueError(f"Requirements must be at least {MIN_REQUIREMENTS_LEN} characters")
    if len(cleaned) > MAX_REQUIREMENTS_LEN:
        raise ValueError(f"Requirements must not exceed {MAX_REQUIREMENTS_LEN} characters")
    return cleaned


def clean_gherkin_output(result: str | None) -> str:
    if not result:
        return ""
    lines = result.split("\n")
    cleaned = [line for line in lines if not line.strip().startswith("```")]
    return "\n".join(cleaned).strip()


def chat_completion(
    messages: list[dict[str, str]],
    *,
    max_retries: int = 3,
    stream: bool = False,
) -> Any:
    client = get_client()
    last_error: Exception | None = None
    for attempt in range(max_retries):
        try:
            return client.chat.completions.create(
                model=MODEL,
                messages=messages,
                stream=stream,
            )
        except Exception as exc:  # noqa: BLE001 — map Groq errors to HTTP in main
            last_error = exc
            if attempt < max_retries - 1:
                time.sleep(0.5 * (2**attempt))
    raise last_error or RuntimeError("AI request failed")


def parse_json_response(raw: str) -> dict:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    return json.loads(text)
