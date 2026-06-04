import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  parseGherkin,
  serializeGherkin,
  determineScenarioType,
  sanitizeInput,
  isValidGherkin,
  computeLineDiff,
  parseRequirementLines,
  findRequirementRange,
  buildCoverageMatrix,
  buildCoverageSummary,
  flowCoverageCellStatus,
  isMajorWarning,
  syncTagsForType,
} from "./gherkinUtils.js"

const SAMPLE = `Feature: Login

  @REQ-1 @happy-path
  Scenario: Successful login
    Given the user is registered
    When the user logs in with valid credentials
    Then the dashboard is shown

  @REQ-2 @alternative-flow
  Scenario: Login via remember me
    Given the user checked remember me
    When the user returns within 30 days
    Then the user is logged in automatically
`

describe("determineScenarioType", () => {
  it("detects alternative-flow from tags", () => {
    assert.equal(determineScenarioType("Any title", ["@alternative-flow"]), "alternative-flow")
  })
  it("detects negative from title", () => {
    assert.equal(determineScenarioType("Invalid password fails", []), "negative")
  })
})

describe("parseGherkin / serializeGherkin", () => {
  it("round-trips scenarios", () => {
    const { featureHeader, scenarios } = parseGherkin(SAMPLE)
    assert.ok(featureHeader.includes("Feature: Login"))
    assert.equal(scenarios.length, 2)
    assert.equal(scenarios[0].traceId, "REQ-1")
    const out = serializeGherkin(featureHeader, scenarios)
    assert.ok(out.includes("Scenario: Successful login"))
  })
})

describe("sanitizeInput", () => {
  it("strips script tags", () => {
    const out = sanitizeInput('<script>alert(1)</script>Hello')
    assert.ok(!out.includes("<script>"))
    assert.ok(out.includes("Hello"))
  })
})

describe("isValidGherkin", () => {
  it("accepts valid sample", () => {
    assert.equal(isValidGherkin(SAMPLE), true)
  })
  it("rejects plain text", () => {
    assert.equal(isValidGherkin("just words"), false)
  })
})

describe("computeLineDiff", () => {
  it("detects added line", () => {
    const diff = computeLineDiff("a\nb", "a\nb\nc")
    assert.ok(diff.some((d) => d.type === "added" && d.text === "c"))
  })
})

describe("buildCoverageMatrix", () => {
  it("marks covered requirements", () => {
    const reqs = "1. User can login\n2. User can logout"
    const matrix = buildCoverageMatrix(reqs, SAMPLE)
    assert.ok(matrix.some((r) => r.requirement.id === "REQ-1" && r.covered))
  })
})

describe("syncTagsForType", () => {
  it("adds alternative-flow tag", () => {
    const tags = syncTagsForType(["@REQ-1"], "alternative-flow")
    assert.ok(tags.includes("@alternative-flow"))
  })
})

describe("buildCoverageSummary", () => {
  it("reports complete happy path for REQ-1", () => {
    const reqs = "1. User can login\n2. User can logout"
    const summary = buildCoverageSummary(reqs, SAMPLE)
    const req1 = summary.find((r) => r.requirement.id === "REQ-1")
    assert.equal(req1.byType["happy-path"], "complete")
  })
})

describe("isMajorWarning", () => {
  it("flags high severity", () => {
    assert.equal(isMajorWarning({ type: "missing_validation", severity: "high" }), true)
  })
  it("flags not_testable type", () => {
    assert.equal(isMajorWarning({ type: "not_testable", severity: "medium" }), true)
  })
})

describe("flowCoverageCellStatus", () => {
  it("returns not-covered when empty", () => {
    assert.equal(flowCoverageCellStatus([], "happy-path"), "not-covered")
  })
})

describe("parseRequirementLines", () => {
  it("parses numbered list in requirements mode", () => {
    const lines = parseRequirementLines("1. First\n2. Second", "requirements")
    assert.equal(lines.length, 2)
    assert.equal(lines[0].id, "REQ-1")
  })

  it("parses use case as single requirement with slug id", () => {
    const text = "Use Case: Apply Discount Coupon at Checkout\nMain Flow:\n1. Step one\n2. Step two"
    const lines = parseRequirementLines(text, "use_case")
    assert.equal(lines.length, 1)
    assert.equal(lines[0].id, "REQ-APPLY-DISCOUNT-COUPON")
    assert.ok(lines[0].aliases.includes("REQ-1"))
  })

  it("does not split use case main flow steps into separate requirements", () => {
    const text = "Use Case: Checkout\nMain Flow:\n1. Step one\n2. Step two"
    const lines = parseRequirementLines(text, "use_case")
    assert.equal(lines.length, 1)
  })

  it("parses user story blocks", () => {
    const text = "User Story 1 — Login\nAs a user\n\nUser Story 2 — Logout\nAs a user"
    const lines = parseRequirementLines(text, "user_story")
    assert.equal(lines.length, 2)
    assert.equal(lines[0].id, "REQ-1")
    assert.equal(lines[1].id, "REQ-2")
  })
})

