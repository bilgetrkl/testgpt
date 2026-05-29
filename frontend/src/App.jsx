import { useState, useEffect, useCallback, useRef } from "react"
import mammoth from "mammoth"
import "./App.css"

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

// ── Gherkin Parser & Serializer Functions ────────────────────
function parseGherkin(text) {
  if (!text) return { featureHeader: "", scenarios: [] };
  const lines = text.split("\n");
  let featureHeaderLines = [];
  let scenarios = [];
  let currentScenario = null;
  let currentTags = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("@")) {
      const tagsInLine = trimmed.split(/\s+/).filter(t => t.startsWith("@"));
      currentTags.push(...tagsInLine);
      continue;
    }

    if (trimmed.startsWith("Scenario:") || trimmed.startsWith("Scenario Outline:")) {
      if (currentScenario) {
        while (currentScenario.steps.length > 0 && currentScenario.steps[currentScenario.steps.length - 1].trim() === "") {
          currentScenario.steps.pop();
        }
        scenarios.push(currentScenario);
      }
      const isOutline = trimmed.startsWith("Scenario Outline:");
      const prefix = isOutline ? "Scenario Outline:" : "Scenario:";
      const title = trimmed.substring(prefix.length).trim();

      const traceTag = currentTags.find(tag => /^@REQ-?[a-zA-Z0-9_-]+$/i.test(tag));
      let traceId = null;
      if (traceTag) {
        const cleaned = traceTag.substring(1).toUpperCase();
        traceId = cleaned.startsWith("REQ-") ? cleaned : `REQ-${cleaned.replace("REQ", "")}`;
      }

      currentScenario = {
        id: `sc-${scenarios.length}-${title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 15).toLowerCase()}`,
        title: title,
        isOutline: isOutline,
        tags: [...currentTags],
        traceId: traceId,
        steps: [],
        type: determineScenarioType(title, currentTags)
      };
      currentTags = [];
      continue;
    }

    if (!currentScenario) {
      featureHeaderLines.push(line);
    } else {
      currentScenario.steps.push(line);
    }
  }

  if (currentScenario) {
    while (currentScenario.steps.length > 0 && currentScenario.steps[currentScenario.steps.length - 1].trim() === "") {
      currentScenario.steps.pop();
    }
    scenarios.push(currentScenario);
  }

  return {
    featureHeader: featureHeaderLines.join("\n"),
    scenarios: scenarios
  };
}

function determineScenarioType(title, tags) {
  const allTagsText = tags.join(" ").toLowerCase();
  const titleLower = title.toLowerCase();

  if (allTagsText.includes("happy") || allTagsText.includes("success")) return "happy-path";
  if (allTagsText.includes("edge") || allTagsText.includes("boundary")) return "edge-case";
  if (allTagsText.includes("negative") || allTagsText.includes("fail") || allTagsText.includes("error")) return "negative";

  if (titleLower.includes("happy path") || titleLower.includes("successful") || titleLower.includes("happy-path")) return "happy-path";
  if (titleLower.includes("edge case") || titleLower.includes("boundary") || titleLower.includes("edge-case")) return "edge-case";
  if (titleLower.includes("negative") || titleLower.includes("fail") || titleLower.includes("error") || titleLower.includes("invalid")) return "negative";

  return "other";
}

function syncTagsForType(tags, type) {
  let newTags = tags.filter(t => 
    t !== "@happy-path" && t !== "@happy_path" && t !== "@happy" &&
    t !== "@edge-case" && t !== "@edge_case" && t !== "@edge" &&
    t !== "@negative" && t !== "@negative-scenario" && t !== "@negative_scenario"
  );
  
  if (type === "happy-path") newTags.push("@happy-path");
  else if (type === "edge-case") newTags.push("@edge-case");
  else if (type === "negative") newTags.push("@negative");
  
  return newTags;
}

