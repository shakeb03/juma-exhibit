import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedModel, createHarness, toolCall, type Harness, type World } from "../testing/harness.js";

let h: Harness;
beforeAll(() => { h = createHarness(); });
afterAll(async () => { await h.close(); });

const METRIC = {
  id: "metric:S1:ctr", label: "Click-through rate", unit: "percent", change: "none", value: 0.0184, unavailableReason: null,
  formula: "clicks / impressions", inputs: { clicks: 1840, impressions: 100000 }, rowIds: [], currency: null,
};
const blocks = () => [
  { id: "b-title", type: "heading", level: 1, text: "Pinterest report" },
  { id: "b-para", type: "paragraph", text: "Summit Weekend is the stronger campaign." },
  { id: "b-obs", type: "observation", text: "CTR was {{metric:S1:ctr}}.", metricIds: ["metric:S1:ctr"], sourceRefs: [] },
  { id: "b-hyp", type: "hypothesis", text: "The image style may explain part of it." },
  { id: "b-rec", type: "recommendation", text: "Test image styles.", reasoning: "It isolates style.", basedOn: ["b-obs"], measurement: "Clicks per 1,000 impressions.", limitation: "Spend differed." },
  { id: "b-table", type: "metric_table", caption: "Comparison", scopes: [{ label: "Summit", scopeId: "S1" }], metrics: ["ctr"] },
];

/** An artifact version saved directly, so these tests exercise editing without paying for a model run. */
async function makeArtifact(w: World) {
  const conversation = (await h.db.query(
    "insert into conversations (agency_id, kind, client_id) values ($1, 'client', $2) returning id", [w.agencyId, w.client["ridgeline-outfitters"]],
  )).rows[0];
  const artifact = (await h.db.query(
    "insert into artifacts (agency_id, conversation_id, kind, title) values ($1, $2, 'performance_report', 'Pinterest report') returning id", [w.agencyId, conversation.id],
  )).rows[0];
  const version = (await h.db.query(
    `insert into artifact_versions (artifact_id, version, blocks, evidence, checks, cause_kind)
     values ($1, 1, $2, $3, $4, 'turn') returning id`,
    [artifact.id, JSON.stringify(blocks()), JSON.stringify({ metrics: { [METRIC.id]: METRIC }, scopes: [{ scopeId: "S1", label: "Summit", campaignIds: ["RL-PIN-0901"], warnings: [] }] }), JSON.stringify({ claims: { verified: 1, total: 1 }, warnings: [] })],
  )).rows[0];
  await h.db.query("update artifacts set current_version_id = $2 where id = $1", [artifact.id, version.id]);
  return { artifactId: artifact.id as string, v1: version.id as string };
}
const versionsOf = async (artifactId: string) =>
  (await h.db.query("select id, version, blocks, cause_kind, cause_comment_id, base_version_id, checks from artifact_versions where artifact_id = $1 order by version", [artifactId])).rows;
const edit = (w: World, artifactId: string, body: unknown) => w.post(`/v1/artifacts/${artifactId}/edits`, body);
const comment = (w: World, versionId: string, blockId: string, body = "Make this punchier.", selection?: string) =>
  w.post(`/v1/artifact-versions/${versionId}/comments`, { blockId, body, selection });
