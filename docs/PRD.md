# PRD: Agency Intelligence Workspace

## 1. Purpose

Build a working demo of a conversational workspace that helps a marketing agency:

- Turn each client's stored context into answers and finished work through conversation.
- Learn across clients who explicitly approve sharing, using a node-based intelligence canvas with chat.
- Refine any deliverable with inline comments and manual edits instead of starting over.
- Inspect exactly how every turn was produced, down to payloads, models, and source code.

The essential promise: ask for work, let the system gather the right permitted context, receive a useful answer or deliverable, and refine it without starting over.

The demo should feel like a complete, usable application and use sound engineering without the infrastructure of a production platform. The courtroom is a separate video created afterward.

## 2. Users

**Agency owner:** Finds patterns across approved clients and develops ideas for new campaigns.

**Account manager:** Asks questions, produces client deliverables, checks evidence, and reviews recommendations.

**Juma engineer / reviewer:** Opens the geek panel and source code to understand how the system works.

## 3. Principles

1. **Conversation first.** The system answers naturally. It produces an artifact only when the user asks for one ("turn this into a client report"), never as a side effect of every question.
2. **Persistent context.** Users never re-explain the brand. Each client's voice, audience, goals, instructions, campaign data, creative examples, and previous work are stored and retrieved automatically.
3. **Evidence before claims.** Numbers are calculated in code. Models interpret and propose. Every factual claim links to its source.
4. **Observations, hypotheses, recommendations are different things.** The system never presents a hypothesis as a finding. Campaign totals alone are never claimed as the cause of success.
5. **Permissions are enforced on the server.** Connecting nodes or attaching files never grants access.
6. **Everything is inspectable.** The geek panel shows what happened in every turn. It never shows private model reasoning.

## 4. App layout

The screen has two main sections:

**Left 70%: Main workspace**

Two starting options:

- Client workspaces.
- Intelligence canvas.

This area contains client cards, conversations, artifacts, and the canvas.

**Right 30%: Supporting information**

- Top: Demo files, grouped by client and scenario.
- Bottom: A simple overview of the current run (step, elapsed time, sources, checks, output status).

The sidebar also includes **For geeks**, which opens the geek panel (section 9). There is no separate "view code" link; the source code opens inside the geek panel.

On smaller screens, the sidebar can collapse.

### Reviewer entry and guided scenarios

The demo is shared with people who have no account and no instructions, so it must open without setup:

- Opening the link starts a private demo session with the fictional agency already loaded. There is no signup, entry code, or configuration step.
- The home screen offers three guided scenarios as one-click starting prompts. Each runs against the real system, not a recording:
  1. **Evidence:** ask for a recommendation, then ask "what's your evidence?" The answer shows the supporting records and calculations, and separates findings from hypotheses.
  2. **Permissions:** on the canvas, connect an approved client, a restricted client, and a new-client brief to a chat node, then ask for a combined idea. Restricted material is visibly excluded, and approved patterns inform a proposed experiment.
  3. **Memory:** open a client and ask for a deliverable without explaining the brand. The system already knows the brand, retrieves the data, produces the artifact, and handles a follow-up.
- Users can ignore the scenarios and ask anything.
- When something is blocked or missing, the reply says what was excluded and why, and the geek panel shows the same record.

## 5. Main user flows

### 5.1 Client conversation

1. Select a client card and view its brief, brand information, and available data.
2. Ask naturally, for example: "Compare our last two Pinterest campaigns. Explain what changed and suggest what we should try next."
3. The agent uses the client's stored context and the conversation history, discovers relevant client-scoped sources, and calculates metrics in code. Manual campaign selection is never required. Optional files can be dragged from the sidebar or attached with a button; attachments add explicit context and grant no permissions.
4. If a request is ambiguous ("last two campaigns" has several meanings) the agent asks a focused clarification. If essential data is missing it says what is needed instead of guessing.
5. The agent replies in plain language. Numerical statements link to evidence. The reply separates what the data shows, what might explain it, and what to try.
6. When the user asks for a deliverable, the agent creates an artifact beside the conversation (section 5.2). Chat and artifact scroll independently, and the message box stays anchored at the bottom.

