# TestGPT – AI-Augmented Acceptance Test Generator
## Project Task List (Agent-Ready)

> **Instructions for AI Agent**: This document is the canonical task list for the TestGPT project. 
> Before adding any task, check if it already exists (by title or description) to avoid duplication.
> Mark tasks as `[x]` when complete. Do not remove completed tasks — keep them for traceability.
> Group new tasks under the correct phase. If a task spans multiple phases, place it in the earliest relevant phase.

---

## Project Overview

- **Team size**: 3 developers
- **Duration**: 10 weeks
- **Goal**: Functional prototype that accepts software requirements/use cases as input and generates structured Gherkin acceptance test scenarios using generative AI, with traceability, iterative refinement, and ambiguity detection.

---

## Phase 1 — Project Setup & Architecture

- [x] 1.1 Define and agree on the technology stack (frontend, backend, AI API)
- [x] 1.2 Set up version control repository (Git) with branching strategy (e.g. main / dev / feature branches)
- [x] 1.3 Define folder structure and project conventions (naming, formatting, linting)
- [x] 1.4 Set up development environment (local setup guide / README)
- [x] 1.8 Identify and document the generative AI API to be used (e.g. Anthropic Claude, OpenAI)
- [x] 1.9 Obtain and securely store API keys (use environment variables, never hardcode)
- [x] 1.9b Decide on data persistence strategy — use localStorage for prototype scope (saves requirements, generated scenarios, edits, and theme preference); no login or backend DB required per project scope

---

## Phase 2 — Requirement Input Module

- [x] 2.1 Design the UI for requirement/use case input (text area, file upload, or both)
- [x] 2.2 Implement plain-text requirement input field
- [x] 2.3 Support multi-section input (e.g. multiple requirements at once)
- [x] 2.4 Implement file upload support (e.g. `.txt`, `.md`, `.docx`) for importing requirements
- [x] 2.5 Add input validation (min length, not empty, character limits)
- [x] 2.6 Implement input sanitization before sending to AI API
- [x] 2.7 Persist submitted requirements and generated scenarios to localStorage so data survives page refresh
- [x] 2.8 Allow editing/updating requirements after initial submission

---

## Phase 3 — AI Integration & Test Generation Engine

- [x] 3.1 Design the prompt template for sending requirements to the AI model
- [x] 3.2 Instruct the AI to output structured Gherkin format (Feature / Scenario / Given / When / Then)
- [x] 3.3 Instruct the AI to generate multiple scenario types: happy path, alternative flows, edge cases, negative scenarios
- [x] 3.4 Implement the API call layer (request / response handling, error handling, retries)
- [x] 3.5 Parse and validate the AI response to confirm valid Gherkin structure
- [x] 3.6 Handle malformed or incomplete AI responses gracefully (fallback message to user)
- [ ] 3.7 Support streaming responses for better UX (if API supports it)
- [ ] 3.8 Implement rate limiting / API usage control to avoid overuse during development

---

## Phase 4 — Gherkin Output Display & Editing

- [x] 4.1 Design the test scenario output view (list of scenarios per requirement)
- [x] 4.2 Render generated Gherkin scenarios with syntax highlighting
- [x] 4.3 Allow users to edit individual scenarios inline
- [x] 4.4 Allow users to delete individual scenarios
- [x] 4.5 Allow users to manually add custom scenarios
- [x] 4.6 Group scenarios by type (happy path, edge case, negative, etc.) with visual labels
- [x] 4.7 Show which requirement each scenario traces back to (traceability link)

---

## Phase 5 — Iterative Refinement Workflow

- [x] 5.1 Implement a "Regenerate" button to re-request scenarios for a specific requirement
- [x] 5.2 Allow users to provide feedback or instructions to refine a scenario (follow-up prompt input)
- [x] 5.3 Maintain conversation history per requirement for multi-turn refinement
- [x] 5.4 Implement "Add more scenarios" action (e.g. generate 3 more edge cases)
- [x] 5.5 Implement "Simplify this scenario" / "Make this more detailed" quick actions
- [x] 5.6 Preserve the original AI-generated version alongside edits (diff view or version history)

---

## Phase 6 — Ambiguity & Quality Detection

- [ ] 6.1 Prompt the AI to identify ambiguous or incomplete requirements before generating tests
- [ ] 6.2 Display ambiguity warnings to the user with suggested improvements
- [ ] 6.3 Prompt the AI to flag missing validation criteria (e.g. no error handling mentioned)
- [ ] 6.4 Prompt the AI to detect inconsistencies between multiple requirements
- [ ] 6.5 Allow users to dismiss or acknowledge warnings
- [ ] 6.6 Track which warnings were acted upon vs ignored (for reporting)

---

## Phase 7 — Traceability Matrix

- [ ] 7.1 Design the data model linking requirements → generated scenarios
- [ ] 7.2 Build a traceability matrix view (requirement on one axis, scenarios on the other)
- [ ] 7.3 Show coverage status per requirement (e.g. 0 scenarios = uncovered, red; 1+ = covered, green)
- [ ] 7.4 Allow navigating from the matrix to the specific scenario and back
- [ ] 7.5 Update the matrix in real time as scenarios are added, edited, or deleted

---

## Phase 8 — Export & Documentation Output

- [x] 8.1 Implement export to `.feature` file (standard Gherkin format for BDD tools like Cucumber)
- [x] 8.2 Implement export to `.pdf` with structured layout
- [x] 8.3 Implement export to `.docx` (Word document)
- [x] 8.4 Include traceability matrix in exported documents
- [x] 8.5 Include ambiguity warnings in exported documents (optional toggle)
- [x] 8.6 Add metadata to export: project name, date, requirement source, generation timestamp
- [x] 8.7 Allow exporting a single requirement's scenarios or all at once

