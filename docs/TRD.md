# Technical Requirements Document — Agency Intelligence Workspace

Working name: **Exhibit A**. Status: implementation plan for a demo, not an existing deployed system. Product requirements are in [PRD.md](./PRD.md).

## 1. Goal

Implement the product described in [PRD.md](./PRD.md): a conversational workspace where clients' stored context becomes answers and block-based artifacts, artifacts are refined through conversation, anchored comments and manual edits, and consenting clients' data feeds a node-based intelligence canvas with chat. Follow [design-guidelines.md](./design-guidelines.md) for the interface.

The demo must have real persistence, server-enforced permissions, verifiable calculations, recoverable background work, and inspectable execution history. The courtroom is a separate video and is not part of this build.

Deployment requirements:

- Frontend on Vercel.
- Backend on Railway.
- Both deploy directly from the same GitHub repository.
- Use a monorepo because the backend is separate.
- No Prisma.

## 2. Architecture

```text
Browser
  → Vercel: Next.js interface and thin API proxy
      → Railway: Node.js API and background job runner
          → Neon PostgreSQL: records, job queue, uploads, and PDFs
          → OpenRouter: task-specific LLMs for chat, analysis, and edits
          → GitHub: deployed source code (read-only)
```

Vercel serves the interface and forwards short API requests. Railway owns business logic, authorization, retrieval, calculations, agent execution, artifact creation, AI calls, and exports.

The API and job runner initially run in the same Railway service. Jobs are stored in Neon PostgreSQL, so process memory is not the source of truth. A separate worker can be added later. Railway hosts the application only; there is no Railway database or object-storage bucket.

The browser polls for progress while a job is running and can leave or refresh and reconnect to the same execution. Streaming model tokens is optional later.

## 3. Technology choices

| Area | Choice | Reason |
| --- | --- | --- |
| Monorepo | pnpm workspaces | Shared types and one dependency lockfile |
| Frontend | Next.js, React, TypeScript | Familiar full-stack interface foundation |
| Styling | Tailwind CSS and reusable UI components | Implements the design guidelines quickly |
| Canvas | React Flow | Nodes, connections, movement, and zoom |
| Artifact editor | A block-based rich-text editor (chosen at scaffolding) | Stable block IDs, anchored comments, direct editing |
| Server state | TanStack Query | Fetching, mutations, polling, and cache refresh |
| Backend | Node.js, Fastify, TypeScript | Small, explicit API |
| Validation | Zod | Validate requests, artifact blocks, and structured AI output |
| Database | Neon PostgreSQL with `pg` and parameterized SQL | Direct database access without an ORM |
| Migrations | Versioned SQL migrations through a migration runner | Explicit schema changes and migration history |
| Job queue | Transaction-locked turn queue in Neon PostgreSQL | Durable leases without a separate service |
| Files | Binary `bytea` records in Neon | One persistent store for uploads, images, and PDFs |
| AI gateway | OpenRouter | Access to multiple model families through one integration |
| PDFs | A fixed server-rendered template fed by block data | Predictable layout from saved artifact versions |
| Code view | GitHub contents API through the backend, with a client-side highlighter | Native in-app code browsing at the deployed commit |
| Tests | Vitest and Playwright | Important backend checks and browser journeys |

Use OpenRouter for all model calls. Route different task types to configurable Claude, OpenAI GPT, or other supported models. Keep routing explicit and behind a small adapter. Exact model IDs will be selected after evaluation; assignments below are starting hypotheses, not claims of superior performance.

Select and pin compatible library versions when scaffolding; this document does not prescribe unverified version numbers.

## 4. Repository structure

```text
apps/
  web/                  Next.js app and thin API proxy
  api/                  Fastify API, jobs, tools, and PDF renderer
packages/
  contracts/            Shared request, response, and block schemas
  database/             SQL queries, migrations, connections, and seeds
fixtures/
  clients/              Fictional briefs, creatives, and campaign data
  evaluations/          Repeatable challenge cases
docs/
  PRD.md
  TRD.md
  design-guidelines.md
railway.json            Railway build and deploy configuration
pnpm-workspace.yaml
pnpm-lock.yaml
package.json
```

