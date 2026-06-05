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

REQUIREMENT_SIGNAL_PATTERN = re.compile(
    r"\b(?:must|should|shall|can|cannot|allow|allows|allowed|require|requires|required|"
    r"support|supports|validate|validates|display|displays|show|shows|prevent|prevents|"
    r"maximum|minimum|only|user|users|system|actor|admin|customer|when|if|given|"
    r"kullanici|kullanıcı|sistem|zorunlu|gerekir|gerekmeli|izin|destek|dogrula|doğrula|"
    r"goster|göster|engelle|yalnizca|yalnızca|maksimum|minimum)\b|"
    r"\b\w+(?:meli|malı|abilmeli|ebilmeli)\b",
    re.IGNORECASE,
)

INPUT_TYPE_GUIDANCE = {
    "requirements": (
        "The input is a structured requirements document. Treat numbered items or REQ-n "
        "references as individual requirements for traceability."
    ),
    "use_case": (
        "The input is a use case document. Extract the actor, goal, preconditions, main flow, "
        "alternative flows, and exceptions. Map each distinct flow or rule to traceable scenarios."
    ),
    "user_story": (
        "The input is user stories (As a … I want … So that …). Treat each story as a requirement "
        "and derive acceptance criteria scenarios from stated and implied behaviors. "
        "CRITICAL traceability: User Story 1 MUST use `@REQ-1`, User Story 2 MUST use `@REQ-2`, etc. "
        "Do NOT use slug-only tags like `@REQ-VIEW-ORDER-HISTORY` without the numeric `@REQ-n` tag."
    ),
}

USE_CASE_TEMPLATE = """Use Case: [Title]
Actor: [Primary actor]
Goal: [What the actor wants to achieve]

Preconditions:
- [System/user state before the flow starts]

Main Flow:
1. [Step]
2. [Step]

Alternative Flows:
- AF-1: [When X happens, then Y]

Exceptions:
- EX-1: [Error or failure condition and expected system response]
"""

SCENARIO_TYPE_TAG_RULE = """CRITICAL Scenario Type Tag Rule (MANDATORY on EVERY scenario):
Every scenario MUST have exactly ONE of these flow-type tags on the line above the Scenario:
  @happy-path      — main/success path, expected normal behavior
  @alternative-flow — optional paths, alternate valid flows (e.g. AF-1, remember-me, optional steps)
  @edge-case       — boundary conditions, limits, timeouts at threshold, session edge states
  @negative        — errors, failures, invalid input, exceptions (EX-1), service unavailable, rejected actions

Rules:
- NEVER omit the flow-type tag. A scenario with only @REQ-n and no flow tag is INVALID.
- Use case mapping: Main Flow → @happy-path; Alternative Flows (AF-n) → @alternative-flow; Exceptions (EX-n) → @negative or @edge-case as appropriate.
- User story mapping: success criteria → @happy-path; optional paths → @alternative-flow; boundary/limit cases → @edge-case; error/rejection cases → @negative.
- Tag line format: `@REQ-n @happy-path` (requirement tag + flow type tag, space-separated)."""

GENERATION_SYSTEM = f"""You are an expert software tester. Given software requirements,
generate comprehensive acceptance test scenarios in Gherkin format (Given/When/Then).
For each requirement, generate:
- At least one happy path scenario
- At least one alternative flow scenario
- At least one edge case scenario
- At least one negative scenario

CRITICAL Requirement Traceability Rule:
Identify which specific requirement or line number from the input text (e.g. 1, 2, or REQ-1) each scenario is based on.
You MUST prefix each Gherkin scenario with tags mapping back to that requirement (e.g. `@REQ-1`).

{SCENARIO_TYPE_TAG_RULE}

Example:
  @REQ-1 @happy-path
  Scenario: Successful login

  @REQ-APPLY-DISCOUNT-COUPON @negative
  Scenario: Payment service unavailable

Format your output as valid Gherkin feature files only. No extra explanation.
Do NOT wrap the output in markdown code blocks. Return raw Gherkin text only."""

REFINEMENT_SYSTEM = f"""You are an expert software tester. Given software requirements and modification history,
generate or update acceptance test scenarios in Gherkin format (Given/When/Then).

CRITICAL Requirement Traceability Rule:
Prefix each scenario with `@REQ-n` requirement tags.

{SCENARIO_TYPE_TAG_RULE}

When updating scenarios, preserve or add the correct flow-type tag on every scenario.

Scenario Numbering Mapping:
The user may refer to scenarios by @1, #1, or "scenario 1" (1-based index in the feature file).

Format: valid Gherkin only, no markdown fences. Return the complete updated feature file."""