describe("buildCoverageMatrix input types", () => {
  const useCaseText = "Use Case: Apply Discount Coupon at Checkout\nMain Flow:\n1. Step one\n2. Step two"
  const useCaseGherkin = `Feature: Coupon

  @REQ-APPLY-DISCOUNT-COUPON @happy-path
  Scenario: Successful coupon application
    Given a cart with items
    When the customer applies a valid coupon
    Then the discount is shown

  @REQ-APPLY-DISCOUNT-COUPON @negative
  Scenario: Invalid coupon
    Given a cart with items
    When the customer applies an expired coupon
    Then an error is shown
`

  it("maps slug trace tags to single use case requirement", () => {
    const matrix = buildCoverageMatrix(useCaseText, useCaseGherkin, "use_case")
    assert.equal(matrix.length, 1)
    assert.equal(matrix[0].requirement.id, "REQ-APPLY-DISCOUNT-COUPON")
    assert.equal(matrix[0].scenarios.length, 2)
    assert.equal(matrix[0].covered, true)
  })

  it("maps REQ-1 alias to use case requirement", () => {
    const gherkin = useCaseGherkin.replace(/@REQ-APPLY-DISCOUNT-COUPON/g, "@REQ-1")
    const matrix = buildCoverageMatrix(useCaseText, gherkin, "use_case")
    assert.equal(matrix.length, 1)
    assert.equal(matrix[0].scenarios.length, 2)
    assert.equal(matrix[0].covered, true)
  })

  const userStoryText = `User Story 1 — View Order History
As a registered customer,
I want to view my past orders

User Story 2 — Cancel Pending Order
As a registered customer,
I want to cancel an order

User Story 3 — Reorder from History
As a registered customer,
I want to add all items to my cart`

  const userStoryGherkin = `Feature: Orders

  @REQ-VIEW-ORDER-HISTORY @happy-path
  Scenario: View order list
    Given the user is logged in
    When the user opens order history
    Then past orders are shown

  @US-2 @negative
  Scenario: Cancel pending order fails for shipped item
    Given a shipped order exists
    When the user tries to cancel
    Then cancellation is blocked

  @REQ-3 @happy-path
  Scenario: Reorder from past order
    Given a past order with available items
    When the user clicks reorder
    Then items are added to cart
`

  it("maps user story slug and US-n tags to REQ-n requirements", () => {
    const matrix = buildCoverageMatrix(userStoryText, userStoryGherkin, "user_story")
    assert.equal(matrix.length, 3)
    const req1 = matrix.find((r) => r.requirement.id === "REQ-1")
    const req2 = matrix.find((r) => r.requirement.id === "REQ-2")
    const req3 = matrix.find((r) => r.requirement.id === "REQ-3")
    assert.equal(req1?.scenarios.length, 1)
    assert.equal(req2?.scenarios.length, 1)
    assert.equal(req3?.scenarios.length, 1)
    assert.equal(req1?.covered, true)
    assert.equal(req2?.covered, true)
    assert.equal(req3?.covered, true)
  })

  it("extracts trace id from US-n tags", () => {
    const { scenarios } = parseGherkin(`Feature: X\n  @US-2 @happy-path\n  Scenario: Test\n    Given a`)
    assert.equal(scenarios[0].traceId, "REQ-2")
  })
})

describe("findRequirementRange", () => {
  it("finds multi-line numbered requirement block in requirements mode", () => {
    const text = "1. First line\ncontinues here\n2. Second item"
    const range = findRequirementRange(text, "REQ-1", "requirements")
    assert.ok(range)
    assert.equal(text.slice(range.start, range.end), "1. First line\ncontinues here")
  })

  it("finds user story block by heading", () => {
    const text = "User Story 1 — Login\nAs a user\n\nUser Story 2 — Logout\nAs a user"
    const range = findRequirementRange(text, "REQ-2", "user_story")
    assert.ok(range)
    assert.ok(text.slice(range.start, range.end).includes("Logout"))
    assert.ok(!text.slice(range.start, range.end).includes("User Story 1"))
  })

  it("selects full use case document for slug trace id", () => {
    const text = "Use Case: Apply Discount Coupon at Checkout\nActor: Customer\nMain Flow:\n1. Step"
    const range = findRequirementRange(text, "REQ-APPLY-DISCOUNT-COUPON", "use_case")
    assert.ok(range)
    assert.equal(range.start, 0)
    assert.ok(range.end >= text.length - 1)
  })

  it("selects full use case document for REQ-1 alias", () => {
    const text = "Use Case: Apply Discount Coupon at Checkout\nActor: Customer"
    const range = findRequirementRange(text, "REQ-1", "use_case")
    assert.ok(range)
    assert.equal(range.start, 0)
  })
})