The frontend may import shared contracts, but not database code or backend secrets. Give workspace packages explicit names and dependencies. The Railway service builds from the repository root so shared packages are available.

### Neon connections

Only Railway connects to Neon. Use TLS with certificate verification and keep credentials server-side.

- `DATABASE_URL`: pooled Neon connection for ordinary API queries.
- `DIRECT_DATABASE_URL`: direct Neon connection for migrations and the job runner, avoiding dependence on transaction-pool session behavior.
- Use small bounded connection pools, query timeouts, and parameterized SQL. Run a transaction on one checked-out connection.
- Keep binary reads separate from ordinary metadata queries.
- Test queue recovery against Neon, including a cold compute restart. Account for connection retries without duplicating committed outputs.

Choose a SQL migration runner such as `node-pg-migrate`, use its migration ledger and locking, and keep migration files in version control.

## 5. Frontend routes

| Route | Purpose |
| --- | --- |
| `/` | Client cards and workspace choice |
| `/clients/:id` | Client context, conversation, and artifact |
| `/intelligence/:canvasId` | Node canvas, chat nodes, and cross-client artifacts |
| `/geek/:executionId` | Geek panel opened at one execution; also reachable as a panel from any view |
| `/geek/:executionId/code` | Native code view inside the geek panel |

Use the agreed 70/30 desktop layout. Within the main 70%, chat and artifact are simultaneously visible and scroll independently, with a fixed-height flex chat pane and a non-scrolling composer. The sidebar holds demo files above and run status below, plus the **For geeks** entry. Preserve the current conversation, canvas, artifact version, and scroll position when entering and leaving the geek panel.

Canvas nodes, connections, and layout are saved to the backend. Connecting nodes never grants access.

## 6. Demo access and client boundaries

The demo must open without setup. Opening the app with no session creates a unique browser session and an isolated demo agency populated from the fictional fixtures. No signup, password, or entry code is required. An optional entry code can be enabled by configuration if abuse requires it, and it is off by default. Abuse is limited by per-session and global usage caps and rate limits on session creation, uploads, and executions (section 19).

- Store an opaque session token in a Secure, HttpOnly, SameSite=Lax cookie.
- Store its hash and expiry in PostgreSQL. Suggested expiry: 24 hours.
- Keep the entry code, tokens, and cookies out of logs and payload records.
- Scope every query to the session's agency.
- Derive agency access from the session, never from a submitted agency ID.
- Check client, artifact, and source ownership on the server for every operation.

Normal client conversations may use that client's own information. Intelligence chat may use only information approved for that specific purpose.

Sharing scope has two separate flags:

- Performance patterns approved.
- Creative assets approved.

New uploads start restricted for intelligence. Demo consent controls model fictional approvals; they are not a legal consent-management system.

For pattern-only approval, provide approved summaries and normalized metrics rather than full private briefs, audience descriptions, or original assets. Recheck scope before tools read information and before results are served. Changes to permissions invalidate affected intelligence results and require a rerun. Data already viewed or downloaded cannot be recalled.

## 7. Main data records