function serializeGherkin(featureHeader, scenarios) {
  let text = "";
  if (featureHeader) {
    text += featureHeader.trimEnd() + "\n\n";
  }

  scenarios.forEach(sc => {
    if (sc.tags && sc.tags.length > 0) {
      text += "  " + sc.tags.join(" ") + "\n";
    }
    const prefix = sc.isOutline ? "Scenario Outline" : "Scenario";
    text += `  ${prefix}: ${sc.title}\n`;
    if (sc.steps && sc.steps.length > 0) {
      sc.steps.forEach(step => {
        const trimmedStep = step.trim();
        if (trimmedStep) {
          text += `    ${trimmedStep}\n`;
        } else {
          text += "\n";
        }
      });
    }
    text += "\n";
  });
  return text.trim() + "\n";
}

// ── LCS Line-by-line Gherkin Diff Engine (Phase 5.6) ──────────
function computeLineDiff(original, current) {
  const origLines = (original || "").split("\n");
  const currLines = (current || "").split("\n");

  const dp = Array(origLines.length + 1).fill(null).map(() => Array(currLines.length + 1).fill(0));

  for (let i = 1; i <= origLines.length; i++) {
    for (let j = 1; j <= currLines.length; j++) {
      if (origLines[i - 1].trim() === currLines[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = origLines.length;
  let j = currLines.length;
  const diff = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1].trim() === currLines[j - 1].trim()) {
      diff.unshift({ type: "unchanged", text: currLines[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: "added", text: currLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: "removed", text: origLines[i - 1] });
      i--;
    }
  }

  return diff;
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
    <div className={`toast toast-${type}`}>
      <span>{message}</span>
      <button className="toast-close" onClick={onClose}>✕</button>
    </div>
  )
}

// ── Session title helper ──────────────────────────────────────
function sessionTitle(requirements, index) {
  /* eslint-disable-next-line no-useless-escape */
  const firstLine = requirements.trim().split("\n")[0].replace(/^\d+[\.\)]\s*/, "").trim()
  return firstLine.length > 36 ? firstLine.slice(0, 36) + "…" : firstLine || `Session ${index + 1}`
}

// ── Input Sanitizer ───────────────────────────────────────────
function sanitizeInput(text) {
  if (!text) return ""
  
  // 1. Remove dangerous control/non-printable ASCII characters (keep newlines/tabs)
  /* eslint-disable-next-line no-control-regex */
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")

  // 2. Strip script tags entirely to prevent prompt injection XSS
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  
  // 3. Escape basic HTML tags to render them safely as text
  clean = clean.replace(/</g, "&lt;").replace(/>/g, "&gt;")

  // 4. Prevent excessive consecutive blank lines (max 3 successive breaks)
  clean = clean.replace(/\n{4,}/g, "\n\n\n")

  // 5. Trim trailing whitespace from each line and overall text
  clean = clean.split("\n").map(line => line.trimEnd()).join("\n").trim()

  return clean;
}