The agent never fabricates missing creative examples and never claims that text descriptions are inspected images.

### 5.2 Artifacts

Supported artifact types:

- Performance report
- Campaign brief
- Client summary
- Campaign concepts
- Experiment plan

Artifacts are made of blocks (headings, paragraphs, tables, charts, observations, hypotheses, recommendations, experiments, limitations). Every block has a stable identity, so edits can target exactly one block.

Factual blocks link to supporting sources, and the evidence drawer shows the data rows and calculation behind a number.

### 5.3 Refining an artifact

Three ways to change an artifact; each produces a new version linked to what caused it.

**Conversation.** "Focus on conversions." "Use this creative reference." "Make this ready for the client." The agent updates the artifact using prior turns and attachments. The new version links to the turn that created it.

**Inline comments (AI-assisted editing).** Users comment on a block, such as a heading, paragraph, or recommendation. Example: a comment on the title that says "change this to something punchier."
- The AI proposes a replacement for that block only, shown as a before/after diff.
- The user accepts or rejects. Accepting creates a new version in which only that block differs.
- A comment can never change anything outside the block it is attached to.
- Proposed edits to blocks that contain numbers must keep them tied to their calculated metrics.

**Manual editing.** Users can edit any block directly, including text and numbers, then save and download. A manual save creates a new version. The evidence drawer keeps showing the originally calculated value, and the edit is recorded in the geek panel with before and after. The report itself does not flag manual changes.

### 5.4 Approval and export

- Approval applies to one specific version. Any later edit, whether by conversation, comment, or manual change, requires approval again.
- The artifact pane can be closed to give the conversation the full width, and reopened from the chat or by a new version.
- Download a PDF of any version. A version that is not approved is labelled Draft. An Approved label requires approval of the exported version.
- An export counts as complete only after the file is successfully created.

### 5.5 Intelligence canvas

The canvas is node-based. Users arrange nodes on a canvas and draw connections between them.

Node types:

- **Client card:** a client that has approved information for intelligence. Shows exactly what is approved (performance patterns, creative assets).
- **New-client brief:** the prospect being planned for.
- **Reference:** an uploaded creative or document reference.
- **Idea:** the agency's own note or hypothesis.
- **Chat node:** a conversation whose context is whatever is connected to it.

Flow:

1. Place two or more client cards and connect them to a chat node. Briefs, references, and ideas can connect too.
2. Chat with the combined approved context, for example: "What is working for these brands?" or "What patterns do they share?"
3. The agent answers from the approved data. It might report that Brand A's visual language performs well and Brand B's storytelling performs well, then suggest combining the two for the new clothing brand as something to test.
4. Ask for an artifact (category insight, campaign concepts, or an experiment plan). It opens beside the chat and supports the same comments, manual edits, versions, approval, and PDF export as client artifacts.

Rules:

- Any number of nodes can connect to a chat node. The server filters every client's data by its sharing flags.
- Connecting nodes does not grant access. Dropping a client on the canvas without approval yields nothing from that client.
- Permission to compare performance patterns does not permit reuse of creative assets. The two approvals are separate.
- Performance-only sharing exposes normalized rates and approved patterns. Private briefs, audience details, and creative assets stay excluded.
- User-supplied new-client briefs, references, and ideas are explicit context.
- With no approved creative references, visual or storytelling questions get a request for the missing evidence rather than invented patterns. Generic experiment ideas can still use approved performance findings.
- The system proposes what to test. It does not promise a remix will perform.

The canvas, its nodes, connections, and each chat node's conversation are saved.

Example question:

"Use the visual patterns from Brand A and the storytelling patterns from Brand B. What could we test for this new clothing brand?"

## 6. Feature list