| Record | Stores |
| --- | --- |
| Demo agency and session | Visitor isolation, access, expiry, and usage limits |
| Client | Brand voice, audience, goals, standing instructions, category, and sharing scope |
| Source | Owner, file metadata, binary-file ID, extracted content, and version |
| File blob | Original bytes, MIME type, size, checksum, and owning agency |
| Campaign data | Period, channel, campaign, currency, spend, impressions, clicks, conversions, and reported revenue |
| Creative reference | Client-scoped description, style and storytelling tags, linked campaign, optional image source |
| Canvas | Revision, nodes, connections, and layout |
| Canvas node | Type (client, brief, reference, idea, chat), position, and referenced client or source |
| Conversation and turn | User requests, attachments, assistant replies, and clarifications |
| Execution | Status, purpose, input versions, model-routing version, backend commit, timing, and error |
| Execution event | Ordered tool calls, results, checks, and progress |
| Model call | Task, requested/actual model, attempt, request and response payloads, tokens, duration, and reported or estimated cost |
| Artifact | Type, owning conversation, title, and current version |
| Artifact version | Ordered blocks, evidence links, source/permission fingerprints, and the cause (turn, comment, or manual edit) |
| Comment | Version, target block ID, author session, text, status, proposed patch, and resulting version |
| Approval | Reviewer session, exact artifact version, and time |
| Export | Artifact version, binary-file ID, checksum, label (Draft or Approved), and status |

Client conversations belong to one client; chat-node conversations belong to one chat node on one canvas. An execution belongs to one turn. Each retry attempt is recorded without losing the original execution.

Use structured JSON for blocks, canvas contents, tool records, and payloads. Keep ownership, versions, statuses, and approvals as explicit database fields.

Store file bytes in a dedicated `file_blobs` table using `bytea`, not base64 strings in JSON. Metadata lists never select the binary column. Scope deduplication to an agency or use an authorized immutable fixture reference; never expose another visitor's file through a checksum match.

## 8. Files and ingestion

First-version inputs:

- CSV campaign data.
- Text, Markdown, and text-based PDF briefs.
- PNG/JPEG creative references.
- `creative_references.csv` with client-scoped descriptions and tags linked to campaigns.

Use a 10 MB maximum per file, explicit type validation, and bounded row, page, and image limits. Reject unsupported or malformed files with a readable message. Scanned PDFs, OCR, audio, and video processing are out of scope.

Upload files directly to Railway, then persist their bytes and metadata in Neon. Request a short-lived, single-use upload ticket through the authenticated API first. Bind it to the session, client, file type, and maximum size, and validate it again when accepting the upload. Only the dedicated file endpoint accepts this ticket instead of the proxy secret.

The browser sends the multipart upload to Railway with the ticket in the Authorization header. Configure exact-origin CORS for this route, cap the request body, inspect actual content, and limit concurrent binary transfers. Use temporary buffers or files only during processing; Neon is the persistent store. Save the source and binary record transactionally, then enqueue extraction with a recoverable ingestion status.

Keep the 10 MB upload cap and initially cap generated PDFs at 10 MB too. Apply a configurable per-session total-storage limit. Return a clear size error instead of silently dropping a file. Seed shared immutable fixture bytes once while keeping visitor-specific metadata and permissions separate.

Creative references include a preview and tags. Route image observations to a configured vision-capable model through OpenRouter, using authorized image bytes. If no compatible model is available, compare supplied tags and descriptions and label that limitation. Do not imply that text-only analysis inspected an image.

Attaching a source to a turn does not change its owner or intelligence permissions. Dragging and click-to-attach share the same backend checks.

The dataset is small: retrieve explicitly selected sources and scoped database records. A vector database or general-purpose RAG pipeline is unnecessary for this version.

## 9. Conversation and agent workflow

Every user message is a turn. The agent decides whether to answer in conversation, ask a clarification, or also create or update an artifact. It creates an artifact only when the user asks for one or asks for a change to an existing one.

1. Save the turn and queue an execution. Use a unique submission key so retries do not duplicate turns. Validate client or chat-node access and any attachments; users do not submit campaign IDs.
2. Automatically load persistent context for the active client: bounded excerpts of brand voice, audience, goals, constraints and standing instructions, plus relevant creative descriptions and prior artifacts. Record the excerpts and checksums used.
3. Discover scoped file and campaign metadata, and use a structured model plan to select relevant records and brief sections. If the request is ambiguous or essential data is missing, reply with a clarification or an explanation of what is missing instead of guessing.
4. Calculate metrics in code.
5. Ask the model for a reply (and artifact blocks when requested) referencing metric and source IDs.
6. Validate the response: schema, references, numerical claims, evidence classification, and causal-language rules (section 10).
7. Save the reply, and the artifact version if one was produced, linked to its turn.
8. An AI failure fails the turn explicitly, retains any existing artifact, and can be retried by the user. A failed generation is never saved as a completed artifact.

