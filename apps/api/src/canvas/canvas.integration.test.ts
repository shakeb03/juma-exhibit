import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "@exhibit/contracts";
import { setClientSharing } from "@exhibit/database";
import { ScriptedModel, createHarness, toolCall, type Harness, type World } from "../testing/harness.js";

const key = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/evaluations/answer-key.json"), "utf8"));

let h: Harness;
beforeAll(() => { h = createHarness(); });
afterAll(async () => { await h.close(); });

const edge = (source: string, target = "chat-1"): CanvasEdge => ({ id: `${source}->${target}`, source, target });
const RL = "client-ridgeline-outfitters";
const MF = "client-marlowe-finch";
const VS = "client-velvet-static";
const TW = "brief-tidewell-swim";

interface Canvas { revision: number; nodes: CanvasNode[]; edges: CanvasEdge[] }
async function loadCanvas(w: World): Promise<Canvas> {
  return (await w.get("/v1/canvas")).json();
}
async function save(w: World, canvas: Canvas, patch: Partial<Canvas> = {}) {
  return h.app.inject({
    method: "PUT", url: "/v1/canvas", headers: w.headers,
    payload: { baseRevision: canvas.revision, nodes: patch.nodes ?? canvas.nodes, edges: patch.edges ?? canvas.edges },
  });
}
/** Connect the given nodes to the chat node and save, returning the new canvas. */
async function connect(w: World, ids: string[]): Promise<Canvas> {
  const canvas = await loadCanvas(w);
  const res = await save(w, canvas, { edges: ids.map((id) => edge(id)) });
  expect(res.statusCode).toBe(200);
  return loadCanvas(w);
}
const chatTurn = async (w: World, message: string, key?: string) => {
  const res = await w.post("/v1/canvas/chats/chat-1/turns", { message }, { "idempotency-key": key ?? `canvas-${Math.random().toString(36).slice(2)}-0000` });
  expect([200, 202]).toContain(res.statusCode);
  return res.json() as { turnId: string; executionId: string; canvasRevision: number };
};
const turnRow = async (id: string) => (await h.db.query("select * from turns where id = $1", [id])).rows[0];

// Scope ids the model may cite, as listed in its prompt.
const BOLD = "ridgeline-outfitters:visualStyle:bold-on-location";
const STORY = "marlowe-finch:storytelling:customer-story";
const obs = (key: string, text: string, ids: string[]) => ({ type: "observation", key, text, metricIds: ids, sourceRefs: [] });
const experiment = (n: number) => ({
  type: "experiment", title: `Concept ${n}`, hypothesis: "Pairing on-location imagery with a customer story may lift both clicks and conversion.",
  design: "Run it for the new brand: a coastal on-location photo with a short customer story caption, against a plain studio control, on Pinterest.",
  measurement: "Compare clicks and conversions per 1,000 impressions between the two arms.",
  limitation: "The source brands differ in scale and audience, so the pairing is a test, not a prediction.", basedOn: ["o1", "o2"],
});
const conceptsArtifact = (count = 3) => ({
  action: "create", kind: "campaign_concepts", title: "Three concepts for Tidewell Swim",
  blocks: [
    obs("o1", "On-location creative reached a CTR of {{metric:" + BOLD + ":ctr}} at Ridgeline.", ["metric:" + BOLD + ":ctr"]),
    obs("o2", "Customer-story creative reached a conversion rate of {{metric:" + STORY + ":conversionRate}} at Marlowe & Finch.", ["metric:" + STORY + ":conversionRate"]),
    ...Array.from({ length: count }, (_, i) => experiment(i + 1)),
    { type: "limitation", text: "Budgets, audiences, and attribution windows differ between the two brands." },
  ],
});
const finishCall = (artifact?: unknown) => [toolCall("finish", { reply: { message: "Here are three concepts to test." }, ...(artifact ? { artifact } : {}) })];

/** Everything a model was sent, as one searchable string. */
const sent = (m: ScriptedModel) => JSON.stringify(m.requests.map((r) => ({ messages: r.messages, tools: r.tools })));