| Feature | What it does | Demo scope |
| --- | --- | --- |
| Client cards | Open a client's workspace, context, files, and history. | Three fictional clothing brands with distinct information. |
| Persistent client context | Brand voice, audience, goals, instructions, campaign data, creative examples, and previous work are stored once and retrieved automatically. | Text and CSV context plus tagged creative references. |
| Client conversation | Natural answers with source-linked claims and focused clarifications. | Text messages and file attachments. |
| Artifacts | Performance report, campaign brief, client summary, campaign concepts, experiment plan, made of addressable blocks. | Created only on request. One consistent layout per type. |
| Evidence drawer | Shows the source and calculation behind a numerical claim. | Clickable claims linked to data rows and calculated metrics. |
| Inline comments | Block-anchored comments that produce an AI-proposed edit to that block only. | Propose, review diff, accept or reject. |
| Manual editing | Direct editing of any block, then save and download. | Each save is a new version. |
| Versions and approval | Every revision is a version linked to its cause. Approval applies to one version. | Editing an approved artifact requires approval again. |
| PDF export | Downloadable PDF of a chosen version. | Completion shown only after the file exists. |
| Intelligence canvas | Node-based canvas with client, brief, reference, idea, and chat nodes. | Draggable nodes, labelled connections, saved layout. |
| Sharing permissions | Controls which client information cross-client chat can use. | Separate approval for performance patterns and creative assets. |
| Cross-client chat | Chat over the connected, approved context of all connected clients. | Findings, comparisons, and combination ideas with evidence and limitations. |
| Demo file panel | Makes scenario files easy to find and attach. | Client briefs, campaign CSVs, creative examples, challenge files. |
| Run overview | Shows what the system is doing and whether it succeeded. | Current step, elapsed time, sources, checks, output status. |
| Geek panel | Shows what happens under the hood for every turn. | Section 9. |
| X-ray | One switch overlays every answer and artifact block with where it came from: metric IDs, whether values were calculated or written by a model, the checks, and which models gathered and wrote it. | Toggle in the workspace header. |
| Data passport | Shows exactly what flows through each canvas connection and what does not, and why, with "0 fields shared" for a restricted client. | Derived from the same context the model receives. |
| Native code view | Browse the deployed source code without leaving the app. | Opened from the geek panel; section 9. |

## 7. How intelligence should behave

Every answer and artifact distinguishes three things:

- **Observation:** What the supplied data shows. It cites sources and states its own limitations (different budgets, audiences, small samples).
- **Hypothesis:** A possible explanation or a possibility for another campaign. It is labelled untested.
- **Recommendation:** A proposed action or experiment, with the reasoning behind it, the observations it rests on, how to measure it, and its limitations.

Campaign totals alone must never be stated as the reason a visual, storyline, or tactic succeeded. Causes appear only as hypotheses, and a recommendation about them is framed as an experiment.

Every number comes from a code-calculated metric. Unavailable measurements are marked unavailable, not zero.

## 8. Demo data

Use fictional brands and clearly labeled synthetic performance data.

Include:

- Two brands with information approved for intelligence.
- A third brand with restricted information.
- Creative examples tagged by visual style and storytelling approach, linked to campaigns.
- Two reporting periods for performance comparisons, including several Pinterest campaigns.
- A new-client brief.
- Files that introduce misleading instructions, missing values, or conflicting information.

This allows reviewers to try both normal work and difficult scenarios without real client accounts.

## 9. Geek panel and code view

**For geeks** opens a panel that explains every turn in the current conversation or canvas chat. It opens at the turn the user is viewing and lets them move between turns. It never shows private model reasoning.

For each turn it shows:

- The request, attachments, and the approved information available at that moment.
- Every tool call, with input payload and result payload.
- Every model call: task, requested and actual model, provider when available, full request and response payloads, input and output tokens, latency, and estimated cost.
- Calculations performed in code and the checks that ran, including validation failures and repair attempts.
- Retries, errors, and timing for each step.
- The artifact version produced, and any comment-edit or manual-edit events.
- What permissions filtered out (for example, "Brand C: creative assets excluded").

Payloads are shown raw so reviewers can see exactly what the model received and returned. Credentials, tokens, and session identifiers are redacted. Very large payloads are cut at a stated size with a clear marker.