Follow-ups use the previous artifact version and recent conversation. A turn can reference a specific displayed version; validate ownership and scope, and keep version numbers monotonically increasing even when revising an older version.

Calculate aggregate ratios from totals rather than averaging campaign ratios. Handle zero denominators as unavailable, not zero performance. Do not blend currencies or incompatible attribution definitions. Keep platform-reported conversions and revenue labeled, and flag mismatched periods or definitions. Chat replies carry numbers only from metric records, never from model-written arithmetic.

### Agent tools

Keep a small, explicit tool set. The backend fixes the agency, the active client or chat node, and the purpose for every tool call.

- `discover_sources`: list scoped file and campaign metadata.
- `retrieve_campaigns`: fetch scoped campaign rows.
- `read_source`: read an authorized source.
- `read_client_context`: read bounded persistent client context.
- `calculate_metrics`: compute metrics in code and return metric IDs.
- `compare_patterns`: compare approved cross-client patterns (intelligence only).
- `ask_clarification`: end the turn with a focused question.
- `create_artifact` / `update_artifact`: save a new artifact or version from validated blocks.
- `propose_block_edit`: used by the comment-edit path (section 11).
- `request_export`: queue a PDF.

Tools cannot choose arbitrary clients or bypass permissions. The agent cannot approve its own output or execute arbitrary code. Treat instructions inside uploaded documents as source content, not system instructions. Allow at most one repair attempt for malformed structured output. Limit tool steps, model output size, and total runtime; save partial work when useful and show an honest failure state.

## 10. Artifacts, evidence, and claims

### Block model

An artifact version is an ordered list of blocks validated by a shared schema. Each block has a stable ID that survives across versions, a type, content, and references.

Block types: heading, paragraph, metric table, chart, observation, hypothesis, recommendation, experiment, concept, limitation.

- **Observation:** states what the data shows. Requires metric or source references and may not use causal language. Includes limitations where relevant.
- **Hypothesis:** a possible explanation. Marked untested. May reference observations.
- **Recommendation:** a proposed action. Requires at least one supporting observation, its reasoning, a suggested measurement, and a limitation.
- **Experiment / concept:** a proposed test with supporting observations, adaptation for the target brand, and measurement.

Numerical values are rendered from metric records. Evidence links resolve to data rows and calculation records for the evidence drawer.

### Guardrails

- Reject a saved AI artifact that lacks a validated explanation and proposed experiment where its type requires them.
- Reject observations containing causal wording (for example "caused," "because of," "drove") that is not framed as a hypothesis. This is a heuristic check plus structured output rules, so it reduces but does not eliminate the risk. Evaluation cases measure it.
- Campaign totals alone never support a visual or storyline cause claim. Such causes appear only as hypotheses with a proposed test.
- Unverifiable references fail validation instead of being dropped.
- Show specific results such as "8 of 9 numerical claims verified." Never show a global accuracy percentage.

### Versions and approval

Every change creates a new version: a conversation turn, an accepted comment edit, or a manual edit. Each version records what created it. Approval attaches to one exact version, and any new version has no approval. Draft exports carry a Draft label; an Approved label requires approval of the exported version.

## 11. Comments and editing

### Anchored comments with AI proposals

1. The user attaches a comment to one block of a given version, optionally to a text selection inside it.
2. The backend validates ownership and that the block exists in that version, saves the comment, and queues a comment-edit execution.
3. The model receives only the target block, the comment text, the selection if any, that block's evidence references, and relevant client context. It returns a replacement for that single block.
4. Validate the proposal: the patch targets exactly the commented block ID; no other block is included; numbers in the patched block must still resolve to metric records unless the comment explicitly changes the claim, in which case it must still validate against metrics; schema and evidence rules still apply.
5. Store the proposal on the comment and show a before/after diff. The comment status moves from open to proposed.
6. Accepting creates a new version in which the target block is the only difference. Rejecting leaves the artifact unchanged.
7. If the artifact moved on before acceptance, rebase onto the latest version when the target block is unchanged; otherwise mark the proposal stale and offer to regenerate.