describe("canvas revisions", () => {
  it("returns the seeded canvas, saves new revisions, and keeps each as an immutable snapshot", async () => {
    const w = await h.newWorld();
    const first = await loadCanvas(w);
    expect(first.revision).toBe(1);
    expect(first.nodes).toHaveLength(5);
    const moved = first.nodes.map((n) => (n.id === RL ? { ...n, position: { x: 300, y: 300 } } : n));
    const res = await save(w, first, { nodes: moved });
    expect(res.json().revision).toBe(2);
    const snapshots = (await h.db.query("select cr.revision, cr.nodes from canvas_revisions cr join canvases c on c.id = cr.canvas_id where c.agency_id = $1 order by cr.revision", [w.agencyId])).rows;
    expect(snapshots.map((s) => s.revision)).toEqual([1, 2]);
    expect(snapshots[0].nodes.find((n: CanvasNode) => n.id === RL).position).not.toEqual({ x: 300, y: 300 });
    expect(snapshots[1].nodes.find((n: CanvasNode) => n.id === RL).position).toEqual({ x: 300, y: 300 });
  });

  it("rejects a stale save with the current version, so one edit never overwrites another", async () => {
    const w = await h.newWorld();
    const first = await loadCanvas(w);
    expect((await save(w, first, { edges: [edge(RL)] })).statusCode).toBe(200);
    const stale = await save(w, first, { edges: [edge(MF)] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("revision_conflict");
    expect(stale.json().current.revision).toBe(2);
    expect(stale.json().current.edges.map((e: CanvasEdge) => e.source)).toEqual([RL]);
  });

  it("refuses canvases that point at things this workspace does not own or may not use", async () => {
    const a = await h.newWorld();
    const b = await h.newWorld();
    const canvas = await loadCanvas(a);
    const bad = async (nodes: CanvasNode[], edges: CanvasEdge[] = canvas.edges) => (await save(a, canvas, { nodes, edges }));

    const foreignClient: CanvasNode = { id: "client-x", type: "client", position: { x: 0, y: 0 }, clientId: b.client["ridgeline-outfitters"] };
    expect((await bad([...canvas.nodes.filter((n) => n.id !== RL), foreignClient])).statusCode).toBe(400);

    const duplicate: CanvasNode = { id: "client-dup", type: "client", position: { x: 0, y: 0 }, clientId: a.client["ridgeline-outfitters"] };
    expect((await bad([...canvas.nodes, duplicate])).json().message ?? (await bad([...canvas.nodes, duplicate])).json().error.message).toMatch(/once/);

    const privateFile = (await h.db.query("select id from sources where agency_id = $1 and client_id = $2 and kind = 'brief'", [a.agencyId, a.client["velvet-static"]])).rows[0].id;
    const sneaky: CanvasNode = { id: "ref-sneaky", type: "reference", position: { x: 0, y: 0 }, sourceId: privateFile };
    const res = await bad([...canvas.nodes, sneaky]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/client's own files/);

    expect((await bad(canvas.nodes, [edge("ghost")])).statusCode).toBe(400);
    expect((await bad(canvas.nodes, [{ id: "loop", source: RL, target: RL }])).statusCode).toBe(400);
    expect((await bad(canvas.nodes, [edge(RL), edge(RL)])).statusCode).toBe(400);
    const manyChats = [...canvas.nodes, ...[2, 3, 4].map((i): CanvasNode => ({ id: `chat-${i}`, type: "chat", position: { x: 0, y: 0 } }))];
    expect((await bad(manyChats)).statusCode).toBe(400);
    // None of those attempts changed the canvas.
    expect((await loadCanvas(a)).revision).toBe(1);
  });
});

describe("the data passport", () => {
  it("describes what flows through each connection, and shows a restricted client as zero fields", async () => {
    const w = await newWorldConnected([RL, MF, VS, TW]);
    const res = (await w.get("/v1/canvas/passport?chatNodeId=chat-1")).json();
    const byTitle = Object.fromEntries(res.passport.entries.map((e: { title: string }) => [e.title, e]));
    expect(byTitle["Ridgeline Outfitters"].status).toBe("approved");
    expect(byTitle["Ridgeline Outfitters"].included.join(" ")).toMatch(/per 1,000 impressions/);
    expect(byTitle["Velvet Static"]).toMatchObject({ status: "restricted", fieldsShared: 0, included: [] });
    expect(byTitle["Velvet Static"].reasons.join(" ")).toMatch(/not approved sharing performance patterns/);
    expect(byTitle["Velvet Static"].reasons.join(" ")).toMatch(/not approved sharing creative assets/);
    expect(res.passport.entries.some((e: { type: string }) => e.type === "brief")).toBe(true);
    expect(res.passport.neverShared.join(" ")).toMatch(/Raw spend/);
    expect(res.passport.note).toMatch(/never grants access/);
    // It describes data; it never carries any.
    expect(JSON.stringify(res)).not.toMatch(/Mara Voss|countdown|embargo|product recall|Dana|Elise/);
  });

  it("shows a one-sided approval as partial, and updates when sharing changes", async () => {
    const w = await newWorldConnected([RL, MF]);
    await setClientSharing(h.db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: true, creativeAssets: false });
    const res = (await w.get("/v1/canvas/passport?chatNodeId=chat-1")).json();
    const mf = res.passport.entries.find((e: { title: string }) => e.title === "Marlowe & Finch");
    expect(mf.status).toBe("partial");
    expect(mf.excluded).toContain("Creative assets");
    expect(mf.excluded.join(" ")).toMatch(/Patterns by visual style/);
  });

  it("is scoped to the visitor's own canvas", async () => {
    const a = await newWorldConnected([RL]);
    const b = await h.newWorld();
    const res = (await b.get("/v1/canvas/passport?chatNodeId=chat-1")).json();
    expect(res.passport.entries).toEqual([]);
    expect((await a.get("/v1/canvas/passport?chatNodeId=chat-1")).json().passport.entries).toHaveLength(1);
  });
});

async function newWorldConnected(ids: string[]): Promise<World> {
  const w = await h.newWorld();
  await connect(w, ids);
  return w;
}

describe("a cross-client chat turn", () => {
  it("combines approved patterns into concepts using nothing a restricted client holds", async () => {
    const w = await newWorldConnected([RL, MF, VS, TW]);
    const model = new ScriptedModel(() => finishCall(conceptsArtifact()));
    const worker = h.worker(model);
    const { turnId, executionId, canvasRevision } = await chatTurn(w, "Use Ridgeline's visual patterns and Marlowe & Finch's storytelling patterns. What could we test for Tidewell Swim?");
    await h.drain(worker);

    const turn = await turnRow(turnId);
    expect(turn.status).toBe("succeeded");
    expect(turn.canvas_revision).toBe(canvasRevision);

    // The cross-client model handled it, and saw only the approved context.
    expect(model.requests.every((r) => r.task === "cross_client")).toBe(true);
    const everything = sent(model);
    for (const leak of ["Mara Voss", "14 November", "countdown", "trade secret", "embargo", "neon", "Drop 04", "Drop 05", "8 USD", "12 USD", "Velvet Static's", "24000", "122400", "VS-MET"]) {
      expect(everything, leak).not.toContain(leak);
    }
    for (const private_ of ["product recall", "30 USD", "Dana", "28 to 45", "Elise", "Wholesale", "35 to 60", "1300000", "33800", "12600", "320,000"]) {
      expect(everything, private_).not.toContain(private_);
    }
    // The new-client brief the user supplied is there as explicit context.
    expect(everything).toContain("Tidewell Swim");
    // The model is told, in words, that the restricted client is excluded and why.
    expect(everything).toMatch(/Velvet Static: performance patterns/);
    expect(everything).toMatch(/Velvet Static: creative assets/);

    // What happened is recorded for the technical page.
    const exec = (await h.db.query("select input_snapshot from executions where id = $1", [executionId])).rows[0];
    expect(exec.input_snapshot.exclusions.map((e: { subject: string }) => e.subject)).toEqual(["Velvet Static", "Velvet Static"]);
    expect(exec.input_snapshot.connected.map((n: { id: string }) => n.id).sort()).toEqual([MF, RL, TW, VS].sort());
    const permissionEvents = (await h.db.query("select name from execution_events where execution_id = $1 and kind = 'permission' order by id", [executionId])).rows;
    expect(permissionEvents.map((e) => e.name)).toEqual(["Velvet Static: performance patterns excluded", "Velvet Static: creative assets excluded"]);

    // The concepts were saved with the permissions they were built on, and their numbers come from code.
    const version = (await h.db.query("select v.blocks, v.permission_fingerprint, v.checks, a.kind from artifact_versions v join artifacts a on a.id = v.artifact_id where v.cause_turn_id = $1", [turnId])).rows[0];
    expect(version.kind).toBe("campaign_concepts");
    expect(version.permission_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(version.blocks.filter((b: { type: string }) => b.type === "experiment")).toHaveLength(3);
    expect(version.checks.claims.verified).toBe(version.checks.claims.total);

    const conversation = (await w.get("/v1/canvas/chats/chat-1/conversation")).json();
    const version2 = (await w.get(`/v1/artifact-versions/${conversation.turns[0].artifact.versionId}`)).json();
    const ctr = key.clients["ridgeline-outfitters"].byVisualStyle["bold-on-location"].ctr;
    expect(version2.renderedBlocks[0].text).toBe(`On-location creative reached a CTR of ${(ctr * 100).toFixed(2)}% at Ridgeline.`);
    expect(conversation.turns[0].reply.stale).toEqual([]);
  });

  it("gives the model only normalized rates: no raw totals anywhere in what it was sent", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    const model = new ScriptedModel(() => finishCall(conceptsArtifact()));
    await chatTurn(w, "What is working for these brands?");
    await h.drain(h.worker(model));
    const context = JSON.stringify(model.requests[0]!.messages[0]!.content);
    for (const rawKey of ['\\"spend\\"', '\\"impressions\\"', '\\"clicks\\"', '\\"conversions\\"', '\\"revenue\\"', '\\"campaignName\\"', '\\"audience\\"']) {
      expect(context, rawKey).not.toContain(rawKey);
    }
    expect(context).toContain("scope \\\"ridgeline-outfitters:visualStyle:bold-on-location\\\"");
    expect(context).toContain("impressionsBand");
  });

  it("does not let an unapproved client's connection widen access, and says so in the prompt", async () => {
    const w = await newWorldConnected([VS]);
    const model = new ScriptedModel(() => [toolCall("finish", { reply: { message: "Velvet Static has not approved sharing, so I cannot use it.", statements: [{ type: "note", text: "No approved patterns are available from the connected client." }] } })]);
    const { turnId } = await chatTurn(w, "Show Velvet Static's campaign totals.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const everything = sent(model);
    expect(everything).not.toMatch(/VS-MET|VS-PIN|neon|countdown|24000|122400/);
    expect(everything).toMatch(/No performance patterns are approved/);
  });

  it("tells the model when creative assets are not approved, so it asks for the missing evidence", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    await setClientSharing(h.db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: true, creativeAssets: false });
    const model = new ScriptedModel(() => [toolCall("finish", { reply: { message: "I need Marlowe & Finch's approved creative to compare storytelling.", statements: [{ type: "note", text: "Storytelling patterns need creative assets, which Marlowe & Finch has not approved." }] } })]);
    const { turnId } = await chatTurn(w, "Combine Ridgeline's visual patterns with Marlowe & Finch's storytelling patterns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const everything = sent(model);
    expect(everything).toMatch(/Marlowe & Finch: creative assets/);
    expect(everything).not.toMatch(/customer-story|handwritten note|founder-letter/);
    // Performance-only findings remain available.
    expect(everything).toContain("scope \\\"marlowe-finch:MF-PIN-0901\\\"");
  });

  it("rejects citations to anything the permission filter did not provide", async () => {
    const w = await newWorldConnected([RL, MF, VS, TW]);
    const bad = conceptsArtifact();
    (bad.blocks[0] as { text: string; metricIds: string[] }).text = "Their CTR was {{metric:velvet-static:VS-MET-0901:ctr}}.";
    (bad.blocks[0] as { metricIds: string[] }).metricIds = ["metric:velvet-static:VS-MET-0901:ctr"];
    const model = new ScriptedModel(() => finishCall(bad));
    const { turnId } = await chatTurn(w, "Borrow Velvet Static's tactics.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("failed");
    expect((await h.db.query("select count(*)::int n from artifacts where agency_id = $1", [w.agencyId])).rows[0].n).toBe(0);
  });

  it("requires three experiments for campaign concepts", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    const model = new ScriptedModel(() => finishCall(conceptsArtifact(2)));
    const { turnId } = await chatTurn(w, "Give me concepts.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("failed");
  });
});

describe("permissions changing around a result", () => {
  it("marks a saved result stale when sharing changes afterwards, and it stays stale even if the approval is put back", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    const model = new ScriptedModel(() => finishCall(conceptsArtifact()));
    await chatTurn(w, "What could we test for Tidewell Swim?");
    await h.drain(h.worker(model));
    const read = async () => (await w.get("/v1/canvas/chats/chat-1/conversation")).json().turns[0].reply.stale as string[];
    expect(await read()).toEqual([]);

    await setClientSharing(h.db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: true, creativeAssets: false });
    expect((await read()).join(" ")).toMatch(/Sharing permissions changed/);

    // Restoring the approval does not rescue the old result. Anything could have been viewed in between, so a
    // change always requires a rerun (the permission version only moves forward).
    await setClientSharing(h.db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: true, creativeAssets: true });
    expect((await read()).join(" ")).toMatch(/Sharing permissions changed/);
  });

  it("marks a result stale when text on the canvas changed after it was written", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    await chatTurn(w, "What could we test for Tidewell Swim?");
    await h.drain(h.worker(new ScriptedModel(() => finishCall(conceptsArtifact()))));
    await h.db.query("update sources set extracted_text = extracted_text || ' New constraint added.' where agency_id = $1 and kind = 'new_client_brief'", [w.agencyId]);
    const stale = (await w.get("/v1/canvas/chats/chat-1/conversation")).json().turns[0].reply.stale as string[];
    expect(stale.join(" ")).toMatch(/Text on the canvas changed/);
  });

  it("refuses to save a result if permissions change while the model is working", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    const model = new ScriptedModel(async () => {
      // A consent withdrawal lands mid-run.
      await setClientSharing(h.db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: false, creativeAssets: false });
      return finishCall(conceptsArtifact());
    });
    const { turnId, executionId } = await chatTurn(w, "What could we test for Tidewell Swim?");
    await h.drain(h.worker(model));
    const turn = await turnRow(turnId);
    expect(turn.status).toBe("failed");
    expect(turn.reply_message).toMatch(/Sharing settings or canvas content changed while this ran/);
    expect((await h.db.query("select error_code from executions where id = $1", [executionId])).rows[0].error_code).toBe("context_changed");
    expect((await h.db.query("select count(*)::int n from artifacts where agency_id = $1", [w.agencyId])).rows[0].n).toBe(0);
  });

  it("runs against the canvas revision it was sent with, even if the canvas is edited before it starts", async () => {
    const w = await newWorldConnected([RL, MF, TW]);
    const { turnId } = await chatTurn(w, "What could we test for Tidewell Swim?");
    // Edit the canvas after submitting: disconnect Marlowe & Finch. The queued turn still uses its own revision.
    const canvas = await loadCanvas(w);
    await save(w, canvas, { edges: canvas.edges.filter((e) => e.source !== MF) });
    const model = new ScriptedModel(() => finishCall(conceptsArtifact()));
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    expect(sent(model)).toContain("marlowe-finch:storytelling:customer-story");
  });
});

