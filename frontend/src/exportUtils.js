import {
  buildCoverageMatrix,
  parseGherkin,
  warningTypeLabel,
} from "./gherkinUtils.js"

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br/>")
}

export function extractScenarios(gherkinText) {
  if (!gherkinText) return []
  return parseGherkin(gherkinText).scenarios.map((scenario) => ({
    title: scenario.title,
    traceId: scenario.traceId,
    type: scenario.type,
    tags: scenario.tags || [],
    steps: scenario.steps || [],
    isOutline: scenario.isOutline,
  }))
}

function scenarioCount(targetSessions) {
  return targetSessions.reduce((acc, s) => acc + extractScenarios(s.result).length, 0)
}

function buildTraceRows(targetSessions) {
  return targetSessions.map((s, sessionIdx) => {
    const rows = buildCoverageMatrix(s.requirements || "", s.result || "", s.inputType || "requirements")
    if (rows.length === 0) {
      return `
        <tr>
          <td><strong>REQ-${sessionIdx + 1}</strong><br/>${escapeHtml(s.title)}</td>
          <td><em>No requirements parsed</em></td>
          <td><span class="status-badge status-uncovered">Uncovered</span></td>
        </tr>
      `
    }

    return rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.requirement.id)}</strong><br/>${escapeHtml(row.requirement.text || s.title)}</td>
        <td>
          ${row.scenarios.length === 0
            ? "<em>No scenarios</em>"
            : `<ul>${row.scenarios.map((sc) => `<li>${escapeHtml(sc.title)}</li>`).join("")}</ul>`}
        </td>
        <td>
          <span class="status-badge ${row.covered ? "status-covered" : "status-uncovered"}">
            ${row.covered ? "Covered" : "Uncovered"}
          </span>
        </td>
      </tr>
    `).join("")
  }).join("")
}

function buildScenarioDetailRows(targetSessions) {
  return targetSessions.map((s, sessionIdx) => {
    const scenarios = extractScenarios(s.result)
    if (scenarios.length === 0) {
      return `
        <tr>
          <td>${sessionIdx + 1}</td>
          <td>${escapeHtml(s.title)}</td>
          <td colspan="5"><em>No scenarios generated</em></td>
        </tr>
      `
    }

    return scenarios.map((sc, scIdx) => `
      <tr>
        <td>${sessionIdx + 1}.${scIdx + 1}</td>
        <td>${escapeHtml(sc.traceId || "Untraced")}</td>
        <td>${escapeHtml(sc.isOutline ? "Scenario Outline" : "Scenario")}</td>
        <td>${escapeHtml(sc.title)}</td>
        <td>${escapeHtml(sc.type || "other")}</td>
        <td>${escapeHtml(sc.tags.join(" "))}</td>
        <td>${textToHtml(sc.steps.map((step) => step.trim()).filter(Boolean).join("\n"))}</td>
      </tr>
    `).join("")
  }).join("")
}

function warningSources(targetSessions, qualityAnalysis) {
  if (qualityAnalysis?.warnings?.length) {
    return [{ title: "Current requirements", analysis: qualityAnalysis }]
  }
  return targetSessions
    .filter((session) => session.qualityAnalysis?.warnings?.length)
    .map((session) => ({ title: session.title, analysis: session.qualityAnalysis }))
}

function buildWarningsSection(targetSessions, qualityAnalysis) {
  const sources = warningSources(targetSessions, qualityAnalysis)
  if (sources.length === 0) return ""

  return `
    <h2>Requirement Quality Warnings</h2>
    ${sources.map(({ title, analysis }) => `
      <div class="warning-group">
        <h3>${escapeHtml(title)}</h3>
        <p><strong>Quality score:</strong> ${escapeHtml(analysis.qualityScore ?? "N/A")}/100 ${analysis.summary ? `- ${escapeHtml(analysis.summary)}` : ""}</p>
        <ul>
          ${(analysis.warnings || []).map((w) => `
            <li>
              <strong>${escapeHtml(warningTypeLabel(w.type))}</strong>
              ${w.severity ? `(${escapeHtml(w.severity)})` : ""}:
              ${escapeHtml(w.message)}
              ${w.suggestion ? `<br/><em>Suggestion:</em> ${escapeHtml(w.suggestion)}` : ""}
            </li>
          `).join("")}
        </ul>
      </div>
    `).join("")}
  `
}

export function generateExportHTML(targetSessions, options = {}) {
  const {
    exportScope = "current",
    includeMetadata = true,
    includeTraceability = true,
    includeAmbiguityWarnings = true,
    qualityAnalysis = null,
    generatedAt = new Date(),
  } = options

  const title = exportScope === "current" ? "Single Requirement Report" : "All Requirements Batch Report"
  const traceRows = buildTraceRows(targetSessions)
  const scenarioRows = buildScenarioDetailRows(targetSessions)
  const warningsSection = includeAmbiguityWarnings ? buildWarningsSection(targetSessions, qualityAnalysis) : ""

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>TestGPT Export - ${escapeHtml(title)}</title>
      <style>
        body { font-family: 'DM Sans', -apple-system, sans-serif; color: #1F2937; line-height: 1.6; padding: 40px; max-width: 900px; margin: 0 auto; background-color: #FFFFFF; }
        h1 { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700; color: #C8445D; border-bottom: 2px solid #FEF0EC; padding-bottom: 12px; margin-bottom: 24px; }
        h2 { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 700; color: #111827; margin-top: 32px; margin-bottom: 16px; }
        h3 { font-size: 14px; font-weight: 700; color: #4B5563; margin-top: 18px; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 28px; page-break-inside: avoid; }
        th, td { border: 1px solid #E5E7EB; padding: 10px 12px; font-size: 13px; text-align: left; vertical-align: top; }
        th { background-color: #F9FAFB; font-weight: 700; color: #374151; }
        ul { margin: 0; padding-left: 18px; }
        .meta-box { background-color: #FEF0EC; border: 1px solid rgba(200, 68, 93, 0.1); padding: 16px 20px; border-radius: 8px; font-size: 13.5px; color: #5C5F66; margin-bottom: 32px; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
        .meta-item strong { color: #111827; }
        .req-section { border: 1px solid #E5E7EB; padding: 24px; border-radius: 10px; margin-bottom: 28px; background-color: #FAFAFA; page-break-inside: avoid; }
        .req-title { font-size: 16px; font-weight: 700; color: #C8445D; margin-bottom: 12px; }
        .source-box { background-color: #F3F4F6; border-left: 3px solid #D1D5DB; padding: 12px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; white-space: pre-wrap; color: #374151; margin-bottom: 20px; border-radius: 0 6px 6px 0; }
        .gherkin-box { background-color: #1E1E1E; color: #D4D4D4; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; padding: 20px; border-radius: 8px; white-space: pre-wrap; line-height: 1.6; margin-top: 12px; border: 1px solid #2D2D2D; }
        .status-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .status-covered { background-color: #ECFDF5; color: #047857; }
        .status-uncovered { background-color: #FEF2F2; color: #B91C1C; }
        .warning-group { border: 1px solid #F0D5CC; background: #FFFCFA; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
        .footer-note { text-align: center; font-size: 11px; color: #9CA3AF; margin-top: 60px; border-top: 1px solid #F3F4F6; padding-top: 16px; }
        @media print { body { padding: 20px; font-size: 12pt; } }
      </style>
    </head>
    <body>
      <h1>TestGPT Acceptance Scenarios Report</h1>
      ${includeMetadata ? `
        <div class="meta-box">
          <div class="meta-grid">
            <div class="meta-item"><strong>Project Name:</strong> TestGPT</div>
            <div class="meta-item"><strong>Export Date:</strong> ${escapeHtml(generatedAt.toLocaleDateString())}</div>
            <div class="meta-item"><strong>Export Time:</strong> ${escapeHtml(generatedAt.toLocaleTimeString())}</div>
            <div class="meta-item"><strong>Total Requirements:</strong> ${targetSessions.length}</div>
            <div class="meta-item"><strong>Total Scenarios:</strong> ${scenarioCount(targetSessions)}</div>
            <div class="meta-item"><strong>Export Scope:</strong> ${escapeHtml(title)}</div>
          </div>
        </div>
      ` : ""}
      ${warningsSection}
      ${includeTraceability ? `
        <h2>Requirement Traceability Matrix</h2>
        <table class="trace-table">
          <thead>
            <tr><th style="width: 35%">Requirement Source</th><th style="width: 45%">Generated Scenarios</th><th style="width: 20%">Status</th></tr>
          </thead>
          <tbody>${traceRows}</tbody>
        </table>
      ` : ""}
      <h2>Scenario Detail Matrix</h2>
      <table class="scenario-detail-table">
        <thead>
          <tr><th>#</th><th>Trace</th><th>Kind</th><th>Scenario</th><th>Category</th><th>Tags</th><th>Steps</th></tr>
        </thead>
        <tbody>${scenarioRows}</tbody>
      </table>
      <h2>Generated Gherkin Scenarios</h2>
      ${targetSessions.map((s, idx) => `
        <div class="req-section">
          <div class="req-title">REQ-${idx + 1}: ${escapeHtml(s.title)}</div>
          <h3>Source Requirements</h3>
          <div class="source-box">${textToHtml(s.requirements || "")}</div>
          <h3>Generated Gherkin Tests</h3>
          <div class="gherkin-box">${textToHtml(s.result || "")}</div>
        </div>
      `).join("")}
      <div class="footer-note">Generated automatically by TestGPT - BDD acceptance scenario test builder.</div>
    </body>
    </html>
  `
}
