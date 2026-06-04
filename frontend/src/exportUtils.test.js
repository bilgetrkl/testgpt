import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { extractScenarios, generateExportHTML } from "./exportUtils.js"

const SAMPLE_GHERKIN = `Feature: Registration

  @REQ-1 @happy-path @smoke
  Scenario: Successful registration
    Given user is on registration page
    When user submits a valid email address and password
    Then the account is created
    And a confirmation email is sent

  @REQ-2 @edge-case
  Scenario Outline: Weak password is rejected
    Given user is on registration page
    When user submits password "<password>"
    Then the password validation message is shown

    Examples:
      | password |
      | abc      |
`

const SESSION = {
  title: "Registration requirements",
  requirements: "1. User can register with email and password\n2. Weak passwords must be rejected",
  result: SAMPLE_GHERKIN,
  qualityAnalysis: {
    qualityScore: 72,
    summary: "Needs clearer timing",
    warnings: [
      {
        id: "w1",
        type: "ambiguity",
        severity: "low",
        message: "Confirmation email timing is unclear",
        suggestion: "Define the expected delivery window",
      },
    ],
  },
}

describe("extractScenarios", () => {
  it("keeps scenario details needed by PDF and DOC exports", () => {
    const scenarios = extractScenarios(SAMPLE_GHERKIN)

    assert.equal(scenarios.length, 2)
    assert.equal(scenarios[0].title, "Successful registration")
    assert.equal(scenarios[0].traceId, "REQ-1")
    assert.equal(scenarios[0].type, "happy-path")
    assert.ok(scenarios[0].tags.includes("@smoke"))
    assert.ok(scenarios[0].steps.some((step) => step.includes("Given user is on registration page")))
    assert.equal(scenarios[1].isOutline, true)
    assert.equal(scenarios[1].type, "edge-case")
  })
})

describe("generateExportHTML", () => {
  it("includes complete requirement, traceability, scenario, step, tag, and warning data", () => {
    const html = generateExportHTML([SESSION], {
      exportScope: "current",
      includeMetadata: true,
      includeTraceability: true,
      includeAmbiguityWarnings: true,
      generatedAt: new Date("2026-06-04T10:00:00Z"),
    })

    assert.ok(html.includes("Registration requirements"))
    assert.ok(html.includes("User can register with email and password"))
    assert.ok(html.includes("Weak passwords must be rejected"))
    assert.ok(html.includes("Requirement Traceability Matrix"))
    assert.ok(html.includes("Scenario Detail Matrix"))
    assert.ok(html.includes("REQ-1"))
    assert.ok(html.includes("Successful registration"))
    assert.ok(html.includes("happy-path"))
    assert.ok(html.includes("@smoke"))
    assert.ok(html.includes("Given user is on registration page"))
    assert.ok(html.includes("Then the account is created"))
    assert.ok(html.includes("Scenario Outline"))
    assert.ok(html.includes("Weak password is rejected"))
    assert.ok(html.includes("Confirmation email timing is unclear"))
    assert.ok(html.includes("Define the expected delivery window"))
    assert.ok(html.includes("Total Requirements"))
    assert.ok(html.includes("Total Scenarios"))
  })

  it("escapes user-provided HTML in exported content", () => {
    const html = generateExportHTML([
      {
        ...SESSION,
        requirements: "<script>alert(1)</script>\n1. Register",
        result: `Feature: X

  @REQ-1 @happy-path
  Scenario: <b>Unsafe title</b>
    Given a safe export`,
      },
    ])

    assert.ok(!html.includes("<script>alert(1)</script>"))
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"))
    assert.ok(html.includes("&lt;b&gt;Unsafe title&lt;/b&gt;"))
  })

  it("respects export section toggles", () => {
    const html = generateExportHTML([SESSION], {
      includeTraceability: false,
      includeAmbiguityWarnings: false,
    })

    assert.ok(!html.includes("Requirement Traceability Matrix"))
    assert.ok(!html.includes("Confirmation email timing is unclear"))
    assert.ok(html.includes("Scenario Detail Matrix"))
    assert.ok(html.includes("Generated Gherkin Scenarios"))
  })
})