The server enforces the single-block rule by diffing the resulting block list; a patch that alters any other block is rejected as a defect and recorded.

### Manual editing

Users can edit any block directly, including text and numbers. Saving sends the changed blocks with the base version, creates a new version at the next version number, and clears approval. Reject a save whose base version is stale. Block structure and IDs are preserved. The evidence drawer continues to show the originally calculated value. The edit is recorded as an execution event with before and after content for the geek panel. The report body and PDF do not flag manual changes. The "N of M numerical claims verified" count describes the last AI-generated base, and the geek panel states which version it applies to.

Because manual edits are not rechecked, automated verification claims about report numbers apply to AI-generated versions only.

## 12. Intelligence canvas and chat nodes

The demo uses one saved canvas per agency session. Node types: client, new-client brief, reference, idea, chat. Any number of nodes may connect to a chat node. Saving checks the expected canvas revision to prevent overwriting another edit. Each chat node has its own saved conversation. Each turn stores the immutable canvas revision and the exact set of nodes connected to the chat node at that time.

Context resolution for a chat turn:

1. Find the nodes connected to the chat node in the stored revision.
2. For every client node, resolve sharing flags on the server at execution time. A client with no approvals contributes nothing; the chat reply says so.
3. Performance-pattern context contains normalized per-1,000-impression inputs and calculated rates; exclude raw totals, audience descriptions, and private client briefs. To let limitations such as different budgets still be stated, each campaign carries coarse scale bands (for example "10k to 20k") instead of raw spend or impressions. Grouped patterns (by visual style and storytelling approach) include a within-channel breakdown so a channel effect is not mistaken for a creative effect. Turn attachments and previous work are never part of intelligence context.
4. Creative context is included only for clients with creative-assets approval, and only the approved references.
5. User-added Markdown or text briefs, references, and ideas are explicit canvas context. Bound total text to 12,000 characters and imported files to 12 KB, with clear errors. Do not silently truncate canvas context.
6. Recheck selected permissions and source fingerprints before analysis, before commit, and before serving answers, artifacts, traces, approval, or PDFs.
7. With no creative references available, visual or storytelling questions get a request for the missing evidence. Generic experiment concepts can still use approved performance findings.

The chat answers naturally and can produce artifacts (category insight, campaign concepts, experiment plan) on request. Each concept or experiment includes the idea, supporting observations, adaptation for the new client, and suggested measurement. Hypotheses are labelled untested. Source references must resolve to approved records. Permission checks are enforced in code, never delegated to the model: one module builds the only context a chat node's prompts and tools receive, and every data query repeats the sharing check in SQL as a second barrier. Canvas references to a client's own files are refused, since those are reachable only through that client's approvals. Store source and permission versions so changed approvals or inputs invalidate old results.

## 13. Model routing

Use a small server-side configuration mapping task names to primary and fallback OpenRouter model IDs:

| Task | Starting direction | Required capability |
| --- | --- | --- |
| Request interpretation and tool use | A configured GPT or Claude model | Tool calling |
| Chat reply and report explanation | A configured Claude or GPT model | Structured text output |
| Cross-client reasoning | A configured reasoning-capable model | Evidence-based comparison |
| Block edit proposals | A configured fast model | Structured single-block output |
| Creative reference inspection | A configured vision model | Image input |
| Campaign concepts | A configured creative-writing model | Structured concepts and experiment briefs |
| Extraction or short summaries | A smaller configured model | Validated structured output |

Multiple tasks may share a model where that works well. Use more than one model family in the demo after evaluation, without calling several models redundantly for every step. "ChatGPT" here means an available OpenAI GPT model accessed through OpenRouter, not the ChatGPT application.