// ── Gherkin Validator (3.6) ──────────────────────────────────
function isValidGherkin(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  // Check for core Gherkin keywords
  return (
    lower.includes("feature:") || 
    lower.includes("scenario:") || 
    lower.includes("given ") || 
    lower.includes("when ") || 
    lower.includes("then ")
  )
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
    "edge-case": "Edge Case",
    "negative": "Negative Scenario",
    "other": "Other"
  }[scenario.type] || "Other";

  const displayTags = (scenario.tags || []).filter(t => {
    const lower = t.toLowerCase();
    return !lower.startsWith("@req") && 
           lower !== "@happy-path" && lower !== "@happy_path" && lower !== "@happy" &&
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
            {["happy-path", "edge-case", "negative"].map(t => (
              <button
                key={t}
                type="button"
                className={`scenario-type-btn btn-type-${t} ${editedType === t ? "active" : ""}`}
                onClick={() => setEditedType(t)}
              >
                {t === "happy-path" && "Happy Path"}
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
          {displayTags.length > 0 && (
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
            🔗 Traces to {scenario.traceId || `REQ-${requirementIndex}`}
          </button>
          <button 
            className="btn-card-edit" 
            onClick={() => onEdit(scenario.id)}
            title="Edit scenario"
            aria-label="Edit scenario"
          >
            ✏️
          </button>
          <button 
            className="btn-card-delete" 
            onClick={() => onDelete(scenario.id)}
            title="Delete scenario"
            aria-label="Delete scenario"
          >
            ✕
          </button>
        </div>
      </div>

      <h3 className="scenario-title">
        {scenario.isOutline ? "Scenario Outline: " : "Scenario: "}
        {scenario.title}
      </h3>

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
          className="btn-quick-action" 
          onClick={() => onQuickAction("simplify", scenario.title)}
          title="Simplify this scenario's Gherkin steps via AI"
        >
          🪄 Simplify Steps
        </button>
        <button 
          className="btn-quick-action" 
          onClick={() => onQuickAction("detailed", scenario.title)}
          title="Make this scenario more detailed via AI"
        >
          🔍 Add Details
        </button>
      </div>
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
  const isEdited = activeSession && requirements.trim() !== (activeSession.versions?.[activeVersionIdx]?.requirements || activeSession.requirements).trim()

  // Persist sessions to localStorage
  useEffect(() => {
    localStorage.setItem("testgpt-sessions", JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    if (activeId) localStorage.setItem("testgpt-active-id", activeId)
    else localStorage.removeItem("testgpt-active-id")
  }, [activeId])

  // Reset diff view when active session changes
  useEffect(() => {
    setDiffViewOpen(false)
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
      const res = await fetch("http://localhost:8000/refine", {
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
              versionType: customPromptText ? "quick-action" : "ai-refinement",
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

  // Generate & save to session
  const handleGenerate = async () => {
    const rawInput = requirements.trim()
    if (!rawInput) return
    
    // Sanitize input (2.6)
    const sanitized = sanitizeInput(rawInput)
    if (!sanitized) {
      addToast("Input is invalid after sanitization", "error")
      return
    }
    
    // Update the UI and localStorage state with sanitized text
    setRequirements(sanitized)
    
    setForceShowRaw(false)
    setActiveEditId(null)
    setSelectedCategory("all")
    setLoading(true); setError(""); setResult("")
    try {
      const res = await fetch("http://localhost:8000/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: sanitized }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      setResult(data.result)

      if (activeId === null) {
        // Create a completely new session (Draft -> Active)
        const newSession = {
          id: Date.now(),
          reqNumber: sessions.length + 1,
          title: sessionTitle(sanitized, sessions.length),
          requirements: sanitized,
          result: data.result,
          versions: [{ 
            requirements: sanitized, 
            result: data.result, 
            timestamp: Date.now(),
            messages: [
              { role: "user", content: `Generate Gherkin acceptance tests for these requirements:\n\n${sanitized}` },
              { role: "assistant", content: data.result }
            ]
          }],
          activeVersionIndex: 0
        }
        setSessions(prev => [newSession, ...prev])
        setActiveId(newSession.id)
        setSidebarOpen(true)
        addToast("Tests generated!", "success")
      } else {
        // Update an existing active session (Add new version - 2.8)
        const updatedSessions = sessions.map(s => {
          if (s.id === activeId) {
            const currentVersions = s.versions || [{ requirements: s.requirements, result: s.result, timestamp: s.id }]
            const newVersion = { 
              requirements: sanitized, 
              result: data.result, 
              timestamp: Date.now(),
              messages: [
                { role: "user", content: `Generate Gherkin acceptance tests for these requirements:\n\n${sanitized}` },
                { role: "assistant", content: data.result }
              ]
            }
            const nextVersions = [...currentVersions, newVersion]
            const nextIndex = nextVersions.length - 1
            
            return {
              ...s,
              title: sessionTitle(sanitized, sessions.indexOf(s)),
              requirements: sanitized,
              result: data.result,
              versions: nextVersions,
              activeVersionIndex: nextIndex
            }
          }
          return s
        })
        setSessions(updatedSessions)
        addToast("Updated session with new version!", "success")
      }
    } catch {
      setError("Could not reach the backend. Make sure it's running on port 8000.")
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
    setError("")
    setForceShowRaw(false)
    setActiveEditId(null)
    setSelectedCategory("all")
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
      <nav className="navbar">
        <div className="navbar-brand">
          {sessions.length > 0 && (
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Toggle session sidebar"
            >
              <span className="sidebar-toggle-icon">{sidebarOpen ? "←" : "☰"}</span>
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
                {copied ? "✓ Copied" : "Copy all"}
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
                onKeyDown={e => e.key === "Enter" && loadSession(s)}
              >
                <span className="sidebar-item-title">REQ-{sessions.length - sIdx}: {s.title}</span>
                <button
                  className="sidebar-item-delete"
                  onClick={e => deleteSession(e, s.id)}
                  aria-label="Delete session"
                  tabIndex={-1}
                >
                  ✕
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
                {isEdited && <span className="badge-draft">Edited</span>}
              </div>
              <p className="panel-subtitle">Paste your software requirements below</p>
            </div>
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
            />
            <div className="input-footer">
              <div className="input-footer-left">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.docx"
                  onChange={handleFileUpload}
                  style={{ display: "none" }}
                  aria-label="Upload requirements file"
                />
                <button
                  className="btn-upload"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Upload File
                </button>
                <span className="upload-tip">.txt, .md, .docx</span>
                <span className="char-count">{requirements.length} chars</span>
              </div>
              <button
                id="generate-btn"
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={loading || !requirements.trim()}
                aria-label="Generate Gherkin tests"
              >
                {loading
                  ? <span className="btn-loading"><span className="spinner" /> Generating…</span>
                  : "Generate Tests →"
                }
              </button>
            </div>
          </div>

          {/* Right – Output */}
          <div className="panel panel-output">
            <div className="panel-header">
              <div className="panel-header-title-row">
                <h2>Generated Tests</h2>
                {result && (
                  <div className="output-header-actions">
                    {activeSession && activeSession.versions && activeSession.versions.length > 1 && (
                      <div className="version-switcher">
                        <button
                          className="btn-version"
                          disabled={activeVersionIdx === 0}
                          onClick={() => handleVersionChange(activeVersionIdx - 1)}
                          aria-label="Previous version"
                        >
                          ←
                        </button>
                        <span className="version-text">
                          {activeVersionIdx + 1} / {totalVersions}
                        </span>
                        <button
                          className="btn-version"
                          disabled={activeVersionIdx === totalVersions - 1}
                          onClick={() => handleVersionChange(activeVersionIdx + 1)}
                          aria-label="Next version"
                        >
                          →
                        </button>
                        <button 
                          className={`btn-diff-toggle ${diffViewOpen ? "active" : ""}`}
                          onClick={() => setDiffViewOpen(o => !o)}
                          title="Toggle visual diff with original version"
                        >
                          {diffViewOpen ? "📝 Hide Diff" : "✨ Diff View"}
                        </button>
                      </div>
                    )}
                    <button
                      className="btn-regenerate-badge"
                      onClick={handleGenerate}
                      disabled={loading}
                      title="Regenerate all scenarios for this requirement"
                    >
                      🔄 Regenerate
                    </button>
                  </div>
                )}
              </div>
              <p className="panel-subtitle">Gherkin acceptance test scenarios</p>
            </div>
            <div className="output-content">
              {loading && <Skeleton />}

              {error && !loading && (
                <div className="error-state">
                  <p className="error-message">{error}</p>
                  <button className="btn btn-outline" onClick={handleGenerate}>Try again</button>
                </div>
              )}

              {!loading && !error && !result && (
                <div className="empty-state">
                  <h3>No tests yet</h3>
                  <p>Enter your requirements on the left and click <strong>Generate Tests</strong></p>
                </div>
              )}

              {result && !loading && (
                !isValidGherkin(result) && !forceShowRaw ? (
                  <div className="malformed-warning">
                    <div className="malformed-warning-title">Malformed AI Response Detected</div>
                    <p className="malformed-warning-text">
                      The generated output does not conform to standard Gherkin syntax. The AI model may have returned conversational text or hit an internal error.
                    </p>
                    <div className="malformed-warning-actions">
                      <button className="btn btn-primary" onClick={handleGenerate}>
                        Regenerate Tests
                      </button>
                      <button className="btn btn-outline" onClick={() => setForceShowRaw(true)}>
                        Show Raw Response Anyway
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
                              🔍 Comparing Original (Version 1) with Current (Version {activeVersionIdx + 1})
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
                              { id: "edge-case", label: `Edge Cases (${countType("edge-case")})` },
                              { id: "negative", label: `Negative (${countType("negative")})` }
                            ].map(tab => (
                              <button
                                key={tab.id}
                                className={`filter-tab-btn filter-tab-${tab.id} ${selectedCategory === tab.id ? "active" : ""}`}
                                onClick={() => setSelectedCategory(tab.id)}
                              >
                                {tab.label}
                              </button>
                            ))}
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

                          {/* Add Custom Scenario Button */}
                          <div className="scenarios-footer-actions">
                            <button className="btn btn-outline btn-add-scenario" onClick={handleAddScenario}>
                              + Add Custom Scenario
                            </button>
                          </div>

                          {/* Phase 5.2 & 5.3 Conversational Refinement Chat Interface */}
                          <div className="refinement-chat-container" style={{ position: "relative" }}>
                            <h4 className="refinement-chat-heading">🤖 Iterative Refinement Chat</h4>
                            <p className="refinement-chat-sub">Refine and adapt these Gherkin scenarios interactively using conversational AI prompts.</p>
                            
                            {showSuggestions && suggestions.length > 0 && (
                              <div className="chat-autocomplete-dropdown">
                                {suggestions.map((s, idx) => (
                                  <div
                                    key={s.index}
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
                                placeholder="Ask AI to refine scenarios (e.g., 'Make @1 cover duplicate emails too' or 'For #3, add a Given step for user roles')..."
                                rows={2}
                                disabled={refineLoading}
                              />
                              <button 
                                className="btn btn-primary btn-refine-send" 
                                onClick={() => handleRefine()}
                                disabled={refineLoading || !refinementPrompt.trim()}
                              >
                                {refineLoading ? "Refining..." : "Send Request 🚀"}
                              </button>
                            </div>
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
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Export Options</h3>
              <button className="modal-close-btn" onClick={() => setExportOpen(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              {/* 1. Format selector */}
              <div className="modal-field">
                <label className="modal-label">Export Format</label>
                <div className="radio-group">
                  <button 
                    className={`radio-btn ${exportFormat === "feature" ? "radio-btn-active" : ""}`}
                    onClick={() => setExportFormat("feature")}
                  >
                    <span className="radio-title">.feature</span>
                    <span className="radio-desc">BDD Gherkin File</span>
                  </button>
                  <button 
                    className={`radio-btn ${exportFormat === "pdf" ? "radio-btn-active" : ""}`}
                    onClick={() => setExportFormat("pdf")}
                  >
                    <span className="radio-title">.pdf</span>
                    <span className="radio-desc">Print PDF Document</span>
                  </button>
                  <button 
                    className={`radio-btn ${exportFormat === "docx" ? "radio-btn-active" : ""}`}
                    onClick={() => setExportFormat("docx")}
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

      {/* ── Toasts ── */}
      <div className="toast-container">
        {toasts.map(t => (
          <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  )
}