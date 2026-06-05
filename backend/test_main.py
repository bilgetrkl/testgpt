"""Backend API tests (no live Groq calls)."""

import os
import uuid

import pytest
from fastapi.testclient import TestClient

# Ensure tests do not require a real API key for validation-only routes
os.environ.setdefault("GROQ_API_KEY", "test-key-placeholder")

from main import app  # noqa: E402

client = TestClient(app)


@pytest.fixture
def auth_headers():
    email = f"test-{uuid.uuid4().hex}@example.com"
    response = client.post(
        "/auth/register",
        json={"name": "Test User", "email": email, "password": "strongpass123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_health():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "TestGPT backend running"


def test_generate_requires_authentication():
    r = client.post("/generate", json={"requirements": "short"})
    assert r.status_code == 401


def test_generate_rejects_short_input(auth_headers):
    r = client.post("/generate", headers=auth_headers, json={"requirements": "short"})
    assert r.status_code == 400


def test_analyze_rejects_empty(auth_headers):
    r = client.post("/analyze", headers=auth_headers, json={"requirements": "          "})
    assert r.status_code == 400


def test_change_impact_rejects_short(auth_headers):
    r = client.post(
        "/change-impact",
        headers=auth_headers,
        json={"oldRequirements": "x", "newRequirements": "y"},
    )
    assert r.status_code == 400


def test_refine_requires_messages(auth_headers):
    r = client.post("/refine", headers=auth_headers, json={"messages": []})
    assert r.status_code == 400


def test_improve_requires_warnings(auth_headers):
    r = client.post(
        "/improve-requirements",
        headers=auth_headers,
        json={"requirements": "1. " + "x" * 20, "warnings": []},
    )
    assert r.status_code == 400


def test_coverage_review_rejects_short_gherkin(auth_headers):
    reqs = "1. " + "x" * 20
    r = client.post(
        "/coverage-review",
        headers=auth_headers,
        json={"requirements": reqs, "gherkin": "short"},
    )
    assert r.status_code == 400


def test_coverage_review_rejects_short_requirements(auth_headers):
    r = client.post(
        "/coverage-review",
        headers=auth_headers,
        json={"requirements": "short", "gherkin": "Feature: X\n  Scenario: Y\n    Given a\n    When b\n    Then c"},
    )
    assert r.status_code == 400


def test_generate_accepts_input_type(auth_headers):
    r = client.post(
        "/generate",
        headers=auth_headers,
        json={"requirements": "short", "inputType": "use_case"},
    )
    assert r.status_code == 400


@pytest.mark.parametrize(
    "nonsense",
    [
        "asdf qwer zxcv hjkl",
        "aaaaaaaaaaaaaaaaaaaa",
        "Today is a very beautiful and pleasant day outside",
    ],
)
def test_generate_rejects_nonsense_requirements(auth_headers, nonsense):
    r = client.post(
        "/generate",
        headers=auth_headers,
        json={"requirements": nonsense},
    )
    assert r.status_code == 400
    assert "requirement" in r.json()["detail"].lower() or "random" in r.json()["detail"].lower() or "meaningless" in r.json()["detail"].lower()


def test_stream_generate_rejects_nonsense_requirements(auth_headers):
    r = client.post(
        "/generate/stream",
        headers=auth_headers,
        json={"requirements": "random ordinary sentence without useful context"},
    )
    assert r.status_code == 400