Verify tool, image, and structured-output support for each selected model and provider combination. Prefer compatible routes and reject unsupported ones. Fall back only to an explicitly configured compatible model. Record the requested model, returned model, and any upstream provider information supplied; show unavailable fields honestly.

Snapshot routing configuration for each execution. Log each call separately so the geek panel shows which model performed each step. Switching a model changes the routing version and triggers the relevant evaluation cases.

Keep OpenRouter credentials on Railway. Deterministic calculations, access checks, and numerical verification remain code, regardless of model choice. A second LLM may provide critique, but its opinion is not a substitute for those checks.

## 14. Jobs, retries, and progress

Execution statuses: queued, running, waiting to retry, succeeded, failed, or cancelled.

- Poll roughly every two seconds during an active run; stop after a terminal status.
- Use ordered event IDs so the browser fetches only new progress records.
- Start with one active background job per backend instance, and one active turn per client or chat node to prevent artifact-version races.
- Retry transient network and provider failures at most twice with backoff.
- Do not retry access denials or invalid user input automatically.
- Recover expired job leases after restarts using the durable queue. Workers commit outputs only while holding their lease.
- Recheck permissions before resuming work.

Retries can repeat external calls. Make writes idempotent: unique submission keys for new runs and a unique artifact version per cause. Persist the PDF bytes and the successful export record transactionally. Protect state changes from stale attempts. Do not promise exactly-once model calls.

Coordinate OpenRouter model fallbacks with application retries under one attempt and spending budget. Record every attempt. Do not let provider fallback, output repair, and queue retries multiply without a shared limit.

Token reservations use a bounded estimate for the focused prompt, reconcile against actual provider usage, and distinguish reserved from spent tokens. Provider failures and budget exhaustion fail the turn explicitly and can be retried by the user.

Cancellation is cooperative: stop before the next tool or model step, preserve the record, and never mark a cancelled job complete.

## 15. Geek panel and code view

### Per-turn records

The geek panel renders the same saved execution events as the sidebar run overview, with full detail. For each turn it shows:

- The request, attachments, and the information available at that moment, including what permission filters excluded.
- Each tool call with its input and result payloads and duration.
- Each model call with task, requested and actual model, provider details when available, request and response payloads, input and output tokens, latency, and reported or estimated cost.
- Calculations performed in code, validation results, repairs, retries, and errors.
- The artifact version produced, and comment-edit and manual-edit events.
- Input and source versions, prompt and routing versions, and the backend commit.
- A per-turn and per-model breakdown of latency, tokens, and cost.

Payloads are stored in full, in JSON, per model call and tool call, bounded by a configured size with a visible truncation marker. Redact credentials, session tokens, and upload or download tickets before storage. Do not store or display private model reasoning; show only the messages sent and the content returned. Payload reads are scoped to the owning agency. Payloads can contain approved client data, so serve them only to the session that owns the execution.

A live check count is not a global accuracy percentage. Evaluation results show case count, dataset version, model, and run date.

### Native code view

The geek panel includes a button that opens a code browser inside the panel: file tree plus syntax-highlighted code. Reviewers never leave the app.

Fetch source from one configured GitHub repository through the backend. Cache allowed text files and render them as code, never executable HTML.

- Use an explicit allowlist covering application code, shared packages, and safe documentation.
- Exclude secrets, environment files, generated binaries, and sensitive outputs.
- Reject arbitrary repository URLs and path traversal.
- Keep any GitHub token server-side.
- Display the frontend and backend commit IDs separately; deployments may finish at different times.
- Let reviewers inspect code at immutable commits rather than the latest branch state. A run links to the backend commit that executed it, and the code view can open at that commit.
- Show a clear unavailable state if GitHub cannot be reached.

The repository is intended to be public, because the code is shared with reviewers. A public repository needs no GitHub token for the code view, though one can still be configured to avoid rate limits. The repository URL is supplied during setup.

