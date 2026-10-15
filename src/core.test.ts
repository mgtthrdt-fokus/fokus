import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";
import { guard, merge, normalize, serialize } from "./merge.ts";
import { buildTree } from "./tree.ts";
import { INBOX, type FNode, type FileV2 } from "./model.ts";
import { deriveKey, makeVault, openVault } from "./vault.ts";
import { byRank, rankBetween } from "./rank.ts";

// Synthetic data only: this repo is public.
const v1 = {
  schema: 1,
  projects: [
    { id: "p_b", name: "Projekt Süd", short: "sued", color: "#F08A4B", archived: false, order: 1, updated: "2026-10-01T10:00:00.000Z" },
    { id: "p_a", name: "Projekt Nord", short: "nord", color: "#3A9AD9", archived: false, order: 0, updated: "2026-10-01T10:00:00.000Z" },
    { id: "p_s", name: "Gutachten", short: "gut", color: "#C9A2E8", archived: false, order: 2, updated: "2026-10-01T10:00:00.000Z" },
    { id: "p_x", name: "Neu", short: "neu", color: "#9AA6B2", archived: true, order: 3, updated: "2026-10-01T10:00:00.000Z" },
  ],
  tasks: [
    { id: "t_2", title: "Größe prüfen €", project: "p_a", status: "waiting", due: "2026-10-20", waitingOn: "Firma X", note: "Notiz <b>x</b>", est: 2.5, meeting: "m_1", created: "2026-10-02T00:00:00.000Z", updated: "2026-10-03T00:00:00.000Z", done: null },
    { id: "t_1", title: "Erste", project: "p_a", status: "done", prev: "now", due: null, waitingOn: "", note: "", est: null, meeting: null, created: "2026-10-01T00:00:00.000Z", updated: "2026-10-04T00:00:00.000Z", done: "2026-10-04" },
    { id: "t_3", title: "Ohne Projekt", project: null, status: "inbox", due: null, waitingOn: "", note: "", est: null, meeting: null, created: "2026-10-05T00:00:00.000Z", updated: "2026-10-05T00:00:00.000Z", done: null },
  ],
  meetings: [{ id: "m_1", series: "Jour fixe", title: "Jour fixe #1", date: "2026-10-02", project: "p_a", attendees: "A, B", notes: "B: beschlossen", created: "2026-10-02T00:00:00.000Z", updated: "2026-10-02T00:00:00.000Z" }],
  deleted: { t_old: "2026-10-01T00:00:00.000Z" },
};

const get = (f: FileV2, id: string) => f.nodes.find(n => n.id === id)!;

const AREAS = [
  { id: "a_firma", title: "Firma", shorts: ["nord", "sued"] },
  { id: "a_neben", title: "Nebenbei", shorts: ["gut"] },
];

describe("migrate v1 → v2", () => {
  const f = migrate(structuredClone(v1), AREAS);
  it("maps projects to areas by short, unknown to Eingang", () => {
    expect(get(f, "p_a").parent).toBe("a_firma");
    expect(get(f, "p_b").parent).toBe("a_firma");
    expect(get(f, "p_s").parent).toBe("a_neben");
    expect(get(f, "p_x").parent).toBe(INBOX);
    expect(get(f, "p_a").rank < get(f, "p_b").rank).toBe(true);   // order 0 before 1
  });
  it("is lossless for every v1 field", () => {
    const t2 = get(f, "t_2");
    expect(t2).toMatchObject({ type: "task", parent: "p_a", title: "Größe prüfen €", body: "Notiz <b>x</b>", status: "waiting", waitingOn: "Firma X", est: 2.5, meeting: "m_1", due: "2026-10-20" });
    expect(get(f, "t_1")).toMatchObject({ prev: "now", done: "2026-10-04", updated: "2026-10-04T00:00:00.000Z" });
    expect(get(f, "t_3").parent).toBe(INBOX);
    expect(get(f, "m_1")).toMatchObject({ type: "meeting", parent: "p_a", body: "B: beschlossen", series: "Jour fixe", attendees: "A, B", date: "2026-10-02" });
    expect(get(f, "p_x")).toMatchObject({ archived: true, short: "neu", color: "#9AA6B2", title: "Neu" });
    expect(f.deleted).toEqual(v1.deleted);
    expect(f.nodes.length).toBe(3 + 4 + 3 + 1);   // areas+inbox, projects, tasks, meeting
  });
  it("is deterministic (two devices migrating agree byte for byte)", () => {
    expect(serialize(migrate(structuredClone(v1), AREAS))).toBe(serialize(migrate(structuredClone(v1), AREAS)));
  });
  it("public default puts every project under one catch-all area", () => {
    const d = migrate(structuredClone(v1));
    expect(d.nodes.filter(n => n.type === "project").every(n => n.parent === "a_projekte")).toBe(true);
  });
  it("normalize migrates schema 1 and is idempotent on schema 2", () => {
    const a = normalize(structuredClone(v1));
    expect(serialize(normalize(JSON.parse(serialize(a))))).toBe(serialize(a));
  });
  it("keeps UTF-8 through serialize/parse", () => {
    expect(JSON.parse(serialize(f)).nodes.find((n: FNode) => n.id === "t_2").title).toBe("Größe prüfen €");
  });
});

