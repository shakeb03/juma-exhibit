# Exhibit A: Design Guidelines

Interface rules for the agency intelligence workspace. Product behavior lives in [PRD.md](./PRD.md); implementation in [TRD.md](./TRD.md). Where this file and the PRD disagree about behavior, the PRD wins.

## 1. Direction

A calm agency workspace with a curious, slightly irreverent builder behind it.

Take inspiration from Juma's white surfaces, pale aqua accents, dark teal text, rounded panels, and occasional italic serif emphasis. Add our own identity through visible evidence, amber annotations, and dry humour in small doses.

The workspace should feel useful first. The courtroom is a separate video, not an app theme.

- Working name: **Exhibit A**. Supporting line: **Good ideas. Evidence attached.**
- Identity: a simple text wordmark and a small bracket or document symbol. Add "Built by Shakeb" discreetly (footer or about). Juma is the reference and intended audience, not the app's identity.
- The colours and sizes below are our own proposed tokens, not an extracted Juma design system. The signed-in Juma application was not inspected.

### Product ideas that shape the design

From the Juma agency walkthrough (https://www.youtube.com/watch?v=OeeRjta6WuA), a product demo rather than a design talk:

| Idea | Design consequence |
| --- | --- |
| Projects are the company memory; nobody re-briefs. | Each client workspace visibly shows the context it already holds (brand, KPIs, briefs, files). |
| Every client has a deliberately different brand. | Client identity is shown on client surfaces; the app shell stays neutral. |
| Output is finished work, not chatter. | Artifacts look like deliverables, distinct from chat. |
| The agent shows a plan, then runs it. | Runs show named steps, not a bare spinner. |
| The whole team shares one workspace. | Versions show who and when. |

## 2. Personality and voice

- **Calm:** leave space around the work; no decoration that competes with it.
- **Curious:** make evidence and execution details easy to explore.
- **Candid:** say what ran, what failed, and what remains uncertain.
- **Witty:** one quiet joke in an empty state or technical view is enough.

Use direct action labels: "Create report", "Compare brands", "Inspect evidence", "Approve version".

| Place | Copy |
| --- | --- |
| Home | What are we working on today? |
| Empty canvas | Bring two brands. Find something worth testing. |
| Evidence link | Show me the numbers |
| Technical entry | For geeks |
| Technical panel subtitle | The receipts, in detail. |
| Export failure | Export failed. Your report is saved. Try again. |
| Permission restriction | This client has not approved sharing creative assets. |

Rules:

- Errors, consent, permission, and approval messages are literal. Humour never obscures what happened or what to do.
- No humour inside a client's report unless the brand explicitly calls for it.
- "We prefer cross-functional collaboration" belongs to the film or an optional Easter egg, never to permission text.
- Sentence case. No exclamation marks. Short sentences.
- Consistent nouns: client, artifact, version, evidence, run, turn, canvas, node. Do not alternate synonyms.
- Fictional data is labelled synthetic where first shown and in the PDF footer.
- Numbers: thousands separators, consistent decimals per metric, currency and percent symbols always present, periods always stated.

## 3. Principles

1. **Chat is conversation; artifacts are documents.** Never share a visual style.
2. **Evidence is one click away, never in the way.** Numerical claims are quiet, inspectable elements.
3. **Observation, hypothesis, recommendation look different** (section 8) and can be told apart without colour.
4. **Say what is missing or excluded.** Blocked, restricted, unavailable, and failed states are designed, not afterthoughts. Unavailable is never shown as zero.
5. **Neutral shell, expressive client content.** Client brands get their own thumbnails and accents without changing the app shell.
6. **Inspectable by default.** Anything the system did is reachable from the UI through the geek panel.
7. **No meaningless decoration.** The defining interaction is: see a result, inspect its evidence, explore the execution behind it.

## 4. Colour

White and soft aqua for most of the interface. Amber is the signature annotation colour. Implement as CSS variables in `apps/web/app/globals.css` via Tailwind v4 `@theme`; components use token names, not hex values. Build the light theme first.

| Token | Value | Use |
| --- | --- | --- |
| Background | `#F6FAF9` | Overall workspace |
| Surface | `#FFFFFF` | Cards, reports, sidebar |
| Surface muted | `#EEF5F4` | Secondary sections, hover states |
| Text | `#001819` | Headings and body |
| Text muted | `#536765` | Supporting information |
| Border | `#D9E5E2` | Quiet separators (decorative) |
| Border strong | `#7A8E8B` | Input, checkbox, and control boundaries |
| Aqua | `#CFF3F5` | Selected tabs, highlighted controls, drag-over |
| Teal | `#075E61` | Primary actions, links, selected outline |
| Amber light | `#FFF1D6` | Hypotheses, evidence annotations |
| Amber dark | `#79500A` | Text on amber |
| Success | `#216544` | Passed checks, completed outputs |
| Danger | `#AA3434` | Failed checks, errors, restricted |

Semantic pairings for the three content types and restrictions:

| Meaning | Foreground | Background |
| --- | --- | --- |
| Observation | Success `#216544` | `#E6F3EC` |
| Hypothesis | Amber dark `#79500A` | Amber light `#FFF1D6` |
| Recommendation | Teal `#075E61` | `#E2F4F5` |
| Restricted / error | Danger `#AA3434` | `#FBECEC` |
| Unavailable | Text muted `#536765` | Surface muted `#EEF5F4` |

Rules:

- White text on teal buttons. Dark text on aqua buttons.
- Contrast was computed for these tokens (WCAG ratios): text on background 17.4, muted on surface 6.0, muted on surface muted 5.4, muted on aqua 5.1, white on teal 7.6, teal on aqua 6.4, amber dark on amber light 6.3, success on white 7.0, danger on white 6.5, border strong on white 3.5. All meet AA (4.5 text, 3.0 UI components). Re-check if any value changes.
- `Border` (1.3:1) is decorative only. Anything that must be perceived as a control boundary uses `Border strong`.
- Never rely on colour alone for status. Pair every semantic colour with a text label and icon.
- Amber marks hypotheses and evidence annotations. It does not imply a claim is verified.
- Client brand colours appear on thumbnails, the client card, the artifact title rule, and the PDF masthead only. They never recolour buttons or navigation.
- A dark editor surface is allowed in the code browser; the shell stays light.

## 5. Typography

Inter for the interface, with a system sans-serif fallback, loaded through `next/font`. Satoshi is an optional substitute if a properly licensed copy is available. The Juma homepage uses Satoshi Variable with an Arial fallback.

Georgia italic for one short phrase on the home screen or an empty state. Monospace only for code, IDs, timings, and technical records.

| Element | Size |
| --- | --- |
| Home heading | 32 px, medium |
| Page heading | 24 px, medium |
| Section heading | 18 px, medium |
| Body and conversation | 15-16 px |
| Controls and sidebar | 14 px |
| Supporting labels | 12-13 px |

Comfortable line spacing, tabular numerals (`font-variant-numeric: tabular-nums`) in performance tables, body measure around 70 characters. Avoid long uppercase labels.

## 6. Layout

Design the desktop demo around a 1440 x 900 viewport. Spacing set: 4, 8, 12, 16, 24, 32, 48 px.

- **Header, 64 px:** wordmark, Client workspaces / Intelligence canvas navigation, demo account.
- **Body, 70/30:** main workspace and supporting sidebar, separated by a thin border.
- **Sidebar:** files in the top 55%, current run in the bottom 45%; the divider is resizable. Minimum width 320 px on desktop; the main area takes the remainder. Padding 20 px.
- **Main padding:** 24-32 px.
- **Independent scrolling** for files, conversation, report, and technical records.
- **Below 1100 px:** the sidebar becomes a drawer with Files / Run tabs.
- **Below 768 px:** content stacks; chat and report become tabs; click-to-attach replaces drag-and-drop; the canvas is view-and-chat only.
- **Layers:** workspace, then evidence drawer (inside the main pane, sidebar stays visible), then geek panel, then modal dialogs. Opening a higher layer never loses the state beneath it.

### Client home

Short welcome heading, the two workspace options, and a grid of client cards. No marketing hero inside the product.

- Three guided-scenario cards (Evidence, Permissions, Memory) sit above the client grid. Each is a one-click starting prompt with one line saying what it demonstrates and runs the real system. Free-form input is always available.
- The demo opens with no signup or setup, with the fictional agency already loaded.
- Client card: brand thumbnail or initials, name, category, latest activity, and sharing scope with precise labels, such as "Performance patterns approved" and "Creative assets restricted". The two approvals are shown separately.
- 16 px radius, thin border, subtle hover background. The whole card opens the client; extra actions live in a small menu.

## 7. Components

### 7.1 Client workspace and chat

- The top bar shows the client name and reporting period. Brief and brand notes can be inspected without leaving the workspace and without hiding chat.
- The conversation is the primary interface. No required campaign picker; optional source controls stay secondary.
- Within the left 70%, conversation and report sit side by side, each scrolling independently, with compact headers. The composer is anchored below chat history.
- Show the explanation before expandable metric tables.
- User messages: right-aligned, aqua-tinted. Agent replies: left-aligned, no bubble, readable text with compact output cards.
- Show observed steps such as "Reading campaign data" and "Checking calculations". Keep internal implementation language out of the main conversation.
- Clarifying questions are normal replies with quick-reply chips; typing a free answer is always possible.
- Conversation suggestions only fill the composer; the user chooses when to send.
- Saved user and assistant turns, attachment chips, clarification questions, and linked report versions all appear in the conversation.

### 7.2 Composer and attachments

- 20 px radius. Enter sends, Shift+Enter inserts a line break.
- Attached files appear as removable chips stating what context they add. Attaching never starts a task and never grants permission.
- Drag-to-attach: the drop target highlights in aqua while dragging.
- Click-to-attach is always available; drag is never required.

### 7.3 Run progress and sidebar

- **Files:** grouped by client and scenario, compact rows with file type, name, and scope. Preview on click; an explicit Attach action.
- **Current run:** status, current step, elapsed time, source count, checks, output status. A small step list, not a wall of logs.
- Never show a fake percentage bar. Use completed steps when the total is known; otherwise show the current activity.
- Report checks as specific counts ("Numerical claims verified: 8/9"), never an unexplained score.
- A failed run shows as failed and says what can be retried. It is never presented as a completed artifact.
- Long runs survive refresh; on return, show the current state.
- **For geeks** sits at the bottom of the run panel: always discoverable, visually secondary. The source code opens inside the geek panel; there is no separate "View code" link.
- The sidebar reflects real persisted activity, not mock records.

### 7.4 Artifacts and reports

- Resemble a clean client document: brand header, period, scorecards, charts, summary, next steps. Paper-like white surface with a thin border; client accent as the title rule.
- Header: artifact type, title, version, status badge (Draft, Approved), actions (comment, edit, versions, approve, download PDF).
- Made of blocks. Hovering a block reveals comment and edit controls. A block with an open comment or edit gets a teal outline.
- One layout per artifact type.
- Keep "Approve version" and "Download PDF" clear. Show the version being approved. If it changes after approval, show "Changed since approval" and return the badge to Draft.
- Manual edits are not flagged inside the report; the record lives in the geek panel (PRD 5.3).
- Export states: idle, creating, ready, failed with retry. "Ready" appears only after the file exists.
- Charts use existing calculated metrics, offer a text summary or data table, and open the same evidence drawer as metric links.

### 7.5 Comments and diffs

- Comments anchor to one block, with a margin marker where threads exist.
- An AI-proposed edit is a before/after diff scoped to that block, with Accept and Reject. Nothing outside the block changes appearance.
- For blocks with numbers, the diff shows the metric reference beside the number.
- Accepting creates a new version and shows a toast linking to it.

### 7.6 Evidence drawer

- Opens inside the main pane from any inspectable numerical claim, which carries a subtle dotted underline and an evidence icon. Keyboard accessible.
- Content: the claim, source rows, calculation, check result, limitations, and a link to the associated execution.
- Always shows the originally calculated value, labelled "Calculated value", even after a manual edit.

### 7.7 Intelligence canvas

Light background with a faint dot grid. A compact toolbar holds Add client, Add reference, Add idea, Fit canvas, and zoom.

The initial demo canvas is bounded and supports:

- Pointer and keyboard movement of nodes.
- Connector handles for dragging lines directly between nodes, with editable labels on the canvas, plus a menu-based alternative to dragging.
- The same conversation-plus-artifact split as the client workspace. Connected context is an expandable panel above it.
- Explicit saving of revisions, or saving through the conversational request, and each brief shows the revision that produced it.
- Approved performance patterns support analysis now. Creative-reference nodes and visual inspection depend on supplied, approved creative material.

Node types (PRD 5.5), 240-280 px wide, rounded, each with an icon and a text label supported by a restrained accent:

- **Client:** brand thumbnail, name, and permitted information, shown as separate rows for performance patterns and creative assets. Identity is read-only; the node can be moved or removed, with no edit-client form. An unapproved client looks inert and says "No approved information."
- **New-client brief:** the prospect being planned for.
- **Reference:** file preview or text excerpt, with its source.
- **Idea:** a short editable statement.
- **Chat:** a conversation whose context is whatever is connected to it.

Analysis findings are cards in the chat result (observation, evidence links, proposed next step), not a node type. Clicking a card opens the full brief in the main pane.

Connections express a question: "Compare visual styles", "Combine storytelling patterns", "Apply to this brief". A connection alone does not run analysis or grant permission. A connection to a restricted source is dashed with a lock and an explanation of what is excluded. A selected node gets a teal outline.

### 7.8 Geek panel and code view

- A panel (not a separate page) that opens at the turn being viewed, with previous/next turn controls. Closing it returns to the same client, conversation, artifact, canvas position, and execution. It may include a "Back to workspace" control.
- Starts with a few measured values, then an expandable timeline grouped by turn: inputs, permissions applied, tool calls, model calls, checks, failures, retries, artifact versions.
- Readable labels ("Numerical claims verified: 8/9"). Missing measurements read "Unavailable". Source evidence stays accessible beside check results.
- Payloads are raw, monospaced, copyable. Truncation shows the stated size and a clear marker. Credentials, tokens, and session identifiers show as `[redacted]`.
- Permission filtering is listed explicitly ("Brand C: creative assets excluded").
- Never show private model reasoning, and never imply it exists.
- Code browser: file tree, filename, highlighted code, and the deployed commit identifier. Include loading and fetch-failure states ("GitHub could not be reached", with retry).

### 7.9 Primitives

- Buttons: 40 px minimum height, 10-12 px radius, visible focus state. One primary action per view; destructive actions use danger and confirm.
- Cards 16 px radius. Composer 20 px. Badges pill-shaped.
- One outline icon set (Lucide), usually 18-20 px, paired with labels where meaning is unclear. Icon-only buttons have accessible names.
- Shadows are subtle and used mainly for floating menus and drawers.
- Focus ring: 2px teal with offset on every interactive element.
- Inputs: label above, helper and error text below; placeholder is never the label.

## 8. Observations, hypotheses, recommendations

Used in chat replies and artifact blocks. Order is always observation, hypothesis, recommendation. Omit a section with nothing to say.

| Type | Label | Treatment | Required content |
| --- | --- | --- | --- |
| Observation | "Observation: supported by supplied data" | Green bar, solid left border, check icon | Source-linked numbers and stated limitations |
| Hypothesis | "Hypothesis: possible explanation, untested" | Amber bar, dashed left border, lightbulb icon | The word "untested"; no causal verbs in the body |
| Recommendation / experiment | "Experiment: something to test next" | Teal bar, flask icon | Reasoning, supporting observations, how to measure, limitations |

An observation never contains causal claims. Causes appear only as hypotheses, and recommendations about them are framed as experiments.

## 9. States

Every data- or permission-dependent view defines all of these.

| State | Treatment |
| --- | --- |
| Loading | Skeleton matching the final layout; named run steps for agent work |
| Empty | One sentence on what belongs here, one action to fill it (a quiet joke is allowed) |
| Blocked by permission | Names what was excluded and why; links to the geek panel record |
| Missing data | States exactly what is needed; no guessing, no zero |
| Unavailable measurement | "Unavailable", muted, never `0` |
| Error | What happened, what was saved, the next action |
| Success | Quiet status change and artifact card; no confetti |

## 10. PDF export

- Same typography and block structure as the on-screen artifact. Print-safe: light backgrounds, at least 12 mm margins.
- Masthead with client name and accent rule. Footer with version, date, Draft or Approved label, and the synthetic-data note.
- Draft versions are labelled on every page. Approved requires approval of that exact exported version.
- Tables do not split a header from its first row.

## 11. Motion and accessibility

- Transitions 120-200 ms. Streaming text and step progress are the main moving elements. No decorative animation during work.
- Respect `prefers-reduced-motion`: fades instead of slides, no animated streaming cursor.
- Target WCAG 2.2 AA. Full keyboard operation, including tabs, menus, canvas nodes, block controls, drawers, and the geek panel. Drawers trap focus and return it to the trigger on close.
- Landmarks for sidebar, main workspace, and chat. Run status uses `aria-live="polite"`; errors use assertive.
- Alternatives to dragging files and to connecting nodes with a pointer.
- Works at 200% zoom.

## 12. Keep the demo focused

- Use existing UI components and one icon library.
- Source previews, brand imagery, and report charts must be meaningful, not decorative.
- Avoid neon gradients, glass panels, dense dashboard tiles, decorative gavels, and invented performance numbers.
- Out of scope: a reusable workflow library UI, billing and admin screens, finished image or video previews.
- Define loading, empty, success, and error states for every new component.

## 13. Design review checklist

- The client and active workspace are obvious.
- The 70/30 layout works without cramped content, and the 1100 px and 768 px layouts hold up.
- Files are easy to attach with mouse or keyboard.
- Sharing scopes are legible before analysis begins.
- Reports are readable without technical knowledge.
- Evidence is reachable in one click.
- Observation, hypothesis, and experiment are distinguishable without colour.
- Every major screen has empty, loading, success, error, blocked, and unavailable states.
- Technical details stay optional and match the selected execution.
- Humour adds personality without obscuring instructions.
- Contrast and focus checked on every new surface.
- The interface still looks useful when the hiring story is removed.