const propose = (block: object, summary = "Reworded it.") => new ScriptedModel(() => [toolCall("propose_block", { summary, block })]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const comments = async (w: World, artifactId: string) => (await w.get(`/v1/artifacts/${artifactId}/comments`)).json().comments as Array<Record<string, any>>;

describe("manual edits", () => {
  it("changes one block's text into a new version, keeping everything else and clearing approval", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    await w.post(`/v1/artifact-versions/${v1}/approve`, {});

    // Numbers are the person's to change, and are not checked.
    const res = await edit(w, artifactId, { baseVersionId: v1, blockId: "b-para", fields: { text: "Summit Weekend won, with a 99% lift." } });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(2);

    const [first, second] = await versionsOf(artifactId);
    expect(second.cause_kind).toBe("manual");
    expect(second.base_version_id).toBe(first.id);
    const changed = second.blocks.filter((b: { id: string }, i: number) => JSON.stringify(b) !== JSON.stringify(first.blocks[i]));
    expect(changed.map((b: { id: string }) => b.id)).toEqual(["b-para"]);
    expect(second.blocks.map((b: { id: string }) => b.id)).toEqual(first.blocks.map((b: { id: string }) => b.id));
    // The AI's verification count stays tied to the version that earned it.
    expect(second.checks.claims).toEqual({ verified: 1, total: 1 });
    expect(second.checks.claimsVersion).toBe(1);
    expect(second.checks.edit.changes[0]).toMatchObject({ field: "text", before: "Summit Weekend is the stronger campaign.", after: "Summit Weekend won, with a 99% lift." });

    // Approval stays with version 1.
    expect((await w.get(`/v1/artifact-versions/${v1}`)).json().approval).not.toBeNull();
    expect((await w.get(`/v1/artifact-versions/${res.json().versionId}`)).json().approval).toBeNull();
  });

  it("keeps metric placeholders in fields that were not changed", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    // Only the recommendation's measurement changes; its other fields are not sent.
    const res = await edit(w, artifactId, { baseVersionId: v1, blockId: "b-rec", fields: { measurement: "Conversions per 1,000 impressions." } });
    expect(res.statusCode).toBe(200);
    const [, second] = await versionsOf(artifactId);
    const rec = second.blocks.find((b: { id: string }) => b.id === "b-rec");
    expect(rec.measurement).toBe("Conversions per 1,000 impressions.");
    expect(rec.basedOn).toEqual(["b-obs"]);
    // Editing the observation's text drops its placeholder, but its cited metrics stay for the evidence drawer.
    await edit(w, artifactId, { baseVersionId: (await versionsOf(artifactId))[1].id, blockId: "b-obs", fields: { text: "CTR was 2.1%." } });
    const [, , third] = await versionsOf(artifactId);
    expect(third.blocks.find((b: { id: string }) => b.id === "b-obs")).toMatchObject({ text: "CTR was 2.1%.", metricIds: ["metric:S1:ctr"] });
  });

  it("refuses stale bases, unknown fields, no-ops, structure changes, and other workspaces", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    expect((await edit(w, artifactId, { baseVersionId: v1, blockId: "b-para", fields: { text: "New." } })).statusCode).toBe(200);
    // v1 is no longer the latest.
    const stale = await edit(w, artifactId, { baseVersionId: v1, blockId: "b-title", fields: { text: "Other." } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("version_moved_on");

    const latest = (await versionsOf(artifactId))[1].id;
    expect((await edit(w, artifactId, { baseVersionId: latest, blockId: "b-title", fields: { level: "2" } })).statusCode).toBe(400);
    expect((await edit(w, artifactId, { baseVersionId: latest, blockId: "b-title", fields: { text: "Pinterest report" } })).statusCode).toBe(400);
    expect((await edit(w, artifactId, { baseVersionId: latest, blockId: "b-title", fields: { text: "" } })).statusCode).toBe(400);
    expect((await edit(w, artifactId, { baseVersionId: latest, blockId: "nope", fields: { text: "x" } })).statusCode).toBe(400);
    expect((await versionsOf(artifactId))).toHaveLength(2);

    const other = await h.newWorld();
    expect((await edit(other, artifactId, { baseVersionId: latest, blockId: "b-title", fields: { text: "Mine." } })).statusCode).toBe(404);
  });

  it("lets a person edit a metric table caption", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    expect((await edit(w, artifactId, { baseVersionId: v1, blockId: "b-table", fields: { caption: "Summit only" } })).statusCode).toBe(200);
  });
});