const node = (id: string, parent: string | null, extra: Partial<FNode> = {}): FNode =>
  ({ id, type: "task", parent, rank: "a0", title: id, status: "next", created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z", ...extra });
const file = (nodes: FNode[], deleted = {}): FileV2 => ({ schema: 2, nodes: [node(INBOX, null, { type: "system" }), ...nodes], deleted });

describe("merge", () => {
  it("newer updated wins per node", () => {
    const a = file([node("x", null, { title: "A", updated: "2026-10-02T00:00:00.000Z" })]);
    const b = file([node("x", null, { title: "B", updated: "2026-10-03T00:00:00.000Z" })]);
    expect(get(merge(a, b), "x").title).toBe("B");
    expect(get(merge(b, a), "x").title).toBe("B");
  });
  it("tombstone beats older node, newer edit beats tombstone", () => {
    const del = { x: "2026-10-05T00:00:00.000Z" };
    expect(merge(file([node("x", null)]), file([], del)).nodes.some(n => n.id === "x")).toBe(false);
    expect(merge(file([node("x", null, { updated: "2026-10-06T00:00:00.000Z" })]), file([], del)).nodes.some(n => n.id === "x")).toBe(true);
  });
  it("prunes tombstones older than 90 days", () => {
    expect(merge(file([]), file([], { y: "2020-01-01T00:00:00.000Z" })).deleted).toEqual({});
  });
  it("cycle after concurrent moves → both to Eingang, uninvolved child untouched", () => {
    const g = guard(file([node("a", "b"), node("b", "a"), node("c", "a")]));
    expect(get(g, "a").parent).toBe(INBOX);
    expect(get(g, "b").parent).toBe(INBOX);
    expect(get(g, "c").parent).toBe("a");
  });
  it("orphan whose parent was deleted → Eingang", () => {
    expect(get(guard(file([node("k", "gone")])), "k").parent).toBe(INBOX);
  });
});

describe("rollup", () => {
  const day = "2026-10-14";
  const t = buildTree([
    node("p", null, { type: "project", status: undefined }),
    node("w", "p", { type: "package", status: undefined }),
    node("t1", "w", { due: "2026-10-10", est: 2 }),             // overdue
    node("t2", "w", { status: "waiting", due: "2026-10-01", est: 3 }), // waiting, not overdue
    node("t3", "w", { status: "done", est: 5 }),
    node("t4", "t1", { due: "2026-10-20", est: 1 }),            // subtask
    node("e", "p", { type: "package", status: undefined }),     // empty package
    node("h", null, { type: "project", status: undefined, state: "holding" }),
    node("n", null, { type: "note", status: undefined }),
  ], day);
  it("counts open/overdue/waiting/est/next due through all levels", () => {
    expect(t.rollup("p")).toMatchObject({ total: 4, open: 3, overdue: 1, waiting: 1, est: 6, nextDue: "2026-10-01", noNext: false });
  });
  it("% done by est when all have est", () => { expect(t.rollup("p").pct).toBe(Math.round(100 * 5 / 11)); });
  it("flags package without next action, not holding projects", () => {
    expect(t.rollup("e").noNext).toBe(true);
    expect(t.rollup("h")).toMatchObject({ noNext: false, holding: true });
    expect(t.activeProjects).toBe(1);
  });
  it("path and kids are ordered", () => {
    expect(t.path("t4").map(n => n.id)).toEqual(["p", "w", "t1", "t4"]);
  });
});

describe("rank", () => {
  it("between, before, after and the equal-rank tie", () => {
    const m = rankBetween("a0", "a1");
    expect("a0" < m && m < "a1").toBe(true);
    expect(rankBetween(null, "a0") < "a0").toBe(true);
    expect(rankBetween("a0", null) > "a0").toBe(true);
    expect(rankBetween("a1", "a1") > "a1").toBe(true);
    expect([node("y", null, { rank: "a1" }), node("x", null, { rank: "a1" })].sort(byRank)[0].id).toBe("x");
  });
});

describe("vault", () => {
  it("round-trips the token and rejects a wrong passphrase", async () => {
    const v = await makeVault("github_pat_test", "korrekt pferd batterie heftklammer");
    expect(v.salt).not.toBe("V3J3jEIljVJHFQzbOp7PGQ==");
    expect(await openVault(v, await deriveKey("korrekt pferd batterie heftklammer", v.salt))).toBe("github_pat_test");
    await expect(openVault(v, await deriveKey("falsch", v.salt))).rejects.toThrow();
    // copied from a password manager with a trailing line break: same key
    expect(await openVault(v, await deriveKey("korrekt pferd batterie heftklammer\r\n", v.salt))).toBe("github_pat_test");
    expect((await makeVault("t", "p", v.dataSalt)).dataSalt).toBe(v.dataSalt);   // token renewal keeps the data key
  }, 30_000);
});

import { parseDate, parseQuick } from "./parse.ts";
import { reviewView, todayView } from "./today.ts";
import { decryptData, encryptData } from "./vault.ts";

describe("quick-add parser", () => {
  const T = "2026-10-14";   // Wednesday
  it("parses project, package, person, dates, focus, note", () => {
    expect(parseQuick("Angebot prüfen #nord >>Cost_Control @Firma bis fr ab mo", T)).toMatchObject({
      title: "Angebot prüfen", project: "nord", pkg: "Cost Control", waitingOn: "Firma", due: "2026-10-16", start: "2026-10-19", status: "waiting",
    });
    expect(parseQuick("Idee ::note", T)).toMatchObject({ title: "Idee", note: true });
    expect(parseQuick("Bericht morgen !", T)).toMatchObject({ title: "Bericht", due: "2026-10-15", status: "now" });
    expect(parseQuick("Mail @ich", T).waitingOn).toBeUndefined();
  });
  it("dates: weekday never today, kw = Friday, d.m. rolls over the year, invalid stays text", () => {
    expect(parseDate("mi", T)).toBe("2026-10-21");
    expect(parseDate("kw44", T)).toBe("2026-10-30");
    expect(parseDate("+2w", T)).toBe("2026-10-28");
    expect(parseDate("3.1.", "2026-12-20")).toBe("2027-01-03");
    expect(parseDate("31.2.", T)).toBeNull();
    expect(parseQuick("Termin 31.2.", T).title).toBe("Termin 31.2.");
  });
});

describe("Heute / Rückblick", () => {
  const day = "2026-10-14", old = "2026-09-01T00:00:00.000Z";
  const t = buildTree([
    node("p", null, { type: "project", status: undefined }),
    node("f", "p", { status: "now", est: 5 }),
    node("f2", "p", { focus: "2026-10-14", est: 4 }),                      // picked yesterday for today
    node("w1", "p", { status: "waiting", due: "2026-10-13", updated: "2026-10-12T00:00:00.000Z" }),            // follow-up due
    node("w2", "p", { status: "waiting", updated: old }),                   // stale, no date → radar
    node("o", "p", { due: "2026-10-10" }),
    node("s", "p", { due: "2026-10-15" }),
    node("d", "p", { start: "2026-10-20" }),                                // deferred → hidden
    node("x", "p", { status: "done", done: day }),
    node("q", "p", { proposed: true }),
    node("h", null, { type: "project", status: undefined, state: "holding" }),
    node("hx", "h", { due: "2026-10-01" }),                                 // paused project → not in Heute
    node("i", INBOX, { status: "inbox" }),
    node(INBOX, null, { type: "system", status: undefined }),
  ], day);
  const v = todayView(t, day);
  it("sections", () => {
    expect(v.focus.map(n => n.id)).toEqual(["f", "f2"]);
    expect(v.follow.map(n => n.id).sort()).toEqual(["w1", "w2"]);
    expect(v.overdue.map(n => n.id)).toEqual(["o"]);
    expect(v.soon.map(n => n.id)).toEqual(["s"]);
    expect(v.doneToday.map(n => n.id)).toEqual(["x"]);
    expect(v.proposed.map(n => n.id)).toEqual(["q"]);
    expect(v.inbox).toBe(1);
    expect(v.focusHours).toBe(9);
    const shown = [...v.focus, ...v.follow, ...v.overdue, ...v.soon, ...v.week].map(n => n.id);
    expect(shown).not.toContain("d");
    expect(shown).not.toContain("hx");
  });
  it("review lists stale and paused", () => {
    const r = reviewView(t, day);
    expect(r.staleWaiting.map(n => n.id)).toEqual(["w2"]);
    expect(r.holding.map(n => n.id)).toEqual(["h"]);
    expect(r.unreviewed.map(n => n.id)).toEqual(["p"]);
  });
});

describe("data encryption", () => {
  it("round-trips and fails with the wrong key", async () => {
    const k = await deriveKey("pass eins zwei drei", "AAAAAAAAAAAAAAAAAAAAAA==");
    const e = await encryptData("Größe €", k, "AAAAAAAAAAAAAAAAAAAAAA==");
    expect(await decryptData(e, k)).toBe("Größe €");
    await expect(decryptData(e, await deriveKey("falsch", "AAAAAAAAAAAAAAAAAAAAAA=="))).rejects.toThrow();
  }, 20_000);
});

describe("normalize at the trust boundary", () => {
  it("drops bad ids/types, coerces titles, strips CSS-unsafe colors", () => {
    const f = normalize({ schema: 2, deleted: {}, nodes: [
      { id: "a", type: "project", title: 5, color: "red;background:url(x)", parent: null, rank: "a0", created: "", updated: "" },
      { id: "../x", type: "task", title: "bad id" }, { id: "b", type: "evil", title: "bad type" },
    ] });
    expect(f.nodes.map(n => n.id).sort()).toEqual(["a", INBOX]);
    expect(get(f, "a").title).toBe("5");
    expect(get(f, "a").color).toBeUndefined();
  });
  it("wrong field types cannot crash rendering; future or missing timestamps cannot win merges", () => {
    const f = normalize({ schema: 2, deleted: { z: "9999-01-01T00:00:00.000Z" }, nodes: [
      { id: "x", type: "task", title: "t", due: 20261017, body: { a: 1 }, est: "2", status: "bogus", priority: 7, proposed: "yes", updated: "9999-01-01T00:00:00.000Z" },
      { id: "y", type: "task", title: "u" },
    ] });
    const x = get(f, "x"), y = get(f, "y");
    expect(x.due).toBeUndefined();
    expect(typeof x.body).toBe("string");
    expect(x.est).toBeUndefined();
    expect(x.status).toBe("next");
    expect(x.priority).toBeUndefined();
    expect(x.proposed).toBe(true);
    expect(Date.parse(x.updated)).toBeLessThan(Date.now() + 864e5);
    expect(f.deleted.z < "9999").toBe(true);
    expect(y.updated).toBe("1970-01-01T00:00:00.000Z");
    expect(y.touched).toBeUndefined();
  });
});
