/** Gherkin parsing, validation, sanitization — shared by App and tests */

export function determineScenarioType(title, tags) {
  const allTagsText = tags.join(" ").toLowerCase()
  const titleLower = title.toLowerCase()

  if (allTagsText.includes("happy") || allTagsText.includes("success")) return "happy-path"
  if (allTagsText.includes("alternative") || allTagsText.includes("alt-flow")) return "alternative-flow"
  if (allTagsText.includes("edge") || allTagsText.includes("boundary")) return "edge-case"
  if (allTagsText.includes("negative") || allTagsText.includes("fail") || allTagsText.includes("error")) return "negative"

  if (titleLower.includes("happy path") || titleLower.includes("successful") || titleLower.includes("happy-path")) return "happy-path"
  if (titleLower.includes("alternative") || titleLower.includes("alt flow") || titleLower.includes("optional path")) return "alternative-flow"
  if (titleLower.includes("edge case") || titleLower.includes("boundary") || titleLower.includes("edge-case")) return "edge-case"
  if (titleLower.includes("negative") || titleLower.includes("fail") || titleLower.includes("error") || titleLower.includes("invalid")) return "negative"

  return "other"
}

export function syncTagsForType(tags, type) {
  const strip = [
    "@happy-path", "@happy_path", "@happy",
    "@alternative-flow", "@alternative_flow", "@alternative",
    "@edge-case", "@edge_case", "@edge",
    "@negative", "@negative-scenario", "@negative_scenario",
  ]
  let newTags = tags.filter((t) => !strip.includes(t))

  if (type === "happy-path") newTags.push("@happy-path")
  else if (type === "alternative-flow") newTags.push("@alternative-flow")
  else if (type === "edge-case") newTags.push("@edge-case")
  else if (type === "negative") newTags.push("@negative")

  return newTags
}

export function parseGherkin(text) {
  if (!text) return { featureHeader: "", scenarios: [] }
  const lines = text.split("\n")
  const featureHeaderLines = []
  const scenarios = []
  let currentScenario = null
  let currentTags = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("@")) {
      currentTags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith("@")))
      continue
    }

    if (trimmed.startsWith("Scenario:") || trimmed.startsWith("Scenario Outline:")) {
      if (currentScenario) {
        while (currentScenario.steps.length > 0 && currentScenario.steps[currentScenario.steps.length - 1].trim() === "") {
          currentScenario.steps.pop()
        }
        scenarios.push(currentScenario)
      }
      const isOutline = trimmed.startsWith("Scenario Outline:")
      const prefix = isOutline ? "Scenario Outline:" : "Scenario:"
      const title = trimmed.substring(prefix.length).trim()

      const traceTag = currentTags.find((tag) => /^@REQ-?[a-zA-Z0-9_-]+$/i.test(tag))
      let traceId = extractTraceIdFromTags(currentTags)
      if (!traceId && traceTag) {
        const cleaned = traceTag.substring(1).toUpperCase()
        traceId = cleaned.startsWith("REQ-") ? cleaned : `REQ-${cleaned.replace("REQ", "")}`
      }

      currentScenario = {
        id: `sc-${scenarios.length}-${title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 15).toLowerCase()}`,
        title,
        isOutline,
        tags: [...currentTags],
        traceId,
        steps: [],
        type: determineScenarioType(title, currentTags),
      }
      currentTags = []
      continue
    }

    if (!currentScenario) featureHeaderLines.push(line)
    else currentScenario.steps.push(line)
  }

  if (currentScenario) {
    while (currentScenario.steps.length > 0 && currentScenario.steps[currentScenario.steps.length - 1].trim() === "") {
      currentScenario.steps.pop()
    }
    scenarios.push(currentScenario)
  }

  return { featureHeader: featureHeaderLines.join("\n"), scenarios }
}

export function serializeGherkin(featureHeader, scenarios) {
  let text = ""
  if (featureHeader) text += `${featureHeader.trimEnd()}\n\n`

  scenarios.forEach((sc) => {
    if (sc.tags?.length) text += `  ${sc.tags.join(" ")}\n`
    const prefix = sc.isOutline ? "Scenario Outline" : "Scenario"
    text += `  ${prefix}: ${sc.title}\n`
    sc.steps?.forEach((step) => {
      const trimmedStep = step.trim()
      text += trimmedStep ? `    ${trimmedStep}\n` : "\n"
    })
    text += "\n"
  })
  return `${text.trim()}\n`
}