**Source code.** The geek panel has a button that opens a native code browser inside the panel: file tree plus syntax-highlighted code. It fetches the deployed code from the repository at the exact commit that is running. Reviewers never need to open GitHub. If GitHub cannot be reached, it says so.

Closing the panel returns the user to the same conversation, artifact, and canvas position.

## 10. Engineering standards

Keep the implementation small and understandable:

- Use Next.js, TypeScript, and PostgreSQL. The frontend runs on Vercel, the backend on Railway, data and files in Neon, and models through OpenRouter. Frontend and backend share a monorepo deployed through GitHub, without Prisma.
- Use a simple demo sign-in and enforce access on the server.
- Calculate numerical metrics in code.
- Use the AI for explanations, comparisons, edits, and campaign concepts. Different tasks can use different models; the routing is configurable and verified by evaluation.
- Validate file inputs and AI outputs before using them.
- Save conversations, artifact versions, comments, approvals, and execution records.
- Run longer tasks in the background so refreshing the page does not lose them.
- Limit retries and avoid duplicate exports.
- Keep API keys on the server.
- Show clear errors and missing information. An AI failure is never represented as a completed artifact.
- Record tool inputs and results, not private model reasoning.
- Mark unavailable measurements as unavailable.

Do not display an unexplained "accuracy score." Show specific results such as "8 of 9 numerical claims verified."

## 11. Execution history

Organize records as:

**Client or canvas chat → conversation → turn → execution**

Each execution stores the request and attachments, the approved information available at that time, tool calls and results, model calls with payloads, generated outputs and versions, checks and errors, and timing and usage measurements.

The geek panel opens the execution behind the answer or artifact version the user is viewing.

## 12. Verification

Use a small set of repeatable checks covering the important behavior:

- Report numbers match independently calculated results.
- Client workspaces cannot retrieve another client's restricted records.
- Intelligence uses only information approved for that purpose, and connecting a node never widens access.
- A comment edit changes only its target block.
- Artifact edits invalidate earlier approval.
- Failed exports are not marked complete.
- Retrying an export does not create duplicate deliverables.
- A page refresh preserves the execution and its progress.
- Conversation checks cover: automatic selection of the latest two Pinterest records, conversion-focused follow-ups, optional attachments, ambiguous requests, missing data, and inspection of both turns.
- Causal-language checks: observations contain no causal claims, and hypotheses are labelled untested.

Record actual results. Passing these checks demonstrates the tested behavior, not guaranteed correctness for every possible request.

## 13. Out of scope

For this demo, exclude:

- Live Google Ads and Meta Ads connections.
- A reusable workflow library.
- Billing, enterprise administration, and complex user roles.
- Automatic campaign publishing or budget changes.
- Finished image or video generation.
- Production compliance certification.
- Courtroom functionality inside the app.

## 14. Build order

1. Client workspaces, demo files, persistent context, and saved conversations.
2. Conversational answers with evidence, then block-based artifacts, versions, approval, and PDF export.
3. Intelligence canvas with chat nodes, sharing permissions, and cross-client answers and artifacts.
4. Run overview, geek panel, and native code view. After this step the three guided scenarios work end to end.
5. Inline comments, AI-proposed block edits, and manual editing.
6. Verification, visual polish, and demo walkthrough.

## 15. Definition of done

A reviewer can:

- Open the demo link and start working with no setup.
- Run the three guided scenarios (evidence, permissions, memory) and see each behave as described.
- Ask a client question and get a natural, evidence-linked answer without an artifact being forced.
- Ask for a report and download it as a PDF.
- Inspect the evidence behind its numerical claims.
- Comment on a heading, accept the AI's proposed change, and see that nothing else changed.
- Edit an artifact by hand, save, and download it.
- Connect clients to a chat node and get cross-client findings and campaign experiments.
- See restricted information excluded from analysis.
- Open the geek panel for any turn and see tool calls, model calls, payloads, latency, and usage.
- Browse the code corresponding to the deployed demo from inside the app.

The result should be a focused working product that demonstrates product judgment, full-stack development, and measurable AI behavior.