ANALYZE_SYSTEM = """You are a senior business analyst and QA lead. Analyze software requirements BEFORE test design.

Return ONLY valid JSON (no markdown) with this exact structure:
{
  "qualityScore": <integer 0-100>,
  "summary": "<one sentence overall assessment>",
  "behaviors": [
    {
      "id": "B1",
      "description": "<key functional behavior>",
      "requirementRef": "<REQ-n or null>"
    }
  ],
  "businessRules": [
    {
      "id": "BR1",
      "rule": "<explicit or implied business rule>",
      "requirementRef": "<REQ-n or null>"
    }
  ],
  "assumptions": [
    {
      "id": "A1",
      "assumption": "<implicit assumption the reader must make>",
      "requirementRef": "<REQ-n or null>"
    }
  ],
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
- Extract ALL identifiable functional behaviors and business rules, even if requirements are high quality
- assumptions: list implicit conditions not explicitly stated (empty array if none)
- Include at least one warning if any issue exists; empty warnings array if requirements are excellent
- Use severity "high" for major blockers: ambiguous criteria, untestable requirements, missing preconditions, direct contradictions
- type guide:
  - ambiguity: vague/subjective terms, unclear actors or outcomes
  - inconsistency: conflicting statements between requirements
  - missing_validation: missing error handling, boundaries, or acceptance criteria
  - missing_precondition: required setup/state/system conditions not defined
  - not_testable: cannot be verified objectively or lacks measurable criteria
  - conflicting_rules: business rules that contradict each other
- Be specific and actionable in suggestions"""

COVERAGE_REVIEW_SYSTEM = """You are a QA coverage analyst. Compare requirements against generated Gherkin scenarios.

Evaluate whether scenarios semantically test each requirement — not just whether tags exist.

Return ONLY valid JSON (no markdown):
{
  "summary": "<brief overall semantic coverage assessment>",
  "reviews": [
    {
      "requirementRef": "REQ-1",
      "status": "covered" | "partial" | "not_covered",
      "rationale": "<why this status based on scenario steps vs requirement text>",
      "missingFlows": ["happy-path", "alternative-flow", "edge-case", "negative"],
      "scenarioRefs": ["Scenario title that covers this requirement"]
    }
  ]
}

Rules:
- status "covered": requirement is meaningfully tested with adequate flow coverage
- status "partial": some scenarios exist but gaps remain (wrong focus, missing flows, weak steps)
- status "not_covered": no scenario adequately tests this requirement
- missingFlows: list flow types still needed (empty array if all four are adequately covered)
- scenarioRefs: matching scenario titles from the Gherkin (empty if none)
- One review entry per requirement reference found in the input"""

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


VALID_INPUT_TYPES = frozenset({"requirements", "use_case", "user_story"})


def normalize_input_type(value: str | None) -> str:
    cleaned = (value or "requirements").strip().lower().replace("-", "_")
    if cleaned not in VALID_INPUT_TYPES:
        return "requirements"
    return cleaned


def input_type_guidance(input_type: str) -> str:
    return INPUT_TYPE_GUIDANCE.get(normalize_input_type(input_type), INPUT_TYPE_GUIDANCE["requirements"])


def validate_requirements(text: str) -> str:
    cleaned = (text or "").strip()
    if len(cleaned) < MIN_REQUIREMENTS_LEN:
        raise ValueError(f"Requirements must be at least {MIN_REQUIREMENTS_LEN} characters")
    if len(cleaned) > MAX_REQUIREMENTS_LEN:
        raise ValueError(f"Requirements must not exceed {MAX_REQUIREMENTS_LEN} characters")
    return cleaned


def validate_testable_requirements(text: str) -> str:
    cleaned = validate_requirements(text)
    words = re.findall(r"[^\W\d_]+", cleaned, flags=re.UNICODE)
    normalized_words = [word.casefold() for word in words]
    letters = "".join(words).casefold()
    vowels = set("aeiouyıöü")

    if len(words) < 3 or len(set(normalized_words)) < 2:
        raise ValueError("Input must contain a clear, testable software requirement")
    if re.search(r"(.)\1{4,}", letters):
        raise ValueError("Input appears to contain repeated or meaningless characters")
    if letters and sum(char in vowels for char in letters) / len(letters) < 0.20:
        raise ValueError("Input appears to be random or unreadable text")
    if not REQUIREMENT_SIGNAL_PATTERN.search(cleaned):
        raise ValueError(
            "Input does not describe a testable requirement or system behavior"
        )
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
