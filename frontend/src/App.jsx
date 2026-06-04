import { useState, useEffect, useCallback, useRef } from "react"
import mammoth from "mammoth"
import {
  parseGherkin,
  serializeGherkin,
  syncTagsForType,
  computeLineDiff,
  sanitizeInput,
  isValidGherkin,
  buildCoverageMatrix,
  buildCoverageSummary,
  COVERAGE_FLOW_TYPES,
  coverageStatusLabel,
  isMajorWarning,
  warningTypeLabel,
} from "./gherkinUtils.js"
import "./App.css"

const API_BASE = "http://localhost:8000"

// ── Gherkin Highlighter ───────────────────────────────────────
function classForLine(line) {
  const t = line.trimStart()
  if (t.startsWith("Feature:"))                              return "kw-feature"
  if (t.startsWith("Scenario:") || t.startsWith("Scenario Outline:")) return "kw-scenario"
  if (/^Given\s/.test(t))  return "kw-given"
  if (/^When\s/.test(t))   return "kw-when"
  if (/^Then\s/.test(t))   return "kw-then"
  if (/^And\s/.test(t))    return "kw-and"
  if (/^But\s/.test(t))    return "kw-but"
  return "kw-plain"
}

function GherkinBlock({ text }) {
  return (
    <pre className="gherkin-block">
      {text.split("\n").map((line, i) => (
        <span key={i} className={classForLine(line)}>
          {line || " "}
          {"\n"}
        </span>
      ))}
    </pre>
  )
}

