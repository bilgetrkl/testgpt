"""Backend API tests (no live Groq calls)."""

import os

import pytest
from fastapi.testclient import TestClient

# Ensure tests do not require a real API key for validation-only routes
os.environ.setdefault("GROQ_API_KEY", "test-key-placeholder")

from main import app  # noqa: E402

client = TestClient(app)


def test_health():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "TestGPT backend running"


def test_generate_rejects_short_input():
    r = client.post("/generate", json={"requirements": "short"})
    assert r.status_code == 400


def test_analyze_rejects_empty():
    r = client.post("/analyze", json={"requirements": "          "})
    assert r.status_code == 400


def test_change_impact_rejects_short():
    r = client.post(
        "/change-impact",
        json={"oldRequirements": "x", "newRequirements": "y"},
    )
    assert r.status_code == 400


def test_refine_requires_messages():
    r = client.post("/refine", json={"messages": []})
    assert r.status_code == 400


def test_improve_requires_warnings():
    r = client.post(
        "/improve-requirements",
        json={"requirements": "1. " + "x" * 20, "warnings": []},
    )
    assert r.status_code == 400


def test_coverage_review_rejects_short_gherkin():
    reqs = "1. " + "x" * 20
    r = client.post(
        "/coverage-review",
        json={"requirements": reqs, "gherkin": "short"},
    )
    assert r.status_code == 400


def test_coverage_review_rejects_short_requirements():
    r = client.post(
        "/coverage-review",
        json={"requirements": "short", "gherkin": "Feature: X\n  Scenario: Y\n    Given a\n    When b\n    Then c"},
    )
    assert r.status_code == 400


def test_generate_accepts_input_type():
    r = client.post(
        "/generate",
        json={"requirements": "short", "inputType": "use_case"},
    )
    assert r.status_code == 400