describe("comments with AI-proposed edits", () => {
  it("proposes a replacement for one block, and accepting it changes only that block", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    const created = await comment(w, v1, "b-title", "Make the title punchier.");
    expect(created.statusCode).toBe(202);
    expect(created.json().status).toBe("open");

    const model = propose({ type: "heading", level: 1, text: "Summit Weekend wins on Pinterest" }, "Made the title more direct.");
    await h.drain(h.worker(model));

    // The model saw only the commented block and the comment.
    const sent = JSON.stringify(model.requests[0]!.messages);
    expect(sent).toContain("Make the title punchier.");
    expect(sent).toContain("b-title");
    expect(sent).not.toContain("Summit Weekend is the stronger campaign.");
    expect(sent).not.toContain("Test image styles.");

    const proposed = (await comments(w, artifactId))[0]!;
    expect(proposed.status).toBe("proposed");
    expect(proposed.proposal.summary).toBe("Made the title more direct.");
    expect(proposed.proposal.before.text).toBe("Pinterest report");
    expect(proposed.proposal.after.text).toBe("Summit Weekend wins on Pinterest");
    // Nothing is applied until it is accepted.
    expect(await versionsOf(artifactId)).toHaveLength(1);

    const accepted = await w.post(`/v1/comments/${proposed.id}/accept`, {});
    expect(accepted.statusCode).toBe(200);
    const [first, second] = await versionsOf(artifactId);
    expect(second.cause_kind).toBe("comment");
    expect(second.cause_comment_id).toBe(proposed.id);
    const differing = second.blocks.filter((b: { id: string }, i: number) => JSON.stringify(b) !== JSON.stringify(first.blocks[i]));
    expect(differing.map((b: { id: string }) => b.id)).toEqual(["b-title"]);
    expect((await comments(w, artifactId))[0]!.status).toBe("accepted");
    // Accepting twice does not create another version.
    expect((await w.post(`/v1/comments/${proposed.id}/accept`, {})).statusCode).toBe(409);
    expect(await versionsOf(artifactId)).toHaveLength(2);
    // The run that wrote it is inspectable.
    const version = (await w.get(`/v1/artifact-versions/${second.id}`)).json();
    expect(version.produced.executionId).toBeTruthy();
    expect(version.produced.models[0].task).toBe("edit_block");
  });

  it("rejects a reply that changes the block type, repairs once, and keeps the model on the same block", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    await comment(w, v1, "b-title");
    let step = 0;
    const model = new ScriptedModel(() => {
      step++;
      return step === 1
        ? [toolCall("propose_block", { summary: "x", block: { type: "paragraph", text: "A paragraph instead." } })]
        : [toolCall("propose_block", { summary: "Sharper.", block: { type: "heading", level: 1, text: "Sharper title" } })];
    });
    await h.drain(h.worker(model));
    const [c] = await comments(w, artifactId);
    expect(c!.status).toBe("proposed");
    expect(c!.proposal.after).toMatchObject({ id: "b-title", type: "heading", text: "Sharper title" });
    expect(JSON.stringify(model.requests[1]!.messages)).toContain("Return a heading block");
  });

  it("fails honestly when the proposal cites a metric that does not exist", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    await comment(w, v1, "b-obs", "Add the conversion rate.");
    const model = propose({ type: "observation", text: "CTR was {{metric:S1:ctr}} and conversion rate was {{metric:S1:madeUp}}.", metricIds: ["metric:S1:ctr"], sourceRefs: [] });
    await h.drain(h.worker(model));
    const [c] = await comments(w, artifactId);
    expect(c!.status).toBe("failed");
    expect(c!.error).toMatch(/evidence checks|nothing was saved/i);
    expect(await versionsOf(artifactId)).toHaveLength(1);
    // The reviewer can ask again, and a good proposal then succeeds.
    expect((await w.post(`/v1/comments/${c!.id}/retry`, {})).statusCode).toBe(202);
    await h.drain(h.worker(propose({ type: "observation", text: "CTR was {{metric:S1:ctr}}, the highest we saw.", metricIds: ["metric:S1:ctr"], sourceRefs: [] })));
    expect((await comments(w, artifactId))[0]!.status).toBe("proposed");
  });

  it("marks a proposal stale when its block changed meanwhile, but rebases when only other blocks changed", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    await comment(w, v1, "b-title");
    await comment(w, v1, "b-hyp", "Shorter.");
    await h.drain(h.worker(new ScriptedModel((request) => {
      const content = JSON.stringify(request.messages);
      return content.includes("b-title")
        ? [toolCall("propose_block", { summary: "t", block: { type: "heading", level: 1, text: "New title" } })]
        : [toolCall("propose_block", { summary: "h", block: { type: "hypothesis", text: "Image style may matter." } })];
    })));
    const list = await comments(w, artifactId);
    const title = list.find((c) => c.blockId === "b-title")!;
    const hyp = list.find((c) => c.blockId === "b-hyp")!;
    expect([title.status, hyp.status]).toEqual(["proposed", "proposed"]);

    // A person edits the title by hand, then the paragraph. The title proposal is now stale.
    await edit(w, artifactId, { baseVersionId: v1, blockId: "b-title", fields: { text: "My own title" } });
    const stale = await w.post(`/v1/comments/${title.id}/accept`, {});
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("comment_stale");
    expect((await comments(w, artifactId)).find((c) => c.id === title.id)!.status).toBe("stale");

    // The hypothesis block is untouched, so its proposal rebases onto the newest version and keeps the manual title.
    expect((await w.post(`/v1/comments/${hyp.id}/accept`, {})).statusCode).toBe(200);
    const latest = (await versionsOf(artifactId)).at(-1)!;
    expect(latest.blocks.find((b: { id: string }) => b.id === "b-title").text).toBe("My own title");
    expect(latest.blocks.find((b: { id: string }) => b.id === "b-hyp").text).toBe("Image style may matter.");
    expect(latest.cause_kind).toBe("comment");

    // Stale comments can be regenerated against the current text.
    expect((await w.post(`/v1/comments/${title.id}/retry`, {})).statusCode).toBe(202);
  });

  it("lets a reviewer dismiss a proposal and refuses unsupported or foreign requests", async () => {
    const w = await h.newWorld();
    const { artifactId, v1 } = await makeArtifact(w);
    expect((await comment(w, v1, "b-table")).statusCode).toBe(400);
    expect((await comment(w, v1, "missing")).statusCode).toBe(404);
    expect((await w.post(`/v1/artifact-versions/${v1}/comments`, { blockId: "b-title", body: "   " })).statusCode).toBe(400);

    const created = (await comment(w, v1, "b-para", "Tighten.")).json();
    // Nothing to dismiss or accept while it is still being worked on.
    expect((await w.post(`/v1/comments/${created.id}/reject`, {})).statusCode).toBe(409);
    expect((await w.post(`/v1/comments/${created.id}/accept`, {})).statusCode).toBe(409);
    await h.drain(h.worker(propose({ type: "paragraph", text: "Summit Weekend leads." })));

    const other = await h.newWorld();
    expect((await other.post(`/v1/comments/${created.id}/accept`, {})).statusCode).toBe(404);
    expect((await other.get(`/v1/artifacts/${artifactId}/comments`)).statusCode).toBe(404);
    expect((await comment(other, v1, "b-title")).statusCode).toBe(404);

    const rejected = await w.post(`/v1/comments/${created.id}/reject`, {});
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe("rejected");
    expect(await versionsOf(artifactId)).toHaveLength(1);
  });
});