export function computeLineDiff(original, current) {
  const origLines = (original || "").split("\n")
  const currLines = (current || "").split("\n")
  const dp = Array(origLines.length + 1)
    .fill(null)
    .map(() => Array(currLines.length + 1).fill(0))

  for (let i = 1; i <= origLines.length; i++) {
    for (let j = 1; j <= currLines.length; j++) {
      if (origLines[i - 1].trim() === currLines[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  let i = origLines.length
  let j = currLines.length
  const diff = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1].trim() === currLines[j - 1].trim()) {
      diff.unshift({ type: "unchanged", text: currLines[j - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: "added", text: currLines[j - 1] })
      j--
    } else {
      diff.unshift({ type: "removed", text: origLines[i - 1] })
      i--
    }
  }
  return diff
}

export function sanitizeInput(text) {
  if (!text) return ""
  // eslint-disable-next-line no-control-regex -- strips non-printable input before sending it to the API
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  clean = clean.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  clean = clean.replace(/\n{4,}/g, "\n\n\n")
  return clean
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
}

export function isValidGherkin(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  return (
    lower.includes("feature:") ||
    lower.includes("scenario:") ||
    lower.includes("given ") ||
    lower.includes("when ") ||
    lower.includes("then ")
  )
}

/** Normalize input type from UI/API values */
export function normalizeInputType(inputType) {
  const cleaned = (inputType || "requirements").trim().toLowerCase().replace(/-/g, "_")
  if (cleaned === "use_case" || cleaned === "user_story") return cleaned
  return "requirements"
}

function slugifyUseCaseId(text) {
  const match = text.match(/^Use Case:\s*(.+)$/im)
  const title = match ? match[1].trim() : text.trim().split("\n")[0].trim()
  let parts = title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .split("-")
    .filter(Boolean)

  while (parts.length > 2) {
    const prev = parts[parts.length - 2]
    if (prev === "AT" || prev === "FOR" || prev === "TO" || prev === "IN" || prev === "ON") {
      parts.pop()
      parts.pop()
    } else {
      break
    }
  }

  const slug = parts.join("-").slice(0, 48)
  return slug ? `REQ-${slug}` : "REQ-1"
}

const USER_STORY_HEADER = /^(?:User Story\s+(\d+)|US-(\d+)|Story\s+(\d+))\b/i

/** Resolve trace id from Gherkin tags (@REQ-1, @US-2, @USER-STORY-3, slug tags). */
export function extractTraceIdFromTags(tags) {
  if (!tags?.length) return null

  for (const tag of tags) {
    const t = tag.substring(1).toUpperCase()
    if (/^REQ-\d+$/.test(t)) return t
    const usMatch = t.match(/^US-(\d+)$/)
    if (usMatch) return `REQ-${usMatch[1]}`
    const storyMatch = t.match(/^USER-STORY-(\d+)$/)
    if (storyMatch) return `REQ-${storyMatch[1]}`
  }

  for (const tag of tags) {
    const t = tag.substring(1).toUpperCase()
    if (/^REQ-[A-Z0-9_-]+$/.test(t)) return t
  }

  return null
}

function slugifyUserStoryTitle(headerLine) {
  const titlePart = headerLine.replace(/^User Story\s+\d+\s*[—\-–:]\s*/i, "").trim()
  if (!titlePart) return null
  const slug = titlePart
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug ? `REQ-${slug}` : null
}

function parseRequirementsNumbered(text) {
  const lines = text.split("\n")
  const reqs = []
  let buffer = []
  let currentId = null
  let bufferStart = null
  let bufferEnd = null
  let offset = 0

  const flush = () => {
    if (buffer.length) {
      reqs.push({
        id: currentId || `REQ-${reqs.length + 1}`,
        text: buffer.join(" ").trim(),
        aliases: [currentId || `REQ-${reqs.length + 1}`],
        start: bufferStart ?? 0,
        end: bufferEnd ?? bufferStart ?? 0,
      })
      buffer = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const lineStart = offset
    const lineEnd = offset + line.length

    if (trimmed) {
      const numMatch = trimmed.match(/^(\d+)[.)]\s+(.*)/)
      const reqMatch = trimmed.match(/^(REQ-?\d+)\s*[:.)-]?\s*(.*)/i)
      if (numMatch || reqMatch) {
        flush()
        if (numMatch) {
          currentId = `REQ-${numMatch[1]}`
          buffer = [numMatch[2]]
        } else {
          currentId = reqMatch[1].toUpperCase().replace(/^REQ(\d)/, "REQ-$1")
          if (!currentId.startsWith("REQ-")) currentId = currentId.replace("REQ", "REQ-")
          buffer = [reqMatch[2] || trimmed]
        }
        bufferStart = lineStart
        bufferEnd = lineEnd
      } else {
        if (buffer.length === 0) {
          currentId = currentId || `REQ-${reqs.length + 1}`
          bufferStart = lineStart
        }
        buffer.push(trimmed)
        bufferEnd = lineEnd
      }
    }
    offset += line.length + 1
  }
  flush()

  if (reqs.length === 0 && text.trim()) {
    const end = text.endsWith("\n") ? text.trimEnd().length : text.length
    return [{ id: "REQ-1", text: text.trim().slice(0, 200), aliases: ["REQ-1"], start: 0, end }]
  }
  return reqs
}

function parseUseCaseRequirement(text) {
  const id = slugifyUseCaseId(text)
  const end = text.endsWith("\n") ? text.trimEnd().length : text.length
  const aliases = [id, "REQ-1"]
  return [{
    id,
    text: text.trim().slice(0, 200) || text.trim(),
    aliases,
    start: 0,
    end,
  }]
}

function parseUserStoryRequirements(text) {
  const lines = text.split("\n")
  const reqs = []
  let buffer = []
  let currentId = null
  let bufferStart = null
  let bufferEnd = null
  let offset = 0

  const flush = () => {
    if (buffer.length && currentId) {
      const num = currentId.replace("REQ-", "")
      const aliases = [currentId, `US-${num}`, `USER-STORY-${num}`]
      const slugId = slugifyUserStoryTitle(buffer[0])
      if (slugId) aliases.push(slugId)
      reqs.push({
        id: currentId,
        text: buffer.join(" ").trim(),
        aliases,
        start: bufferStart ?? 0,
        end: bufferEnd ?? bufferStart ?? 0,
      })
      buffer = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const lineStart = offset
    const lineEnd = offset + line.length

    if (trimmed) {
      const storyMatch = trimmed.match(USER_STORY_HEADER)
      if (storyMatch) {
        flush()
        const num = storyMatch[1] || storyMatch[2] || storyMatch[3]
        currentId = `REQ-${num}`
        bufferStart = lineStart
        bufferEnd = lineEnd
        buffer = [trimmed]
      } else if (currentId) {
        buffer.push(trimmed)
        bufferEnd = lineEnd
      }
    }
    offset += line.length + 1
  }
  flush()

  if (reqs.length === 0 && text.trim()) {
    const end = text.endsWith("\n") ? text.trimEnd().length : text.length
    return [{ id: "REQ-1", text: text.trim().slice(0, 200), aliases: ["REQ-1"], start: 0, end }]
  }
  return reqs
}

/** Parse requirements / use cases / user stories for coverage matrix */
export function parseRequirementLines(text, inputType = "requirements") {
  if (!text?.trim()) return []

  const mode = normalizeInputType(inputType)
  if (mode === "use_case") return parseUseCaseRequirement(text)
  if (mode === "user_story") return parseUserStoryRequirements(text)
  return parseRequirementsNumbered(text)
}

/** Normalize trace id from Gherkin tags or UI clicks */
export function normalizeTraceId(raw) {
  if (!raw) return null
  let id = String(raw).trim().toUpperCase().replace(/^@/, "")

  const usMatch = id.match(/^US-(\d+)$/)
  if (usMatch) return `REQ-${usMatch[1]}`
  const storyMatch = id.match(/^USER-STORY-(\d+)$/)
  if (storyMatch) return `REQ-${storyMatch[1]}`

  if (/^REQ-[A-Z0-9_-]+$/.test(id)) return id
  if (/^REQ-?\d+$/.test(id)) return id.replace(/^REQ-?/, "REQ-")

  const trailingNum = id.match(/(?:^|[-_])(\d+)$/)
  if (trailingNum) return `REQ-${trailingNum[1]}`

  return id.startsWith("REQ-") ? id : null
}

function findRequirementForScenario(traceId, scenarioTitle, reqs, inputType) {
  const mode = normalizeInputType(inputType)
  const aliasMap = buildAliasMap(reqs)
  const resolved = resolveTraceRef(traceId, aliasMap, reqs, mode)
  if (resolved && reqs.some((r) => r.id === resolved)) return resolved

  if (mode !== "user_story" || !scenarioTitle) return null

  const titleLower = scenarioTitle.toLowerCase()
  for (const r of reqs) {
    const headerMatch = r.text.match(/User Story\s+\d+\s*[—\-–:]\s*(.+?)(?:\s+As a|\s+Acceptance|$)/is)
    const topic = (headerMatch ? headerMatch[1] : r.text).toLowerCase()
    const topicWords = topic.split(/[^a-z0-9]+/).filter((w) => w.length > 4)
    if (topicWords.some((w) => titleLower.includes(w))) return r.id
  }
  return null
}

function buildAliasMap(reqs) {
  const map = new Map()
  for (const r of reqs) {
    map.set(r.id.toUpperCase(), r.id)
    for (const alias of r.aliases || []) {
      map.set(String(alias).toUpperCase(), r.id)
    }
  }
  return map
}

function resolveTraceRef(traceId, aliasMap, reqs, inputType) {
  const mode = normalizeInputType(inputType)
  if (!traceId) return null

  const normalized = normalizeTraceId(traceId) || traceId
  const upper = String(normalized).toUpperCase()

  if (aliasMap.has(upper)) return aliasMap.get(upper)

  for (const [alias, reqId] of aliasMap.entries()) {
    if (upper === alias || upper.startsWith(`${alias}-`) || alias.startsWith(upper)) return reqId
  }

  if (mode === "use_case" && reqs.length === 1) return reqs[0].id

  if (mode === "user_story") {
    const numMatch = upper.match(/^REQ-(\d+)$/)
    if (numMatch && aliasMap.has(`REQ-${numMatch[1]}`)) return `REQ-${numMatch[1]}`
  }

  return aliasMap.get(upper) || null
}

function findRequirementByTraceId(reqs, traceId, inputType) {
  if (!traceId || !reqs.length) return null
  const upper = String(traceId).toUpperCase().replace(/^@/, "")
  const normalized = normalizeTraceId(traceId)

  const direct = reqs.find(
    (r) =>
      r.id.toUpperCase() === upper ||
      r.id.toUpperCase() === normalized ||
      (r.aliases || []).some((a) => String(a).toUpperCase() === upper || String(a).toUpperCase() === normalized)
  )
  if (direct) return direct

  const fuzzy = reqs.find(
    (r) =>
      r.id.toUpperCase().startsWith(upper) ||
      upper.startsWith(r.id.toUpperCase())
  )
  if (fuzzy) return fuzzy

  if (normalizeInputType(inputType) === "use_case" && reqs.length === 1) return reqs[0]
  return null
}

/** Character range in requirements text for a trace id (multi-line aware). */
export function findRequirementRange(text, traceId, inputType = "requirements") {
  if (!text?.trim() || !traceId) return null

  const mode = normalizeInputType(inputType)
  const reqs = parseRequirementLines(text, mode)
  const req = findRequirementByTraceId(reqs, traceId, mode)

  if (req && req.start != null && req.end != null) {
    return { start: req.start, end: req.end, id: req.id }
  }

  const targetId = normalizeTraceId(traceId)
  if (!targetId) return null

  const reqNum = targetId.replace("REQ-", "")
  const fallbackPatterns = [
    new RegExp(`^\\s*${reqNum}\\s*[.)]`, "m"),
    new RegExp(`^\\s*REQ-?${reqNum}\\b`, "mi"),
    new RegExp(`^User Story\\s+${reqNum}\\b`, "mi"),
    new RegExp(`^US-${reqNum}\\b`, "mi"),
  ]

  for (const pattern of fallbackPatterns) {
    const match = text.match(pattern)
    if (match?.index == null) continue

    const start = match.index
    const after = text.slice(start + match[0].length)
    const nextBlock = after.match(
      /\n(?:\d+[.)]\s|REQ-?\d+\b|User Story\s+\d+\b|US-\d+\b|Story\s+\d+\b)/i
    )
    const end = nextBlock?.index != null
      ? start + match[0].length + nextBlock.index
      : text.length

    return { start, end, id: targetId }
  }

  return null
}

export function scrollTextareaToRange(textarea, start) {
  if (!textarea || start == null) return

  const styles = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 20
  const textBefore = textarea.value.substring(0, start)
  const lineIndex = textBefore.split("\n").length - 1

  textarea.scrollTop = Math.max(0, (lineIndex - 2) * lineHeight)
  textarea.closest(".panel-input")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
}

export function buildCoverageMatrix(requirementsText, gherkinText, inputType = "requirements") {
  const mode = normalizeInputType(inputType)
  const reqs = parseRequirementLines(requirementsText, mode)
  const { scenarios } = parseGherkin(gherkinText)
  const aliasMap = buildAliasMap(reqs)
  const byReq = {}

  reqs.forEach((r) => {
    byReq[r.id] = { requirement: r, scenarios: [], covered: false }
  })

  scenarios.forEach((sc) => {
    let ref = resolveTraceRef(sc.traceId, aliasMap, reqs, mode)
    if (!ref || !byReq[ref]) {
      ref = findRequirementForScenario(sc.traceId, sc.title, reqs, mode)
    }
    if (ref && byReq[ref]) {
      byReq[ref].scenarios.push(sc)
      byReq[ref].covered = true
    }
  })

  return Object.values(byReq)
}

export const COVERAGE_FLOW_TYPES = [
  { id: "happy-path", label: "Happy Path", short: "Happy" },
  { id: "alternative-flow", label: "Alternative", short: "Alt" },
  { id: "edge-case", label: "Edge Case", short: "Edge" },
  { id: "negative", label: "Negative", short: "Neg" },
]

/** Per flow type for one requirement's scenarios */
export function flowCoverageCellStatus(scenarios, flowType) {
  const typed = scenarios.filter((s) => s.type === flowType)
  if (typed.length > 0) return "complete"
  if (scenarios.length > 0) return "partial"
  return "not-covered"
}

export function overallRequirementCoverage(byType) {
  const values = Object.values(byType)
  if (values.every((v) => v === "not-covered")) return "not-covered"
  if (values.every((v) => v === "complete")) return "complete"
  if (values.some((v) => v === "complete")) return "partial"
  return "insufficient"
}

export function buildCoverageSummary(requirementsText, gherkinText, inputType = "requirements") {
  return buildCoverageMatrix(requirementsText, gherkinText, inputType).map((row) => {
    const byType = {}
    COVERAGE_FLOW_TYPES.forEach(({ id }) => {
      byType[id] = flowCoverageCellStatus(row.scenarios, id)
    })
    return {
      ...row,
      byType,
      overall: overallRequirementCoverage(byType),
    }
  })
}

export const MAJOR_ISSUE_TYPES = new Set([
  "ambiguity",
  "inconsistency",
  "missing_precondition",
  "missing_preconditions",
  "not_testable",
  "untestable_criteria",
  "conflicting_rules",
])

export function isMajorWarning(warning) {
  if (!warning) return false
  if (warning.severity === "high") return true
  return MAJOR_ISSUE_TYPES.has(warning.type)
}

export function warningTypeLabel(type) {
  const labels = {
    ambiguity: "Ambiguity",
    inconsistency: "Inconsistency",
    missing_validation: "Missing validation",
    missing_precondition: "Missing precondition",
    not_testable: "Not testable",
    untestable_criteria: "Untestable criteria",
    conflicting_rules: "Conflicting rules",
  }
  return labels[type] || (type || "issue").replace(/_/g, " ")
}

export function coverageStatusLabel(status) {
  const labels = {
    complete: "Complete",
    partial: "Partial",
    insufficient: "Insufficient",
    "not-covered": "Not covered",
  }
  return labels[status] || status
}