---

## Phase 9 — UI/UX & Frontend Polish

### 9A — Layout & Structure
- [x] 9.1 Design and implement overall application layout (sidebar for requirements list, main panel for scenarios)
- [x] 9.2 Implement a clean two-panel layout: left = input/requirements, right = generated scenarios
- [x] 9.3 Add a top navigation bar with project name, export button, and theme toggle
- [x] 9.4 Make the layout responsive — stack panels vertically on smaller screens
- [x] 9.5 Add a collapsible sidebar for navigating between multiple requirements

### 9B — Visual Design & Color Theme
- [x] 9.6 Define a light color palette as the default theme — use soft off-white backgrounds (e.g. `#F8F7F4`), not pure white, to reduce eye strain
- [x] 9.7 Use a calm, muted primary accent color (e.g. soft indigo or slate blue) for buttons and highlights — avoid harsh saturated colors
- [x] 9.8 Apply consistent border radius (rounded corners) across cards, buttons, and input fields for a modern look
- [x] 9.9 Use subtle card shadows (soft, low-opacity) to separate content sections without feeling heavy
- [x] 9.10 Choose a clean, readable font pairing: a slightly geometric sans-serif for UI labels, a monospace font for Gherkin code blocks
- [x] 9.11 Apply consistent spacing scale (4px base unit: 4 / 8 / 12 / 16 / 24 / 32px) across all components
- [x] 9.12 Style Gherkin scenario blocks with a code-editor look: monospace font, soft background, colored keywords (`Given` / `When` / `Then` in distinct muted colors)
- [ ] 9.13 Add color-coded badges/tags for scenario types (happy path = green, edge case = amber, negative = red/coral) — use soft pastel variants, not vivid colors
- [ ] 9.14 Style the traceability matrix with alternating row shading and color-coded coverage indicators (uncovered = soft red, covered = soft green)
- [x] 9.15 Add subtle hover states to all interactive elements (cards, buttons, list items) — light background shift, no harsh borders

### 9C — Dark Mode
- [x] 9.16 Define a dark mode color palette — use deep charcoal backgrounds (e.g. `#1C1C1E` or `#18181B`), not pure black
- [x] 9.17 Ensure all text colors meet WCAG AA contrast ratio in dark mode (minimum 4.5:1 for body text)
- [x] 9.18 Adjust card and panel backgrounds in dark mode to use layered grays (e.g. `#1C1C1E` → `#252528` → `#2E2E32`) for depth
- [x] 9.19 Restyle Gherkin code blocks for dark mode (darker background, lighter keyword colors)
- [x] 9.21 Implement theme toggle button (sun/moon icon) in the navbar
- [x] 9.22 Persist the user's theme preference in `localStorage` so it survives page refresh
- [x] 9.23 Respect the OS-level `prefers-color-scheme` setting as the default on first load

### 9D — Micro-interactions & Feedback
- [x] 9.25 Add loading skeleton placeholders (not just a spinner) while AI is generating scenarios
- [x] 9.26 Animate new scenario cards appearing (subtle fade-in or slide-up) after generation
- [x] 9.27 Add a smooth transition when switching between light and dark mode (CSS `transition: background-color 0.2s, color 0.2s`)
- [x] 9.28 Add error states with user-friendly messages and a "Try again" button (API failure, no results, etc.)
- [x] 9.29 Add empty states with helpful guidance (illustrated or icon-based) when no requirements have been entered yet
- [x] 9.30 Implement toast notifications for actions (saved, exported, copied to clipboard, error) — auto-dismiss after 3s
- [x] 9.31 Add a "Copy to clipboard" button on each Gherkin scenario block with a brief ✓ confirmation animation
- [x] 9.32 Add keyboard accessibility for main interactions (tab order, focus rings, ARIA labels)

---

## Phase 10 — Testing & Quality Assurance

- [x] 10.1 Write unit tests for core utility functions (prompt builder, response parser, etc.)
- [ ] 10.2 Write integration tests for the AI API call layer
- [ ] 10.3 Write end-to-end tests for the main user workflow (input → generate → export)
- [ ] 10.4 Manually test with at least 5 real-world requirement samples of varying complexity
- [ ] 10.5 Test edge cases: empty input, very long input, non-English input, gibberish input
- [ ] 10.6 Test API failure scenarios (timeout, invalid key, rate limit)
- [ ] 10.7 Fix bugs identified during testing

---

## Phase 11 — Documentation & Handoff

- [ ] 11.1 Write user-facing README with setup instructions
- [ ] 11.2 Document environment variable configuration
- [ ] 11.3 Write developer guide: how to extend prompt templates, add new export formats, etc.
- [ ] 11.4 Document known limitations and future improvement ideas
- [ ] 11.5 Prepare project presentation / demo walkthrough
- [ ] 11.6 Record a demo video (optional but recommended for group project submission)

---

## Notes for Agent

- **Do not duplicate tasks.** Always search for existing similar tasks before adding.
- **Use consistent naming.** Follow the `Phase X.Y — Description` format for new tasks.
- **Keep phases intact.** Do not restructure phases unless explicitly requested by the team.
- **Completed tasks stay.** Mark with `[x]` but never delete — traceability matters.
- **When in doubt, ask.** If a new task is ambiguous in scope, flag it with a `[?]` prefix and a comment.