describe("limits and isolation", () => {
  it("refuses over-long canvas context with a readable message, saving nothing", async () => {
    const w = await h.newWorld();
    const canvas = await loadCanvas(w);
    const ideas: CanvasNode[] = [1, 2, 3, 4].map((i) => ({ id: `idea-${i}`, type: "idea", position: { x: 0, y: 0 }, text: "x".repeat(3001) }));
    const saved = await save(w, canvas, { nodes: [...canvas.nodes, ...ideas], edges: ideas.map((n) => edge(n.id)) });
    expect(saved.statusCode).toBe(200);
    const model = new ScriptedModel(() => finishCall());
    const { turnId, executionId } = await chatTurn(w, "Anything?");
    await h.drain(h.worker(model));
    const turn = await turnRow(turnId);
    expect(turn.status).toBe("failed");
    expect(turn.reply_message).toMatch(/Canvas context is 12004 characters; the limit is 12000/);
    expect(model.requests).toHaveLength(0);
    expect((await h.db.query("select error_code from executions where id = $1", [executionId])).rows[0].error_code).toBe("context_too_large");
  });

  it("uses text typed onto a brief node as explicit context", async () => {
    const w = await h.newWorld();
    const canvas = await loadCanvas(w);
    const brief: CanvasNode = { id: "brief-typed", type: "brief", position: { x: 0, y: 0 }, title: "Fernhill", text: "Fernhill is a new knitwear brand for cold coastal towns." };
    await save(w, canvas, { nodes: [...canvas.nodes, brief], edges: [edge(RL), edge("brief-typed")] });
    const model = new ScriptedModel(() => finishCall());
    await chatTurn(w, "Plan a test for Fernhill.");
    await h.drain(h.worker(model));
    expect(sent(model)).toContain("Fernhill is a new knitwear brand");
  });

  it("keeps conversations separate per chat node and per visitor", async () => {
    const a = await newWorldConnected([RL]);
    const canvas = await loadCanvas(a);
    await save(a, canvas, { nodes: [...canvas.nodes, { id: "chat-2", type: "chat", position: { x: 700, y: 300 } }] });
    await chatTurn(a, "First chat question.");
    const second = (await a.get("/v1/canvas/chats/chat-2/conversation")).json();
    expect(second.turns).toEqual([]);
    const b = await h.newWorld();
    expect((await b.get("/v1/canvas/chats/chat-1/conversation")).json().turns).toEqual([]);
    expect((await a.get("/v1/canvas/chats/nope/conversation")).statusCode).toBe(404);
  });

  it("is idempotent and requires a key", async () => {
    const w = await newWorldConnected([RL]);
    const first = await chatTurn(w, "Same question.", "canvas-same-key-1");
    const again = await chatTurn(w, "Same question.", "canvas-same-key-1");
    expect(again.turnId).toBe(first.turnId);
    expect((await w.post("/v1/canvas/chats/chat-1/turns", { message: "No key." })).statusCode).toBe(400);
  });
});