## 16. API outline

Use REST under `/v1` with schemas shared through `packages/contracts`.

| Area | Operations |
| --- | --- |
| Session | Enter demo, inspect session, end session |
| Clients | List, read context, update fictional sharing scope |
| Sources | Issue upload ticket, accept multipart upload, inspect, attach, authorized download |
| Conversations | Read turns, submit a turn with an idempotency key |
| Canvases | Create, read, save revision (nodes, connections, layout) |
| Executions | Read status, fetch new events, read model-call and tool-call payloads, cancel |
| Artifacts | Read, list versions, save manual edit against a base version, approve exact version |
| Comments | Create on a block, read, accept or reject a proposal, regenerate a stale proposal |
| Exports | Queue PDF, inspect export, request download |
| Repository | Read allowed file tree and file content at a deployed commit |
| System | Health, readiness, API version, and backend commit |

Every error has a code, readable message, and request ID. Validate ownership of IDs rather than trusting a parent ID supplied with them. Use revision checks to reject stale canvas saves, manual edits, and approvals.

## 17. Frontend/backend connection

The browser calls same-origin Next.js API routes, which forward requests to the configured Railway HTTPS URL. The proxy contains no business logic and does not hold a database connection.

- Forward only required headers and session cookies.
- Preserve session Set-Cookie headers without a backend Domain attribute.
- Check the browser Origin on mutations; use a CSRF token for authenticated writes.
- Authenticate the Vercel-to-Railway connection with a server-only shared secret.
- Railway validates both that secret and the visitor session.
- Use a fixed upstream URL and allowed route mapping; never accept arbitrary proxy targets.
- Use short timeouts; enqueue long work instead of holding proxy requests open.

Binary transfers bypass Vercel to avoid routing up-to-10-MB bodies through its functions. Uploads use the scoped ticket described above. Downloads use a short-lived, revocable ticket issued after authorization and served by Railway from Neon. Validate session expiry and current source permissions again at download time. Do not log ticket values; return appropriate private/no-store cache headers and safe filenames. Ordinary API calls still use the Vercel proxy and session cookie.

## 18. GitHub deployment

### Vercel

- Connect the monorepo through the GitHub integration.
- Set project root to `apps/web` and allow access to shared workspace packages outside it.
- Use the root lockfile and pinned package-manager version.
- Build the web app and its shared dependencies.
- Store `BACKEND_URL` and `BACKEND_PROXY_SECRET` as server-only variables.
- Deploy the chosen primary branch; `main` is the default for a new repository.

### Railway

- Connect the same repository and branch.
- Create the backend service and connect it to the supplied Neon database. Do not create a Railway PostgreSQL service or bucket.
- Keep the service root at the repository root because packages are shared. No Docker: Railway builds from source using the commands in `railway.json` (install with the lockfile, then build the API).
- Start the API and job runner together with one start command.
- Listen on `0.0.0.0` using Railway's supplied port.
- Run versioned SQL migrations against Neon using the direct connection as a pre-deploy command; stop deployment on failure.
- Seed fictional fixtures explicitly and idempotently, not by resetting the database on startup.
- Configure readiness checks, restart behavior, and watch paths covering backend code, shared packages, fixtures, lockfile, and deployment configuration.
- Enable GitHub autodeploy from the primary branch.

### Release behavior