// ── Skeleton ──────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="skeleton-container">
      {[1, 2, 3].map(i => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-sub" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-short" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-short" />
        </div>
      ))}
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={`toast toast-${type}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Close notification">Close</button>
    </div>
  )
}

// ── Session title helper ──────────────────────────────────────
function sessionTitle(requirements, index) {
  /* eslint-disable-next-line no-useless-escape */
  const firstLine = requirements.trim().split("\n")[0].replace(/^\d+[\.\)]\s*/, "").trim()
  return firstLine.length > 36 ? firstLine.slice(0, 36) + "…" : firstLine || `Session ${index + 1}`
}

// ── Scenario Card Component ──────────────────────────────────
function ScenarioCard({ 
  scenario, 
  requirementIndex,
  isEditing, 
  onEdit, 
  onSave, 
  onCancel, 
  onDelete,
  onQuickAction,
  onTraceClick,
  scenarioIndex
}) {
  const [editedTitle, setEditedTitle] = useState(scenario.title);
  const [editedSteps, setEditedSteps] = useState(scenario.steps.join("\n"));
  const [editedType, setEditedType] = useState(scenario.type);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Sync state when entering edit mode
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isEditing) {
      setEditedTitle(scenario.title);
      setEditedSteps(scenario.steps.join("\n"));
      setEditedType(scenario.type);
    }
  }, [isEditing, scenario]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSave = () => {
    onSave(scenario.id, {
      title: editedTitle.trim(),
      steps: editedSteps.split("\n"),
      type: editedType
    });
  };

  const badgeText = {
    "happy-path": "Happy Path",
    "alternative-flow": "Alternative Flow",
    "edge-case": "Edge Case",
    "negative": "Negative Scenario",
    "other": "Other"
  }[scenario.type] || "Other";

  const displayTags = (scenario.tags || []).filter(t => {
    const lower = t.toLowerCase();
    return !lower.startsWith("@req") && 
           lower !== "@happy-path" && lower !== "@happy_path" && lower !== "@happy" &&
           lower !== "@alternative-flow" && lower !== "@alternative_flow" && lower !== "@alternative" &&
           lower !== "@edge-case" && lower !== "@edge_case" && lower !== "@edge" &&
           lower !== "@negative" && lower !== "@negative-scenario" && lower !== "@negative_scenario";
  });

  if (isEditing) {
    return (
      <div className="scenario-card scenario-card-editing">
        <div className="scenario-edit-field">
          <label className="scenario-edit-label">Scenario Title</label>
          <input
            type="text"
            className="scenario-edit-input"
            value={editedTitle}
            onChange={e => setEditedTitle(e.target.value)}
            placeholder="e.g. Successful login"
          />
        </div>
        
        <div className="scenario-edit-field">
          <label className="scenario-edit-label">Category</label>
          <div className="scenario-type-buttons">
            {["happy-path", "alternative-flow", "edge-case", "negative"].map(t => (
              <button
                key={t}
                type="button"
                className={`scenario-type-btn btn-type-${t} ${editedType === t ? "active" : ""}`}
                onClick={() => setEditedType(t)}
              >
                {t === "happy-path" && "Happy Path"}
                {t === "alternative-flow" && "Alternative"}
                {t === "edge-case" && "Edge Case"}
                {t === "negative" && "Negative"}
              </button>
            ))}
          </div>
        </div>

        <div className="scenario-edit-field">
          <label className="scenario-edit-label">Steps (Gherkin format)</label>
          <textarea
            className="scenario-edit-textarea"
            value={editedSteps}
            onChange={e => setEditedSteps(e.target.value)}
            rows={8}
            placeholder={"Given the user is on the login page\nWhen the user enters valid credentials\nThen the user should see the dashboard"}
          />
        </div>

        <div className="scenario-card-actions">
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!editedTitle.trim()}>
            Save
          </button>
          <button className="btn btn-outline btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`scenario-card scenario-card-${scenario.type}`}>
      <div className="scenario-card-header">
        <div className="scenario-header-left">
          <span className="scenario-number-badge">
            SCENARIO #{scenarioIndex}
          </span>
          <span className={`scenario-badge badge-${scenario.type}`}>
            {badgeText}
          </span>
          {detailsOpen && displayTags.length > 0 && (
            <div className="scenario-tags">
              {displayTags.map((tag, idx) => (
                <span key={idx} className="scenario-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className="scenario-header-right">
          <button 
            className="traceability-badge traceability-link" 
            onClick={() => onTraceClick(scenario.traceId || `REQ-${requirementIndex}`)}
            title={`Click to highlight requirement ${scenario.traceId || `REQ-${requirementIndex}`} in left panel`}
          >
            Trace to {scenario.traceId || `REQ-${requirementIndex}`}
          </button>
          <button 
            type="button"
            className="btn-card-text btn-card-edit" 
            onClick={() => onEdit(scenario.id)}
            aria-label="Edit scenario"
          >
            Edit
          </button>
          <button 
            type="button"
            className="btn-card-text btn-card-delete" 
            onClick={() => onDelete(scenario.id)}
            aria-label="Delete scenario"
          >
            Delete
          </button>
        </div>
      </div>

      <button
        type="button"
        className="scenario-title scenario-title-toggle"
        onClick={() => setDetailsOpen(open => !open)}
        aria-expanded={detailsOpen}
        aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${scenario.title}`}
      >
        <span>{scenario.isOutline ? "Scenario Outline: " : "Scenario: "}{scenario.title}</span>
        <span className={`scenario-toggle-indicator ${detailsOpen ? "is-open" : "is-closed"}`} aria-hidden="true" />
      </button>

      {detailsOpen && (
        <>
          <div className="scenario-steps">
            <pre className="scenario-steps-pre">
              {scenario.steps.map((line, i) => (
                <span key={i} className={classForLine(line)}>
                  {line || " "}
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>

          <div className="scenario-card-footer-actions">
            <button 
              type="button"
              className="btn-quick-action" 
              onClick={() => onQuickAction("simplify", scenario.title)}
              title="Simplify Gherkin steps for this scenario"
            >
              Simplify steps
            </button>
            <button 
              type="button"
              className="btn-quick-action" 
              onClick={() => onQuickAction("detailed", scenario.title)}
              title="Add more detail to Gherkin steps for this scenario"
            >
              Expand steps
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [requirements, setRequirements] = useState("")
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState("")
  const [error, setError]       = useState("")
  const [toasts, setToasts]     = useState([])
  const [copied, setCopied]     = useState(false)
  const [forceShowRaw, setForceShowRaw] = useState(false)
  const [activeEditId, setActiveEditId] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [refinementPrompt, setRefinementPrompt] = useState("")
  const [diffViewOpen, setDiffViewOpen] = useState(false)
  const [refineLoading, setRefineLoading] = useState(false)
  
  // Phase 8 Export Options State Hooks
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState("feature") // "feature", "pdf", "docx"
  const [exportScope, setExportScope] = useState("current") // "current", "all"
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [includeTraceability, setIncludeTraceability] = useState(true)
  const [includeAmbiguityWarnings, setIncludeAmbiguityWarnings] = useState(true)

  const [qualityAnalysis, setQualityAnalysis] = useState(null)
  const [qualityPanelOpen, setQualityPanelOpen] = useState(true)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [improveLoading, setImproveLoading] = useState(false)
  const [dismissedWarningIds, setDismissedWarningIds] = useState([])
  const [acknowledgedWarningIds, setAcknowledgedWarningIds] = useState([])
  const [selectedWarningIds, setSelectedWarningIds] = useState([])
  const [rightPanelView, setRightPanelView] = useState("scenarios") // scenarios | coverage | matrix
  const [useStreaming, setUseStreaming] = useState(false)
  const [changeImpactOpen, setChangeImpactOpen] = useState(false)
  const [changeImpactResult, setChangeImpactResult] = useState(null)
  const [previousRequirements, setPreviousRequirements] = useState("")
  
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionIdx, setSuggestionIdx] = useState(0)
  
  const fileInputRef = useRef(null)

  // Session history — persisted to localStorage (2.7)
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem("testgpt-sessions")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem("testgpt-active-id")
    return saved ? Number(saved) : null
  })
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("testgpt-sessions")
      const parsed = saved ? JSON.parse(saved) : []
      return parsed.length > 0
    } catch { return false }
  })

  // Derived state (2.8 / 5.6)
  const activeSession = sessions.find(s => s.id === activeId)
  const activeVersionIdx = activeSession ? (activeSession.activeVersionIndex || 0) : 0
  const totalVersions = activeSession && activeSession.versions ? activeSession.versions.length : 1

  // Persist sessions to localStorage
  useEffect(() => {
    localStorage.setItem("testgpt-sessions", JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    if (activeId) localStorage.setItem("testgpt-active-id", activeId)
    else localStorage.removeItem("testgpt-active-id")
  }, [activeId])

  // Restore active session on page load
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (activeId && sessions.length > 0) {
      const active = sessions.find(s => s.id === activeId)
      if (active) {
        setRequirements(active.requirements)
        setResult(active.result)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Theme
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("testgpt-theme")
    if (saved) return saved
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("testgpt-theme", theme)
  }, [theme])

  const addToast = useCallback((message, type = "info") => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Scenario display and editing handlers (Phase 4) ────────
  const updateSessionResult = (newGherkinText) => {
    if (!activeId) return;
    
    const updatedSessions = sessions.map(s => {
      if (s.id === activeId) {
        const currentVersions = [...(s.versions || [{ requirements: s.requirements, result: s.result, timestamp: s.id }])];
        const activeIdx = s.activeVersionIndex !== undefined ? s.activeVersionIndex : 0;
        
        if (currentVersions[activeIdx]) {
          currentVersions[activeIdx] = {
            ...currentVersions[activeIdx],
            result: newGherkinText
          };
        }
        
        return {
          ...s,
          result: newGherkinText,
          versions: currentVersions
        };
      }
      return s;
    });
    
    setSessions(updatedSessions);
    setResult(newGherkinText);
  };

  const handleSaveScenario = (scenarioId, updatedFields) => {
    const { featureHeader, scenarios } = parseGherkin(result);
    
    const updatedScenarios = scenarios.map(sc => {
      if (sc.id === scenarioId) {
        const newTags = syncTagsForType(sc.tags, updatedFields.type);
        return {
          ...sc,
          title: updatedFields.title,
          steps: updatedFields.steps,
          type: updatedFields.type,
          tags: newTags
        };
      }
      return sc;
    });

    const newResult = serializeGherkin(featureHeader, updatedScenarios);
    updateSessionResult(newResult);
    setActiveEditId(null);
    addToast("Scenario updated", "success");
  };

  const handleDeleteScenario = (scenarioId) => {
    const { featureHeader, scenarios } = parseGherkin(result);
    const updatedScenarios = scenarios.filter(sc => sc.id !== scenarioId);
    const newResult = serializeGherkin(featureHeader, updatedScenarios);
    
    updateSessionResult(newResult);
    addToast("Scenario deleted", "info");
  };

  const handleAddScenario = () => {
    const { featureHeader, scenarios } = parseGherkin(result);
    
    const newScenarioId = `sc-${Date.now()}-${scenarios.length}-${Math.random().toString(36).substr(2, 9)}`;
    const newScenario = {
      id: newScenarioId,
      title: "New Custom Scenario",
      isOutline: false,
      tags: ["@happy-path"],
      steps: [
        "Given the system is ready",
        "When an action is performed",
        "Then the expected outcome occurs"
      ],
      type: "happy-path"
    };

    const updatedScenarios = [...scenarios, newScenario];
    const newResult = serializeGherkin(featureHeader, updatedScenarios);
    
    updateSessionResult(newResult);
    setActiveEditId(newScenarioId); // Enter edit mode immediately
    addToast("Added custom scenario", "success");
  };

  // Start a new draft session
  const startNewSession = () => {
    setActiveId(null)
    setRequirements("")
    setResult("")
    setError("")
    setForceShowRaw(false)
    setActiveEditId(null)
    setSelectedCategory("all")
    setDiffViewOpen(false)
    addToast("Started a new session", "success")
  }

  // Switch between versions in the active session
  const handleVersionChange = (newIndex) => {
    const session = sessions.find(s => s.id === activeId)
    if (!session) return
    const currentVersions = session.versions || [{ requirements: session.requirements, result: session.result, timestamp: session.id }]
    if (!currentVersions[newIndex]) return

    const updatedSessions = sessions.map(s => {
      if (s.id === activeId) {
        return {
          ...s,
          activeVersionIndex: newIndex,
          requirements: currentVersions[newIndex].requirements,
          result: currentVersions[newIndex].result
        }
      }
      return s
    })

    setSessions(updatedSessions)
    
    // Update the UI state
    const target = currentVersions[newIndex]
    setRequirements(target.requirements)
    setResult(target.result)
    setError("")
    setForceShowRaw(false)
    setActiveEditId(null)
    setSelectedCategory("all")
  }

  // Phase 4.7 Clickable Traceability Links
  const handleTraceClick = (traceId) => {
    if (!traceId) return;
    const textarea = document.getElementById("requirements-input");
    if (!textarea) return;

    const text = textarea.value;
    const reqNum = traceId.replace(/[^0-9]/g, "");
    if (!reqNum) return;

    const patterns = [
      new RegExp(`(?:^|\\n)\\s*${reqNum}\\s*[\\.\\)]`, "i"),
      new RegExp(`(?:^|\\n)\\s*REQ-?${reqNum}\\b`, "i")
    ];

    let match = null;
    for (const pattern of patterns) {
      match = text.match(pattern);
      if (match) break;
    }

    if (match && match.index !== undefined) {
      const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
      let end = text.indexOf("\n", start);
      if (end === -1) end = text.length;

      textarea.focus();
      textarea.setSelectionRange(start, end);
      addToast(`Highlighted requirement: ${traceId}`, "info");
    } else {
      addToast(`Could not locate requirement line for ${traceId}`, "info");
    }
  };

  // Phase 5 Conversational Refinement
  const handleRefine = async (customPromptText) => {
    const promptToSend = (customPromptText || refinementPrompt).trim()
    if (!promptToSend || !activeId || !activeSession) return

    setRefineLoading(true)
    setError("")
    setActiveEditId(null)
    
    const currentVersions = activeSession.versions || [{ requirements: activeSession.requirements, result: activeSession.result, timestamp: activeSession.id }]
    const activeVer = currentVersions[activeVersionIdx] || currentVersions[0]
    
    const existingMessages = activeVer.messages || [
      { role: "user", content: `Generate Gherkin acceptance tests for these requirements:\n\n${activeSession.requirements}` },
      { role: "assistant", content: activeSession.result }
    ]

    const updatedMessages = [
      ...existingMessages,
      { role: "user", content: promptToSend }
    ]

    try {
      const res = await fetch(`${API_BASE}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()

      const completeMessages = [
        ...updatedMessages,
        { role: "assistant", content: data.result }
      ]

      const updatedSessions = sessions.map(s => {
        if (s.id === activeId) {
          const nextVersions = [
            ...currentVersions,
            {
              requirements: activeSession.requirements,
              result: data.result,
              timestamp: Date.now(),
              versionType: customPromptText ? "quick-action" : "refinement",
              messages: completeMessages
            }
          ]
          const nextIndex = nextVersions.length - 1

          return {
            ...s,
            result: data.result,
            versions: nextVersions,
            activeVersionIndex: nextIndex
          }
        }
        return s
      })

      setSessions(updatedSessions)
      setResult(data.result)
      setRefinementPrompt("")
      setSelectedCategory("all")
      addToast("Scenarios refined!", "success")
    } catch {
      setError("Could not reach backend for refinement. Verify port 8000 is active.")
      addToast("Refinement failed", "error")
    } finally {
      setRefineLoading(false)
    }
  }

  const handleAnalyze = async () => {
    const rawInput = requirements.trim()
    if (!rawInput) return
    const sanitized = sanitizeInput(rawInput)
    setAnalyzeLoading(true)
    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: sanitized }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)
      setQualityAnalysis(data)
      setDismissedWarningIds([])
      setAcknowledgedWarningIds([])
      setSelectedWarningIds((data.warnings || []).map(w => w.id))
      setQualityPanelOpen(true)
      if (activeId) {
        setSessions(prev => prev.map(s =>
          s.id === activeId ? { ...s, qualityAnalysis: data } : s
        ))
      }
      addToast(`Quality score: ${data.qualityScore}/100`, "info")
    } catch (err) {
      addToast(err.message || "Analysis failed", "error")
    } finally {
      setAnalyzeLoading(false)
    }
  }

  const dismissWarning = (id) => {
    setDismissedWarningIds(prev => [...prev, id])
    setSelectedWarningIds(prev => prev.filter(x => x !== id))
  }

  const acknowledgeWarning = (id) => {
    setAcknowledgedWarningIds(prev => [...prev, id])
    setDismissedWarningIds(prev => [...prev, id])
    setSelectedWarningIds(prev => prev.filter(x => x !== id))
  }

  const toggleWarningSelection = (id) => {
    setSelectedWarningIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleImproveFromWarnings = async () => {
    if (!qualityAnalysis?.warnings?.length) {
      addToast("Run Analyze Requirements first", "error")
      return
    }
    const activeWarnings = (qualityAnalysis.warnings || []).filter(
      w => !dismissedWarningIds.includes(w.id) && !acknowledgedWarningIds.includes(w.id)
    )
    const warningsToFix = activeWarnings.filter(w => selectedWarningIds.includes(w.id))
    if (warningsToFix.length === 0) {
      addToast("Select at least one warning to apply", "info")
      return
    }

    const sanitized = sanitizeInput(requirements.trim())
    if (!sanitized) return

    setImproveLoading(true)
    setPreviousRequirements(sanitized)
    try {
      const res = await fetch(`${API_BASE}/improve-requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: sanitized, warnings: warningsToFix }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)

      const improved = sanitizeInput(data.requirements)
      const appliedIds = new Set(warningsToFix.map(w => w.id))
      setRequirements(improved)
      setQualityAnalysis(prev => {
        if (!prev) return prev
        const remaining = (prev.warnings || []).filter(w => !appliedIds.has(w.id))
        return { ...prev, warnings: remaining }
      })
      setSelectedWarningIds(prev => prev.filter(id => !appliedIds.has(id)))
      addToast(
        `Applied ${warningsToFix.length} selected suggestion(s). Re-run Analyze to refresh the score.`,
        "success"
      )
    } catch (err) {
      addToast(err.message || "Could not improve requirements", "error")
    } finally {
      setImproveLoading(false)
    }
  }

  const handleClearInput = () => {
    if (!requirements.trim()) return
    setRequirements("")
    setQualityAnalysis(null)
    setSelectedWarningIds([])
    setDismissedWarningIds([])
    setAcknowledgedWarningIds([])
    addToast("Requirement input cleared", "info")
  }

  const loadDemoRequirements = async () => {
    try {
      const res = await fetch("/demo/demo-requirements.txt")
      const text = await res.text()
      setRequirements(text)
      setQualityAnalysis(null)
      addToast("Demo requirements loaded", "success")
    } catch {
      addToast("Could not load demo file", "error")
    }
  }

  const runChangeImpact = async () => {
    if (!previousRequirements.trim() || !requirements.trim()) {
      addToast("Need both previous and current requirements", "error")
      return
    }
    try {
      const res = await fetch(`${API_BASE}/change-impact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldRequirements: sanitizeInput(previousRequirements),
          newRequirements: sanitizeInput(requirements),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Change-impact failed")
      setChangeImpactResult(data)
      setChangeImpactOpen(true)
    } catch (err) {
      addToast(err.message || "Change-impact failed", "error")
    }
  }

  const persistGeneratedResult = (sanitized, generatedText) => {
    setResult(generatedText)
    if (activeId === null) {
      const newSession = {
        id: Date.now(),
        reqNumber: sessions.length + 1,
        title: sessionTitle(sanitized, sessions.length),
        requirements: sanitized,
        result: generatedText,
        qualityAnalysis,
        versions: [{
          requirements: sanitized,
          result: generatedText,
          timestamp: Date.now(),
          messages: [
            { role: "user", content: `Generate Gherkin acceptance tests for these requirements:\n\n${sanitized}` },
            { role: "assistant", content: generatedText },
          ],
        }],
        activeVersionIndex: 0,
      }
      setSessions(prev => [newSession, ...prev])
      setActiveId(newSession.id)
      setSidebarOpen(true)
      addToast("Tests generated!", "success")
    } else {
      const updatedSessions = sessions.map(s => {
        if (s.id !== activeId) return s
        const currentVersions = s.versions || [{ requirements: s.requirements, result: s.result, timestamp: s.id }]
        const newVersion = {
          requirements: sanitized,
          result: generatedText,
          timestamp: Date.now(),
          messages: [
            { role: "user", content: `Generate Gherkin acceptance tests for these requirements:\n\n${sanitized}` },
            { role: "assistant", content: generatedText },
          ],
        }
        const nextVersions = [...currentVersions, newVersion]
        return {
          ...s,
          title: sessionTitle(sanitized, sessions.indexOf(s)),
          requirements: sanitized,
          result: generatedText,
          qualityAnalysis,
          versions: nextVersions,
          activeVersionIndex: nextVersions.length - 1,
        }
      })
      setSessions(updatedSessions)
      addToast("Updated session with new version!", "success")
    }
  }

  const handleGenerate = async () => {
    const rawInput = requirements.trim()
    if (!rawInput) return

    const sanitized = sanitizeInput(rawInput)
    if (!sanitized) {
      addToast("Input is invalid after sanitization", "error")
      return
    }

    setRequirements(sanitized)
    setForceShowRaw(false)
    setActiveEditId(null)
    setSelectedCategory("all")
    setRightPanelView("scenarios")
    setDiffViewOpen(false)
    setLoading(true)
    setError("")
    setResult("")

    try {
      let generatedText = ""

      if (useStreaming) {
        const res = await fetch(`${API_BASE}/generate/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirements: sanitized }),
        })
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split("\n\n")
          buffer = parts.pop() || ""
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith("data:")) continue
            const payload = JSON.parse(line.slice(5).trim())
            if (payload.error) throw new Error(payload.error)
            if (payload.token) {
              generatedText += payload.token
              setResult(generatedText)
            }
          }
        }
        generatedText = generatedText.replace(/```[\s\S]*?```/g, "").trim()
      } else {
        const res = await fetch(`${API_BASE}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirements: sanitized }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)
        generatedText = data.result
      }

      persistGeneratedResult(sanitized, generatedText)
    } catch (err) {
      setError(err.message || "Could not reach the backend. Make sure it's running on port 8000.")
      addToast("Generation failed", "error")
    } finally {
      setLoading(false)
    }
  }

  // Load a session
  const loadSession = (session) => {
    const initializedVersions = session.versions || [{ requirements: session.requirements, result: session.result, timestamp: session.id }]
    const initializedIndex = session.activeVersionIndex !== undefined ? session.activeVersionIndex : 0
    const target = initializedVersions[initializedIndex] || initializedVersions[0]

    setRequirements(target.requirements)
    setResult(target.result)
    const qa = session.qualityAnalysis || null
    setQualityAnalysis(qa)
    setSelectedWarningIds(qa?.warnings?.map(w => w.id) || [])
    setError("")
    setForceShowRaw(false)
    setActiveEditId(null)
    setSelectedCategory("all")
    setRightPanelView("scenarios")
    setDiffViewOpen(false)
    setActiveId(session.id)
  }

  // Delete a session
  const deleteSession = (e, id) => {
    e.stopPropagation()
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id)
      if (activeId === id) {
        if (updated.length > 0) {
          const first = updated[0]
          const initVersions = first.versions || [{ requirements: first.requirements, result: first.result, timestamp: first.id }]
          const idx = first.activeVersionIndex !== undefined ? first.activeVersionIndex : 0
          const tgt = initVersions[idx] || initVersions[0]
          setRequirements(tgt.requirements)
          setResult(tgt.result)
          setError("")
          setActiveId(first.id)
        } else {
          setRequirements("")
          setResult("")
          setActiveId(null)
        }
      }
      return updated
    })
  }

  // File upload (.txt, .md, .docx)
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const ext = file.name.split(".").pop().toLowerCase()
    
    // Strict format validation
    const allowed = ["txt", "md", "docx"]
    if (!allowed.includes(ext)) {
      addToast(`Format .${ext} is not supported! Only .txt, .md, .docx allowed`, "error")
      e.target.value = ""
      return
    }
    
    try {
      if (ext === "txt" || ext === "md") {
        const text = await file.text()
        if (!text.trim()) {
          addToast("Selected file is empty", "error")
          return
        }
        setRequirements(text)
        addToast(`Successfully loaded: ${file.name}`, "success")
      } else if (ext === "docx") {
        const buf = await file.arrayBuffer()
        const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
        if (!value.trim()) {
          addToast("Selected file contains no readable text", "error")
          return
        }
        setRequirements(value)
        addToast(`Successfully loaded: ${file.name}`, "success")
      }
    } catch (err) {
      console.error("File upload error:", err)
      addToast("Failed to read file", "error")
    }
    
    // Clear value to allow re-uploading the same file
    e.target.value = ""
  }

  // Copy all
  const handleCopy = async () => {
    await navigator.clipboard.writeText(result)
    setCopied(true)
    addToast("Copied to clipboard!", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  // Export .feature
  const handleExport = () => {
    setExportScope("current")
    setExportOpen(true)
  }

  // Parse Gherkin scenario titles (8.4)
  const extractScenarios = (gherkinText) => {
    if (!gherkinText) return []
    const matches = []
    const lines = gherkinText.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("Scenario:") || trimmed.startsWith("Scenario Outline:")) {
        matches.push(trimmed.replace(/^Scenario:\s*/, "").replace(/^Scenario Outline:\s*/, "").trim())
      }
    }
    return matches
  }

  // Generate HTML for PDF/Word exports (8.2 / 8.3 / 8.4 / 8.6)
  /* eslint-disable-next-line no-unused-vars */
  const generateExportHTML = (targetSessions, _mode) => {
    // Generate Traceability Matrix rows
    let matrixRows = ""
    targetSessions.forEach((s, sIdx) => {
      const scenarios = extractScenarios(s.result)
      if (scenarios.length === 0) {
        matrixRows += `
          <tr>
            <td><strong>REQ-${sIdx + 1}:</strong> ${s.title}</td>
            <td><em>No scenarios generated</em></td>
            <td><span class="status-badge status-uncovered">Uncovered</span></td>
          </tr>
        `
      } else {
        scenarios.forEach((sc, scIdx) => {
          matrixRows += `
            <tr>
              ${scIdx === 0 ? `<td rowspan="${scenarios.length}"><strong>REQ-${sIdx + 1}:</strong> ${s.title}</td>` : ""}
              <td>${sc}</td>
              ${scIdx === 0 ? `<td rowspan="${scenarios.length}"><span class="status-badge status-covered">Covered</span></td>` : ""}
            </tr>
          `
        })
      }
    })

    const title = exportScope === "current" ? "Single Requirement Report" : "All Requirements Batch Report"

    // Construct full HTML string
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>TestGPT Export - ${title}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@500;700&family=JetBrains+Mono&display=swap');
          
          body {
            font-family: 'DM Sans', -apple-system, sans-serif;
            color: #1F2937;
            line-height: 1.6;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
            background-color: #FFFFFF;
          }
          
          h1 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 26px;
            font-weight: 700;
            color: #C8445D; /* Theme Warm Peach accent */
            border-bottom: 2px solid #FEF0EC;
            padding-bottom: 12px;
            margin-bottom: 24px;
          }
          
          h2 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 18px;
            font-weight: 700;
            color: #111827;
            margin-top: 32px;
            margin-bottom: 16px;
          }

          h3 {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #4B5563;
            margin-top: 24px;
            margin-bottom: 8px;
          }
          
          .meta-box {
            background-color: #FEF0EC;
            border: 1px solid rgba(200, 68, 93, 0.1);
            padding: 16px 20px;
            border-radius: 8px;
            font-size: 13.5px;
            color: #5C5F66;
            margin-bottom: 32px;
          }
          
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 16px;
          }
          
          .meta-item strong {
            color: #111827;
          }
          
          .req-section {
            border: 1px solid #E5E7EB;
            padding: 24px;
            border-radius: 10px;
            margin-bottom: 28px;
            background-color: #FAFAFA;
            page-break-inside: avoid;
          }

          .req-title {
            font-size: 16px;
            font-weight: 700;
            color: #C8445D;
            margin-bottom: 12px;
          }
          
          .source-box {
            background-color: #F3F4F6;
            border-left: 3px solid #D1D5DB;
            padding: 12px 16px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            color: #374151;
            margin-bottom: 20px;
            border-radius: 0 6px 6px 0;
          }

          .gherkin-box {
            background-color: #1E1E1E;
            color: #D4D4D4;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12.5px;
            padding: 20px;
            border-radius: 8px;
            white-space: pre-wrap;
            line-height: 1.6;
            margin-top: 12px;
            border: 1px solid #2D2D2D;
          }

          /* Traceability Matrix Table */
          .trace-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
            margin-bottom: 32px;
            page-break-inside: avoid;
          }
          
          .trace-table th, .trace-table td {
            border: 1px solid #E5E7EB;
            padding: 10px 12px;
            font-size: 13px;
            text-align: left;
          }
          
          .trace-table th {
            background-color: #F9FAFB;
            font-weight: 700;
            color: #374151;
          }
          
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .status-covered {
            background-color: #ECFDF5;
            color: #047857;
          }
          
          .status-uncovered {
            background-color: #FEF2F2;
            color: #B91C1C;
          }

          .footer-note {
            text-align: center;
            font-size: 11px;
            color: #9CA3AF;
            margin-top: 60px;
            border-top: 1px solid #F3F4F6;
            padding-top: 16px;
          }

          @media print {
            body {
              padding: 20px;
              font-size: 12pt;
            }
            .no-print {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <h1>TestGPT Acceptance Scenarios Report</h1>
        
        ${includeMetadata ? `
          <div class="meta-box">
            <div class="meta-grid">
              <div class="meta-item"><strong>Project Name:</strong> TestGPT</div>
              <div class="meta-item"><strong>Export Date:</strong> ${new Date().toLocaleDateString()}</div>
              <div class="meta-item"><strong>Export Time:</strong> ${new Date().toLocaleTimeString()}</div>
              <div class="meta-item"><strong>Total Scenarios:</strong> ${targetSessions.reduce((acc, s) => acc + extractScenarios(s.result).length, 0)}</div>
            </div>
          </div>
        ` : ""}

        ${includeAmbiguityWarnings && qualityAnalysis?.warnings?.length ? `
          <h2>Requirement Quality Warnings</h2>
          <p><strong>Quality score:</strong> ${qualityAnalysis.qualityScore}/100 — ${qualityAnalysis.summary || ""}</p>
          <ul>
            ${qualityAnalysis.warnings.map(w => `<li><strong>${w.type}</strong> (${w.severity}): ${w.message} — ${w.suggestion || ""}</li>`).join("")}
          </ul>
        ` : ""}

        ${includeTraceability ? `
          <h2>Requirement Traceability Matrix</h2>
          <table class="trace-table">
            <thead>
              <tr>
                <th style="width: 35%">Requirement Source</th>
                <th style="width: 45%">Generated Scenario</th>
                <th style="width: 20%">Status</th>
              </tr>
            </thead>
            <tbody>
              ${matrixRows}
            </tbody>
          </table>
        ` : ""}

        <h2>Generated Gherkin Scenarios</h2>
        
        ${targetSessions.map((s, idx) => `
          <div class="req-section">
            <div class="req-title">REQ-${idx + 1}: ${s.title}</div>
            
            <h3>Source Requirement Girdisi</h3>
            <div class="source-box" style="white-space: pre-wrap; font-family: monospace;">${s.requirements ? s.requirements.replace(/\n/g, "<br/>") : ""}</div>
            
            <h3>Generated Gherkin Tests</h3>
            <div class="gherkin-box" style="white-space: pre-wrap; font-family: monospace; background-color: #1E1E1E; color: #D4D4D4; padding: 15px; border-radius: 6px; border: 1px solid #2D2D2D;">${s.result ? s.result.replace(/\n/g, "<br/>") : ""}</div>
          </div>
        `).join("")}

        <div class="footer-note">
          Generated automatically by TestGPT — BDD acceptance scenario test builder.
        </div>
      </body>
      </html>
    `
  }

  // Trigger the actual file download/printing (8.1 / 8.2 / 8.3 / 8.7)
  const triggerExport = () => {
    // 1. Determine which sessions to export
    const targetSessions = exportScope === "current" 
      ? (activeSession ? [activeSession] : [])
      : sessions;

    if (targetSessions.length === 0) {
      addToast("No sessions found to export", "error")
      return
    }

    if (exportFormat === "feature") {
      // Assemble all Gherkin results
      let outputText = ""
      if (includeMetadata) {
        outputText += `# TestGPT Exported Scenarios\n`
        outputText += `# Generated on: ${new Date().toLocaleString()}\n`
        outputText += `# Total requirements: ${targetSessions.length}\n\n`
      }
      
      targetSessions.forEach((s, idx) => {
        if (includeMetadata) {
          outputText += `# --- REQUIREMENT ${idx + 1}: ${s.title} ---\n`
        }
        outputText += `${s.result}\n\n`
      })

      const blob = new Blob([outputText], { type: "text/plain" })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = `testgpt_export_${Date.now()}.feature`
      a.click()
      URL.revokeObjectURL(url)
      addToast("Exported Gherkin .feature file", "success")
      setExportOpen(false)
    } 
    else if (exportFormat === "pdf") {
      // Generate standard print HTML in a new tab
      const printWindow = window.open("", "_blank")
      if (!printWindow) {
        addToast("Pop-up blocked! Please allow pop-ups for this site.", "error")
        return
      }

      const htmlContent = generateExportHTML(targetSessions, "pdf")
      printWindow.document.write(htmlContent)
      printWindow.document.close()
      
      // Delay slightly for font loading, then print
      setTimeout(() => {
        printWindow.focus()
        printWindow.print()
      }, 500)
      
      addToast("Preparing PDF print document", "success")
      setExportOpen(false)
    } 
    else if (exportFormat === "docx") {
      // Assemble Word-compatible HTML and download as .doc
      const htmlContent = generateExportHTML(targetSessions, "docx")
      const blob = new Blob([htmlContent], { type: "application/msword;charset=utf-8" })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = `testgpt_report_${Date.now()}.doc`
      a.click()
      URL.revokeObjectURL(url)
      
      addToast("Exported Word .doc file", "success")
      setExportOpen(false)
    }
  }

  return (
    <div className="app">
      {/* ── Navbar ── */}
      <nav className="navbar" aria-label="Application controls">
        <div className="navbar-brand">
          {sessions.length > 0 && (
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Toggle session sidebar"
            >
              <span className="sidebar-toggle-icon">{sidebarOpen ? "Hide list" : "Sessions"}</span>
            </button>
          )}
          <span className="navbar-title">TestGPT</span>
          {sessions.length > 0 && (
            <span className="session-count">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        <div className="navbar-actions">
          {result && (
            <>
              <button className="btn btn-ghost" onClick={handleCopy}>
                {copied ? "Copied" : "Copy Gherkin"}
              </button>
              <button className="btn btn-outline" onClick={handleExport}>
                Export
              </button>
            </>
          )}
          <button
            className="btn-theme"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
            aria-pressed={theme === "dark"}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </nav>

      {/* ── Body: sidebar + panels ── */}
      <div className="app-body">

        {/* Collapsible Sidebar */}
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} aria-label="Session history">
          <div className="sidebar-header">
            <span className="sidebar-heading">History</span>
            <button className="btn-new-session" onClick={startNewSession} aria-label="Start new session">
              + New
            </button>
          </div>
          <ul className="sidebar-list">
            {sessions.map((s, sIdx) => (
              <li
                key={s.id}
                className={`sidebar-item ${s.id === activeId ? "sidebar-item-active" : ""}`}
                onClick={() => loadSession(s)}
                role="button"
                tabIndex={0}
                aria-current={s.id === activeId ? "true" : undefined}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && loadSession(s)}
              >
                <span className="sidebar-item-title">REQ-{sessions.length - sIdx}: {s.title}</span>
                <button
                  className="sidebar-item-delete"
                  onClick={e => deleteSession(e, s.id)}
                  aria-label="Delete session"
                  tabIndex={-1}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── Two-panel layout ── */}
        <main className="main-layout">

          {/* Left – Input */}
          <div className="panel panel-input">
            <div className="panel-header">
              <div className="panel-header-title-row">
                <h2>Requirements</h2>
              </div>
              <p className="panel-subtitle" id="requirements-help">Paste requirements, user stories, use cases, or acceptance criteria.</p>
            </div>
            <div className="panel-input-body">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.docx"
                onChange={handleFileUpload}
                style={{ display: "none" }}
                aria-label="Upload requirements file"
              />
              <div className="input-action-bar" aria-label="Requirement actions">
                <div className="input-action-secondary">
                  <button
                    className="btn-upload"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    Upload File
                  </button>
                  <button type="button" className="btn-upload" onClick={loadDemoRequirements}>
                    Load Demo
                  </button>
                  <button
                    type="button"
                    className="btn-upload btn-upload-analyze"
                    onClick={handleAnalyze}
                    disabled={analyzeLoading || !requirements.trim()}
                  >
                    {analyzeLoading ? "Analyzing…" : "Analyze"}
                  </button>
                  <button
                    type="button"
                    className="btn-upload btn-clear-input"
                    onClick={handleClearInput}
                    disabled={!requirements.trim()}
                  >
                    Clear
                  </button>
                </div>
                <button
                  id="generate-btn"
                  className="btn btn-primary input-footer-generate"
                  onClick={handleGenerate}
                  disabled={loading || !requirements.trim()}
                  aria-label="Generate scenarios"
                >
                  {loading
                    ? <span className="btn-loading"><span className="spinner" /> Generating…</span>
                    : "Generate Scenarios"
                  }
                </button>
              </div>

              <label className="field-label" htmlFor="requirements-input">
                Requirement text
              </label>
              <textarea
                id="requirements-input"
                className="requirements-textarea"
                value={requirements}
                onChange={e => setRequirements(e.target.value)}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && requirements.trim() && !loading) {
                    e.preventDefault()
                    handleGenerate()
                  }
                }}
                placeholder={"1. Users must be able to register with email and password.\n2. After registration, a confirmation email should be sent.\n3. Users must be able to log in with their credentials."}
                aria-label="Software requirements input"
                aria-describedby="requirements-help"
              />

            {qualityAnalysis && (() => {
              const scoreClass = qualityAnalysis.qualityScore >= 70 ? "good" : qualityAnalysis.qualityScore >= 40 ? "mid" : "low"
              const activeWarnings = (qualityAnalysis.warnings || []).filter(w => !dismissedWarningIds.includes(w.id))
              const totalWarnings = (qualityAnalysis.warnings || []).length
              const selectedCount = activeWarnings.filter(w => selectedWarningIds.includes(w.id)).length
              const majorWarnings = activeWarnings.filter(isMajorWarning)
              const otherWarnings = activeWarnings.filter(w => !isMajorWarning(w))

              const renderWarningItem = (w) => {
                const isSelected = selectedWarningIds.includes(w.id)
                return (
                  <li
                    key={w.id}
                    className={`quality-warning quality-severity-${w.severity} ${isMajorWarning(w) ? "quality-warning-major" : ""} ${isSelected ? "quality-warning-selected" : ""}`}
                  >
                    <label className="quality-warning-select-row">
                      <input
                        type="checkbox"
                        className="quality-warning-checkbox"
                        checked={isSelected}
                        onChange={() => toggleWarningSelection(w.id)}
                        aria-label={`Apply suggestion for ${warningTypeLabel(w.type)}`}
                      />
                      <span className="quality-apply-label">Apply this suggestion</span>
                    </label>
                    <div className="quality-warning-top">
                      <span className={`quality-type-pill quality-type-${w.type}`}>
                        {warningTypeLabel(w.type)}
                      </span>
                      <span className={`quality-severity-pill severity-${w.severity}`}>
                        {w.severity}
                      </span>
                      {w.requirementRef && (
                        <span className="quality-warning-ref">{w.requirementRef}</span>
                      )}
                    </div>
                    <p className="quality-warning-msg">{w.message}</p>
                    {w.suggestion && (
                      <p className="quality-warning-suggestion">
                        <strong>Suggestion:</strong> {w.suggestion}
                      </p>
                    )}
                    <div className="quality-warning-actions">
                      <button
                        type="button"
                        className="btn-quality-action btn-quality-ack"
                        onClick={() => acknowledgeWarning(w.id)}
                      >
                        Acknowledge
                      </button>
                      <button
                        type="button"
                        className="btn-quality-action btn-quality-dismiss"
                        onClick={() => dismissWarning(w.id)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                )
              }

              return (
                <section
                  className={`quality-panel ${qualityPanelOpen ? "is-open" : "is-collapsed"}`}
                  aria-label="Requirement issues"
                >
                  <button
                    type="button"
                    className="quality-panel-toggle"
                    onClick={() => setQualityPanelOpen(open => !open)}
                    aria-expanded={qualityPanelOpen}
                  >
                    <span className="quality-panel-toggle-main">
                      <span className={`quality-chevron ${qualityPanelOpen ? "is-open" : ""}`} aria-hidden="true" />
                      <span className="quality-panel-title">Requirement Issues</span>
                      {majorWarnings.length > 0 && (
                        <span className="quality-major-count">{majorWarnings.length} review first</span>
                      )}
                      {activeWarnings.length > 0 ? (
                        <span className="quality-count-badge">{activeWarnings.length} active</span>
                      ) : totalWarnings > 0 ? (
                        <span className="quality-count-badge quality-count-resolved">All reviewed</span>
                      ) : (
                        <span className="quality-count-badge quality-count-clear">No issues</span>
                      )}
                    </span>
                    <span className={`quality-score quality-score-${scoreClass}`}>
                      {qualityAnalysis.qualityScore}/100
                    </span>
                  </button>

                  {qualityPanelOpen && (
                    <div className="quality-panel-body">
                      {activeWarnings.length > 0 && (
                        <div className="quality-panel-actions">
                          <div className="quality-select-toolbar">
                            <span className="quality-select-label">
                              {selectedCount} of {activeWarnings.length} selected for apply
                            </span>
                            <button
                              type="button"
                              className="btn-quality-link"
                              onClick={() => setSelectedWarningIds(activeWarnings.map(w => w.id))}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="btn-quality-link"
                              onClick={() => setSelectedWarningIds([])}
                            >
                              Clear
                            </button>
                          </div>
                          <button
                            type="button"
                            className="btn-improve-requirements"
                            onClick={handleImproveFromWarnings}
                            disabled={improveLoading || analyzeLoading || !requirements.trim() || selectedCount === 0}
                          >
                            {improveLoading
                              ? "Updating requirements…"
                              : `Apply selected (${selectedCount}) and update requirements`}
                          </button>
                          <p className="quality-improve-hint">
                            Select the issues to fix, then apply. Unselected issues remain in the list.
                          </p>
                        </div>
                      )}

                      {qualityAnalysis.summary && (
                        <p className="quality-summary">{qualityAnalysis.summary}</p>
                      )}

                      {acknowledgedWarningIds.length > 0 && (
                        <p className="quality-ack-note">
                          {acknowledgedWarningIds.length} warning(s) acknowledged
                        </p>
                      )}

                      {activeWarnings.length === 0 ? (
                        <div className="quality-empty">
                          {totalWarnings === 0
                            ? "No quality issues detected for these requirements."
                            : "All warnings were dismissed or acknowledged."}
                        </div>
                      ) : (
                        <>
                          {majorWarnings.length > 0 && (
                            <div className="quality-issues-section">
                              <h4 className="quality-issues-heading">Review first</h4>
                              <p className="quality-issues-desc">
                                Issue types that can block reliable test design. The severity pill still shows low, medium, or high impact.
                              </p>
                              <ul className="quality-warnings-list">
                                {majorWarnings.map(renderWarningItem)}
                              </ul>
                            </div>
                          )}
                          {otherWarnings.length > 0 && (
                            <div className="quality-issues-section">
                              <h4 className="quality-issues-heading">Other issues</h4>
                              <ul className="quality-warnings-list">
                                {otherWarnings.map(renderWarningItem)}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </section>
              )
            })()}
            </div>

            <div className="input-footer">
              <div className="input-footer-meta">
                <label className="streaming-toggle">
                  <input type="checkbox" checked={useStreaming} onChange={e => setUseStreaming(e.target.checked)} />
                  Stream output while generating
                </label>
                <span className="upload-tip">.txt, .md, .docx</span>
                <span className="char-count">{requirements.length} chars</span>
              </div>
            </div>
          </div>

          {/* Right – Output */}
          <div className="panel panel-output">
            <div className="panel-header">
              <div className="panel-header-title-row">
                <h2>
                  {rightPanelView === "coverage"
                    ? "Coverage Summary"
                    : rightPanelView === "matrix"
                      ? "Traceability Matrix"
                      : "Generated Scenarios"}
                </h2>
                {result && (
                  <div className="panel-header-tools">
                    <div className="view-toggle-row">
                      <button
                        type="button"
                        className={`btn-view-tab ${rightPanelView === "scenarios" ? "active" : ""}`}
                        onClick={() => setRightPanelView("scenarios")}
                        aria-pressed={rightPanelView === "scenarios"}
                      >
                        Scenarios
                      </button>
                      <button
                        type="button"
                        className={`btn-view-tab ${rightPanelView === "coverage" ? "active" : ""}`}
                        onClick={() => setRightPanelView("coverage")}
                        aria-pressed={rightPanelView === "coverage"}
                      >
                        Coverage
                      </button>
                      <button
                        type="button"
                        className={`btn-view-tab ${rightPanelView === "matrix" ? "active" : ""}`}
                        onClick={() => setRightPanelView("matrix")}
                        aria-pressed={rightPanelView === "matrix"}
                      >
                        Matrix
                      </button>
                    </div>
                    {rightPanelView === "scenarios" && (
                      <div className="output-header-actions">
                        {activeSession && activeSession.versions && activeSession.versions.length > 1 && (
                          <div className="version-switcher">
                            <button
                              className="btn-version"
                              disabled={activeVersionIdx === 0}
                              onClick={() => handleVersionChange(activeVersionIdx - 1)}
                              aria-label="Previous version"
                            >
                              Prev
                            </button>
                            <span className="version-text">
                              Version {activeVersionIdx + 1}/{totalVersions}
                            </span>
                            <button
                              className="btn-version"
                              disabled={activeVersionIdx === totalVersions - 1}
                              onClick={() => handleVersionChange(activeVersionIdx + 1)}
                              aria-label="Next version"
                            >
                              Next
                            </button>
                            <button
                              type="button"
                              className={`btn-diff-toggle ${diffViewOpen ? "active" : ""}`}
                              onClick={() => setDiffViewOpen(o => !o)}
                              title="Compare with the first generated version"
                            >
                              {diffViewOpen ? "Hide diff" : "Diff"}
                            </button>
                          </div>
                        )}
                        <button
                          className="btn-regenerate-badge"
                          onClick={handleGenerate}
                          disabled={loading}
                          title="Regenerate all scenarios for this requirement"
                        >
                          Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {(requirements.trim() || previousRequirements) && (
                <div className="panel-header-actions-row">
                  {requirements.trim() && (
                    <button type="button" className="btn btn-ghost btn-sm change-impact-btn" onClick={() => {
                      setPreviousRequirements(requirements)
                      addToast("Snapshot saved. Edit requirements, then run Change Impact.", "info")
                    }}>
                      Snapshot for Change Impact
                    </button>
                  )}
                  {previousRequirements && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={runChangeImpact}>
                      Run Change Impact
                    </button>
                  )}
                </div>
              )}
              <p className="panel-subtitle">
                {rightPanelView === "coverage"
                  ? "Per-requirement scenario coverage by flow type"
                  : rightPanelView === "matrix"
                    ? "Requirement-to-scenario traceability"
                    : "Gherkin acceptance test scenarios"}
              </p>
            </div>
            <div className="output-content">
              {loading && <Skeleton />}
              <div className="sr-only" role="status" aria-live="polite">
                {loading ? "Generating scenarios" : error ? `Error: ${error}` : result ? "Scenarios ready" : "No scenarios generated"}
              </div>

              {error && !loading && (
                <div className="error-state">
                  <p className="error-message">{error}</p>
                  <button type="button" className="btn btn-outline" onClick={handleGenerate}>Try again</button>
                </div>
              )}

              {!loading && !error && !result && (
                <div className="empty-state">
                  <h3>No scenarios generated yet</h3>
                  <p>Enter a requirement and select <strong>Generate Scenarios</strong> to begin.</p>
                </div>
              )}

              {result && !loading && rightPanelView === "coverage" && (
                <div className="coverage-summary-container">
                  <p className="coverage-summary-legend">
                    Status per flow type: Complete (has scenario), Partial (other scenarios exist), Not covered (none).
                    Overall uses all four flow types for the requirement.
                  </p>
                  <div className="coverage-summary-scroll">
                    <table className="coverage-summary-table">
                      <thead>
                        <tr>
                          <th>Requirement</th>
                          <th>Overall</th>
                          {COVERAGE_FLOW_TYPES.map((f) => (
                            <th key={f.id}>{f.short}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {buildCoverageSummary(requirements, result).map((row) => (
                          <tr key={row.requirement.id}>
                            <td className="coverage-req-cell">
                              <button
                                type="button"
                                className="trace-req-link"
                                onClick={() => handleTraceClick(row.requirement.id)}
                              >
                                {row.requirement.id}
                              </button>
                              <span className="trace-req-text">
                                {row.requirement.text?.slice(0, 60)}
                                {(row.requirement.text?.length || 0) > 60 ? "…" : ""}
                              </span>
                            </td>
                            <td>
                              <span className={`cov-status cov-status-${row.overall}`}>
                                {coverageStatusLabel(row.overall)}
                              </span>
                            </td>
                            {COVERAGE_FLOW_TYPES.map((f) => (
                              <td key={f.id}>
                                <span className={`cov-status cov-status-${row.byType[f.id]}`}>
                                  {coverageStatusLabel(row.byType[f.id])}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result && !loading && rightPanelView === "matrix" && (
                <div className="trace-matrix-container">
                  <table className="trace-matrix-table">
                    <thead>
                      <tr>
                        <th>Requirement</th>
                        <th>Scenarios</th>
                        <th>Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buildCoverageMatrix(requirements, result).map(row => (
                        <tr key={row.requirement.id} className={row.covered ? "trace-row-covered" : "trace-row-uncovered"}>
                          <td>
                            <button
                              type="button"
                              className="trace-req-link"
                              onClick={() => handleTraceClick(row.requirement.id)}
                            >
                              {row.requirement.id}
                            </button>
                            <span className="trace-req-text">{row.requirement.text?.slice(0, 80)}{(row.requirement.text?.length || 0) > 80 ? "…" : ""}</span>
                          </td>
                          <td>
                            {row.scenarios.length === 0 ? (
                              <em className="trace-none">No scenarios</em>
                            ) : (
                              <ul className="trace-scenario-list">
                                {row.scenarios.map(sc => (
                                  <li key={sc.id}>{sc.title}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td>
                            <span className={`coverage-badge ${row.covered ? "coverage-covered" : "coverage-uncovered"}`}>
                              {row.covered ? "Covered" : "Uncovered"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result && !loading && rightPanelView === "scenarios" && (
                !isValidGherkin(result) && !forceShowRaw ? (
                  <div className="malformed-warning">
                    <div className="malformed-warning-title">Malformed response detected</div>
                    <p className="malformed-warning-text">
                      The output does not conform to standard Gherkin syntax. It may contain plain text or an incomplete response. Regenerate scenarios or review the raw output.
                    </p>
                    <div className="malformed-warning-actions">
                      <button type="button" className="btn btn-primary" onClick={handleGenerate}>
                        Regenerate scenarios
                      </button>
                      <button type="button" className="btn btn-outline" onClick={() => setForceShowRaw(true)}>
                        Show raw output
                      </button>
                    </div>
                  </div>
                ) : (
                  forceShowRaw ? (
                    <GherkinBlock text={result} />
                  ) : (
                    (() => {
                      const { scenarios } = parseGherkin(result);
                      const filteredScenarios = scenarios.filter(sc => 
                        selectedCategory === "all" || sc.type === selectedCategory
                      );
                      const activeIndex = sessions.findIndex(s => Number(s.id) === Number(activeId));
                      const currentSession = sessions[activeIndex];
                      const reqIndex = activeIndex !== -1 ? sessions.length - activeIndex : 1;
                      
                      const countType = (type) => scenarios.filter(sc => sc.type === type).length;

                      const handleTextareaChange = (e) => {
                        const val = e.target.value;
                        setRefinementPrompt(val);

                        const cursor = e.target.selectionStart;
                        const lastAtIdx = val.lastIndexOf("@", cursor - 1);
                        if (lastAtIdx !== -1) {
                          const textAfterAt = val.slice(lastAtIdx + 1, cursor);
                          if (!/\s/.test(textAfterAt)) {
                            const filtered = scenarios.map((sc, idx) => ({
                              index: idx + 1,
                              title: sc.title
                            })).filter(sc => {
                              if (!textAfterAt) return true;
                              return sc.index.toString().includes(textAfterAt) || 
                                     sc.title.toLowerCase().includes(textAfterAt.toLowerCase());
                            });

                            setSuggestions(filtered);
                            setShowSuggestions(filtered.length > 0);
                            setSuggestionIdx(0);
                            return;
                          }
                        }
                        setShowSuggestions(false);
                      };

                      const selectSuggestion = (scIndex) => {
                        const textarea = document.getElementById("refinement-chat-input");
                        if (!textarea) return;

                        const text = refinementPrompt;
                        const cursor = textarea.selectionStart;
                        const lastAtIdx = text.lastIndexOf("@", cursor - 1);
                        if (lastAtIdx !== -1) {
                          const before = text.slice(0, lastAtIdx);
                          const after = text.slice(cursor);
                          const replacement = `@${scIndex} `;
                          const newText = before + replacement + after;

                          setRefinementPrompt(newText);
                          setShowSuggestions(false);

                          setTimeout(() => {
                            textarea.focus();
                            const newPos = lastAtIdx + replacement.length;
                            textarea.setSelectionRange(newPos, newPos);
                          }, 50);
                        }
                      };

                      const handleTextareaKeyDown = (e) => {
                        if (showSuggestions && suggestions.length > 0) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setSuggestionIdx(idx => (idx + 1) % suggestions.length);
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setSuggestionIdx(idx => (idx - 1 + suggestions.length) % suggestions.length);
                          } else if (e.key === "Enter" || e.key === "Tab") {
                            e.preventDefault();
                            selectSuggestion(suggestions[suggestionIdx].index);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setShowSuggestions(false);
                          }
                        }
                      };

                      if (diffViewOpen) {
                        const originalText = currentSession?.versions?.[0]?.result || "";
                        const currentText = result || "";
                        const diffLines = computeLineDiff(originalText, currentText);

                        return (
                          <div className="scenarios-container diff-container">
                            <div className="diff-view-heading">
                              Comparing version 1 with version {activeVersionIdx + 1}
                            </div>
                            <div className="diff-lines-list">
                              <pre className="diff-pre">
                                {diffLines.map((line, idx) => (
                                  <div key={idx} className={`diff-line diff-line-${line.type}`}>
                                    <span className="diff-line-marker">
                                      {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                                    </span>
                                    <span className="diff-line-text">{line.text || " "}</span>
                                  </div>
                                ))}
                              </pre>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="scenarios-container">
                          {/* Category Filter Tabs */}
                          <div className="scenarios-filter-tabs">
                            {[
                              { id: "all", label: `All (${scenarios.length})` },
                              { id: "happy-path", label: `Happy Path (${countType("happy-path")})` },
                              { id: "alternative-flow", label: `Alternative (${countType("alternative-flow")})` },
                              { id: "edge-case", label: `Edge Cases (${countType("edge-case")})` },
                              { id: "negative", label: `Negative (${countType("negative")})` }
                            ].map(tab => (
                              <button
                                key={tab.id}
                                className={`filter-tab-btn filter-tab-${tab.id} ${selectedCategory === tab.id ? "active" : ""}`}
                                onClick={() => setSelectedCategory(tab.id)}
                                aria-pressed={selectedCategory === tab.id}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          {/* Phase 5.2 & 5.3 Conversational Refinement Chat Interface */}
                          <div className="refinement-chat-container">
                            <div className="refinement-chat-header">
                              <label className="field-label" htmlFor="refinement-chat-input">
                                Scenario refinement
                              </label>
                              <button className="btn btn-outline btn-add-scenario btn-add-scenario-inline" onClick={handleAddScenario}>
                                + Add Custom Scenario
                              </button>
                            </div>
                            <p className="refinement-chat-sub" id="refinement-chat-desc">
                              Request changes to specific scenarios using @1, @2, or scenario titles.
                            </p>
                            
                            {showSuggestions && suggestions.length > 0 && (
                              <div className="chat-autocomplete-dropdown" role="listbox" aria-label="Scenario suggestions">
                                {suggestions.map((s, idx) => (
                                  <div
                                    key={s.index}
                                    role="option"
                                    aria-selected={idx === suggestionIdx}
                                    className={`chat-autocomplete-item ${idx === suggestionIdx ? "active" : ""}`}
                                    onClick={() => selectSuggestion(s.index)}
                                  >
                                    <span className="autocomplete-badge">@{s.index}</span>
                                    <span className="autocomplete-title">{s.title}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="refinement-chat-input-row">
                              <textarea
                                id="refinement-chat-input"
                                className="refinement-chat-textarea"
                                value={refinementPrompt}
                                onChange={handleTextareaChange}
                                onKeyDown={handleTextareaKeyDown}
                                onBlur={() => {
                                  // Delay closing dropdown slightly so click events on items can fire
                                  setTimeout(() => setShowSuggestions(false), 250);
                                }}
                                placeholder="e.g. Make @1 cover duplicate emails, or add a Given step for user roles on scenario 3"
                                rows={2}
                                disabled={refineLoading}
                                aria-describedby="refinement-chat-desc"
                              />
                              <button 
                                type="button"
                                className="btn btn-primary btn-refine-send" 
                                onClick={() => handleRefine()}
                                disabled={refineLoading || !refinementPrompt.trim()}
                              >
                                {refineLoading ? "Refining…" : "Send"}
                              </button>
                            </div>
                          </div>

                          {/* Scenarios List */}
                          <div className="scenarios-cards-list">
                            {filteredScenarios.map(scenario => (
                              <ScenarioCard
                                key={scenario.id}
                                scenario={scenario}
                                requirementIndex={reqIndex}
                                isEditing={activeEditId === scenario.id}
                                onEdit={setActiveEditId}
                                onSave={handleSaveScenario}
                                onCancel={() => setActiveEditId(null)}
                                onDelete={handleDeleteScenario}
                                onQuickAction={(action, title) => {
                                  const text = action === "simplify"
                                    ? `Please rewrite and simplify the Gherkin steps for the scenario titled "${title}" to make them extremely clear and concise. Keep all other scenarios in the Gherkin feature file exactly as they are, and return the complete Gherkin feature containing all scenarios.`
                                    : `Please expand and add more specific details to the Gherkin steps for the scenario titled "${title}". Keep all other scenarios in the Gherkin feature file exactly as they are, and return the complete Gherkin feature containing all scenarios.`;
                                  handleRefine(text);
                                }}
                                onTraceClick={handleTraceClick}
                                scenarioIndex={scenarios.indexOf(scenario) + 1}
                              />
                            ))}

                            {filteredScenarios.length === 0 && (
                              <div className="empty-scenarios-filter">
                                <p>No scenarios found in this category.</p>
                              </div>
                            )}
                          </div>

                        </div>
                      );
                    })()
                  )
                )
              )}
            </div>
          </div>

        </main>
      </div>

      {/* ── Export Settings Modal (Phase 8) ── */}
      {exportOpen && (
        <div className="modal-overlay" onClick={() => setExportOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="export-dialog-title">Export Options</h3>
              <button type="button" className="modal-close-btn" onClick={() => setExportOpen(false)} aria-label="Close export dialog">Close</button>
            </div>
            
            <div className="modal-body">
              {/* 1. Format selector */}
              <div className="modal-field">
                <label className="modal-label">Export Format</label>
                <div className="radio-group">
                  <button 
                    className={`radio-btn ${exportFormat === "feature" ? "radio-btn-active" : ""}`}
                    onClick={() => setExportFormat("feature")}
                    aria-pressed={exportFormat === "feature"}
                  >
                    <span className="radio-title">.feature</span>
                    <span className="radio-desc">BDD Gherkin File</span>
                  </button>
                  <button 
                    className={`radio-btn ${exportFormat === "pdf" ? "radio-btn-active" : ""}`}
                    onClick={() => setExportFormat("pdf")}
                    aria-pressed={exportFormat === "pdf"}
                  >
                    <span className="radio-title">.pdf</span>
                    <span className="radio-desc">Print PDF Document</span>
                  </button>
                  <button 
                    className={`radio-btn ${exportFormat === "docx" ? "radio-btn-active" : ""}`}
                    onClick={() => setExportFormat("docx")}
                    aria-pressed={exportFormat === "docx"}
                  >
                    <span className="radio-title">.doc</span>
                    <span className="radio-desc">Word Document</span>
                  </button>
                </div>
              </div>

              {/* 2. Scope selector */}
              <div className="modal-field">
                <label className="modal-label">Export Scope</label>
                <div className="scope-select-row">
                  <label className="checkbox-container">
                    <input 
                      type="radio" 
                      name="exportScope" 
                      checked={exportScope === "current"} 
                      onChange={() => setExportScope("current")} 
                    />
                    <span className="checkbox-text">Current active session only</span>
                  </label>
                  {sessions.length > 1 && (
                    <label className="checkbox-container">
                      <input 
                        type="radio" 
                        name="exportScope" 
                        checked={exportScope === "all"} 
                        onChange={() => setExportScope("all")} 
                      />
                      <span className="checkbox-text">All sessions (Batch Export)</span>
                    </label>
                  )}
                </div>
              </div>

              {/* 3. Toggle items */}
              <div className="modal-field">
                <label className="modal-label">Document Options</label>
                <div className="checkbox-stack">
                  <label className="checkbox-container">
                    <input 
                      type="checkbox" 
                      checked={includeMetadata} 
                      onChange={e => setIncludeMetadata(e.target.checked)} 
                    />
                    <span className="checkbox-text">Include generation metadata (Project Name, Date, Timestamp)</span>
                  </label>
                  <label className="checkbox-container">
                    <input 
                      type="checkbox" 
                      checked={includeTraceability} 
                      onChange={e => setIncludeTraceability(e.target.checked)} 
                    />
                    <span className="checkbox-text">Generate Traceability Matrix (Requirements mapping table)</span>
                  </label>
                  {qualityAnalysis?.warnings?.length > 0 && (
                    <label className="checkbox-container">
                      <input
                        type="checkbox"
                        checked={includeAmbiguityWarnings}
                        onChange={e => setIncludeAmbiguityWarnings(e.target.checked)}
                      />
                      <span className="checkbox-text">Include quality / ambiguity warnings in export</span>
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setExportOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={triggerExport}>
                Download Document
              </button>
            </div>
          </div>
        </div>
      )}

      {changeImpactOpen && changeImpactResult && (
        <div className="modal-overlay" onClick={() => setChangeImpactOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="change-impact-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="change-impact-title">Change Impact Analysis</h3>
              <button type="button" className="modal-close-btn" onClick={() => setChangeImpactOpen(false)} aria-label="Close change impact dialog">Close</button>
            </div>
            <div className="modal-body">
              <p>{changeImpactResult.summary}</p>
              {changeImpactResult.impactedAreas?.length > 0 && (
                <>
                  <h4>Impacted areas</h4>
                  <ul>{changeImpactResult.impactedAreas.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </>
              )}
              {changeImpactResult.recommendedActions?.length > 0 && (
                <>
                  <h4>Recommended actions</h4>
                  <ul>
                    {changeImpactResult.recommendedActions.map((a, i) => (
                      <li key={i}><strong>{a.action}</strong>: {a.detail}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setChangeImpactOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="toast-container" aria-live="polite" aria-relevant="additions">
        {toasts.map(t => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  )
}
