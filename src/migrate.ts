import { INBOX, ts, type FNode, type FileV2 } from "./model.ts";
import { ranks } from "./rank.ts";

// Deterministic: two devices migrating the same v1 file must produce byte-identical v2 output,
// so ids, ranks and timestamps derive only from the input.
const T0 = "2026-01-01T00:00:00.000Z";

/** Area mapping by project `short`. "*" catches every project no other area claims; without a catch-all
 *  unmatched projects go to Eingang. The real mapping is private (fokus-data/tools/areas.json, passed to
 *  tools/migrate.ts); this public default only puts everything under one area. */
export interface AreaMap { id: string; title: string; shorts: string[] }
export const DEFAULT_AREAS: AreaMap[] = [{ id: "a_projekte", title: "Projekte", shorts: ["*"] }];

type V1 = { schema?: number; projects?: any[]; tasks?: any[]; meetings?: any[]; deleted?: Record<string, string> };

const omit = (o: any, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export function migrate(v1: V1, AREAS: AreaMap[] = DEFAULT_AREAS): FileV2 {
  const projects = (v1.projects ?? []).filter(p => p?.id);
  const tasks = (v1.tasks ?? []).filter(t => t?.id);
  const meetings = (v1.meetings ?? []).filter(m => m?.id);
  const pids = new Set(projects.map(p => p.id));
  const nodes: FNode[] = [];

  const [rInbox, ...rAreas] = ranks(AREAS.length + 1);
  nodes.push({ id: INBOX, type: "system", parent: null, rank: rInbox, title: "Eingang", created: T0, updated: T0 });
  AREAS.forEach((a, i) => nodes.push({ id: a.id, type: "area", parent: null, rank: rAreas[i], title: a.title, created: T0, updated: T0 }));

  const areaOf = (short: string) => (AREAS.find(a => a.shorts.includes((short || "").toLowerCase())) ?? AREAS.find(a => a.shorts.includes("*")))?.id ?? INBOX;
  const ordered = projects.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name)) || (a.id < b.id ? -1 : 1));
  const byParent = new Map<string, any[]>();
  for (const p of ordered) { const k = areaOf(p.short); byParent.set(k, [...(byParent.get(k) ?? []), p]); }
  for (const [parent, list] of byParent) {
    const r = ranks(list.length);
    list.forEach((p, i) => nodes.push({
      ...omit(p, ["name", "order"]), id: p.id, type: "project", parent, rank: r[i], title: p.name ?? "",
      created: p.created ?? p.updated ?? T0, updated: p.updated ?? T0,
    }));
  }

  // Tasks and meetings under their project; in creation order.
  const kids = new Map<string, FNode[]>();
  const add = (n: FNode) => kids.set(n.parent!, [...(kids.get(n.parent!) ?? []), n]);
  for (const t of tasks) add({
    ...omit(t, ["project", "note"]), id: t.id, type: "task", parent: pids.has(t.project) ? t.project : INBOX, rank: "",
    title: t.title ?? "", ...(t.note ? { body: t.note } : {}), created: t.created ?? t.updated ?? T0, updated: t.updated ?? T0,
  });
  for (const m of meetings) add({
    ...omit(m, ["project", "notes"]), id: m.id, type: "meeting", parent: pids.has(m.project) ? m.project : INBOX, rank: "",
    title: m.title ?? "", ...(m.notes ? { body: m.notes } : {}), created: m.created ?? m.updated ?? T0, updated: m.updated ?? T0,
  });
  for (const list of kids.values()) {
    list.sort((a, b) => ts(a.created) - ts(b.created) || (a.id < b.id ? -1 : 1));
    const r = ranks(list.length);
    list.forEach((n, i) => { n.rank = r[i]; nodes.push(n); });
  }

  nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { schema: 2, nodes, deleted: { ...(v1.deleted ?? {}) } };
}