There is no CI pipeline. Vercel and Railway deploy directly from GitHub pushes and build independently. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` locally before pushing to the primary branch. A failed build on either platform keeps the previous deployment live.

Keep API and database changes backward-compatible during overlapping deployments. Show backend version incompatibility as a readable error. For previews, explicitly configure a separate Railway demo environment and Neon development branch or database; Vercel previews do not automatically receive a matching Railway backend or Neon branch. Seed preview data without copying visitor sessions or credentials from the live demo.

Before a demo release, smoke-test both workflows, comments and manual editing, export and download, permissions, and the code view against deployed commits. Application rollback does not undo database migrations; use additive migrations for this demo.

## 19. Configuration

Keep values in platform environment settings and provide placeholder-only `.env.example` files.

| Service | Required configuration |
| --- | --- |
| Vercel | Backend URL, proxy secret, allowed app origin, frontend commit metadata |
| Railway database | `DATABASE_URL`, `DIRECT_DATABASE_URL` from Neon |
| Railway access | Proxy secret, optional demo entry code (off by default), permitted app origins, session and ticket settings, session-creation rate limit |
| Railway AI | `OPENROUTER_API_KEY`, task-specific model IDs and fallbacks, runtime and token limits, demo usage cap |
| Railway files | File-size cap, per-session storage cap, ticket expiry, transfer concurrency |
| Railway geek panel | Payload size cap per call |
| Railway code viewer | Repository owner and name, optional read token, backend commit metadata |

Only genuinely public values may use the `NEXT_PUBLIC_` prefix. Validate required configuration at startup. Budget model calls per session and globally; rate-limit demo entry, uploads, and execution requests. Keep usage caps configurable.

## 20. Verification and completion

Required automated checks:

- Metric calculations, including weighted ratios, zero values, and mismatched inputs.
- Agency and client ownership and intelligence permissions, including that connecting a node never widens access.
- Chat-node context contains only approved fields per client.
- Invalid AI references and structured-output repair limits.
- Block schema rules: observations carry references and no causal language, hypotheses are untested, recommendations carry reasoning, measurement, and limitation.
- A comment edit changes only its target block, and a patch touching any other block is rejected.
- Stale proposal handling and rebase.
- Version creation for conversation, comment, and manual edits; approval invalidation for each.
- Manual edit rejects a stale base version.
- Submission and export idempotency and failed-export status.
- Job recovery and permission rechecks.
- Binary file round trips, checksums, size limits, ticket scope and expiry, and authorized download.
- Task-to-model routing, compatible fallbacks, and per-call measurement records.
- Payload redaction and size truncation in geek records, and agency scoping of payload reads.
- Code view allowlist, path traversal rejection, and commit pinning.

Browser checks cover conversational answers without artifacts, report generation, evidence inspection, commenting with accept and reject, manual editing and download, approval and export, canvas chat with connected clients, restricted sources, refresh recovery, the geek panel at the right turn, and the in-app code view. Conversation cases include latest-two-Pinterest selection, conversion-focused follow-ups, optional attachments, ambiguous requests, missing data, and inspecting both turns.

Use deterministic model fixtures in automated tests; run a small labeled live-model evaluation separately before recording the demo, including the causal-language and missing-creative cases. Compare selected models on the tasks they perform and record the routing configuration with results.

Initial demo targets, to be measured rather than promised: acknowledge job submission within one second under light load; show new progress within about three seconds; complete the seeded workflows within two minutes where provider response time allows. Record actual results.

The build is done when the deployed app completes both workflows, supports comment and manual editing with versions, enforces the demonstrated boundaries, preserves execution history after refresh, exports a real file, and exposes matching payload-level evidence and source code inside the app.

## 21. Deliberate limits

No microservices, Redis, Kubernetes, enterprise identity, billing, vector database, live ad-account writes, reusable workflow library, real-time multi-user collaborative editing, general web crawling, or production compliance work. No automatic posting, finished image or video generation, or courtroom UI.

The demo uses fictional data and a small number of visitors. It demonstrates sound behavior within measured cases, not production readiness or universal AI accuracy.

## 22. Deployment references

Platform documentation checked October 6, 2026:

- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [Railway shared monorepos](https://docs.railway.com/deployments/monorepo)
- [Railway GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)
- [Railway deployment settings and pre-deploy commands](https://docs.railway.com/deployments)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon database branching](https://neon.com/docs/get-started-with-neon/workflow-primer)
- [PostgreSQL binary data types](https://www.postgresql.org/docs/current/datatype-binary.html)
- [OpenRouter models](https://openrouter.ai/docs/guides/overview/models)
- [OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
