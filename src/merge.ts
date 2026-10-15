import { INBOX, REPEATS, STATUSES, emptyFile, now, ts, type FNode, type FileV2 } from "./model.ts";
import { migrate, type AreaMap } from "./migrate.ts";

const TYPES = ["area", "project", "package", "task", "note", "meeting", "system"];
const STR = ["body", "waitingOn", "short", "series", "attendees", "when", "resume", "meeting", "prev"];
const DATE = ["due", "start", "done", "focus", "reviewed", "date"];
const NUM = ["est", "act"];
const EPOCH = "1970-01-01T00:00:00.000Z";
const future = (s: string) => ts(s) > Date.now() + 864e5;   // a wrong clock or edited file must not win every merge forever
/** One node from outside (GitHub, import, fokus.py): wrong types would crash rendering on every start. */
function clean(n: any): FNode {
  const o: any = { ...n, title: String(n.title ?? ""), parent: typeof n.parent === "string" ? n.parent : null, rank: typeof n.rank === "string" ? n.rank : "a0" };
  for (const k of STR) if (o[k] != null && typeof o[k] !== "string") o[k] = String(o[k]);
  for (const k of DATE) if (o[k] != null && !(typeof o[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o[k]))) delete o[k];
  for (const k of NUM) if (o[k] != null && !(typeof o[k] === "number" && isFinite(o[k]) && o[k] >= 0)) delete o[k];
  if (o.status != null && !STATUSES.includes(o.status)) o.status = "next";
  if (o.priority != null && ![1, 2, 3].includes(o.priority)) delete o.priority;
  if (o.state != null && o.state !== "active" && o.state !== "holding") delete o.state;
  if (o.color != null && !/^#[0-9a-f]{3,8}$/i.test(o.color)) delete o.color;
  if (o.repeat != null && !REPEATS.includes(o.repeat)) delete o.repeat;
  if (o.plan != null && !(typeof o.plan === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.plan))) delete o.plan;
  // rendered as a link: only Obsidian's own scheme, never javascript: or http(s) from untrusted data
  if (o.obsidian != null && !(typeof o.obsidian === "string" && /^obsidian:\/\/open\?/.test(o.obsidian))) delete o.obsidian;
  for (const k of ["archived", "proposed"]) if (o[k] != null && typeof o[k] !== "boolean") o[k] = !!o[k];
  for (const k of ["created", "updated", "touched"]) {
    if (k === "touched" && o[k] == null) continue;
    if (typeof o[k] !== "string" || !ts(o[k])) o[k] = EPOCH;   // unknown age: loses every merge instead of winning
    else if (future(o[k])) o[k] = now();
  }
  return o;
}
const byId = (a: FNode, b: FNode) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Any parsed file (v1, v2 or junk) → valid v2. */
export function normalize(d: any, areas?: AreaMap[]): FileV2 {
  if (!d || typeof d !== "object") return emptyFile();
  if (d.schema !== 2) return migrate(d, areas);
  // Trust boundary (import, GitHub, Claude's CLI): coerce what the UI renders or feeds into CSS.
  const nodes: FNode[] = (Array.isArray(d.nodes) ? d.nodes : [])
    .filter((n: any) => n && typeof n.id === "string" && /^[\w-]{1,64}$/.test(n.id) && TYPES.includes(n.type))
    .map(clean);
  if (!nodes.some(n => n.id === INBOX)) nodes.push(emptyFile().nodes[0]);
  const deleted: Record<string, string> = {};
  if (d.deleted && typeof d.deleted === "object") for (const [k, v] of Object.entries(d.deleted)) if (typeof v === "string") deleted[k] = future(v) ? now() : v;
  return guard({ schema: 2, nodes, deleted });
}

/** Stable, human-readable form, same conventions as v1 / fokus.py (indent 1, sorted by id). */
export const serialize = (d: FileV2) =>
  JSON.stringify({ schema: 2, nodes: d.nodes.slice().sort(byId), deleted: d.deleted }, null, 1) + "\n";

/** Per-node last-write-wins on `updated`; tombstones win over older versions and expire after 90 days. */
export function merge(a: FileV2, b: FileV2): FileV2 {
  const del: Record<string, string> = { ...b.deleted };
  for (const [k, v] of Object.entries(a.deleted)) if (!del[k] || ts(v) > ts(del[k])) del[k] = v;
  const cutoff = Date.now() - 90 * 864e5;
  for (const k of Object.keys(del)) if (ts(del[k]) < cutoff) delete del[k];
  const m = new Map<string, FNode>();
  for (const x of b.nodes) m.set(x.id, x);
  for (const x of a.nodes) { const y = m.get(x.id); if (!y || ts(x.updated) >= ts(y.updated)) m.set(x.id, x); }
  const nodes = [...m.values()].filter(x => !del[x.id] || ts(x.updated) > ts(del[x.id]));
  return guard({ schema: 2, nodes, deleted: del });
}

/** After a merge a node can lose its parent (deleted elsewhere) or become its own ancestor
 *  (A moved under B on one device, B under A on the other). Both go to Eingang. */
export function guard(d: FileV2): FileV2 {
  const idx = new Map(d.nodes.map(n => [n.id, n]));
  const fix = (n: FNode) => ({ ...n, parent: INBOX });
  const nodes = d.nodes.map(n => {
    if (n.id === INBOX || n.parent === null) return n;
    if (!idx.has(n.parent)) return fix(n);
    const seen = new Set<string>();
    for (let p = idx.get(n.parent); p; p = p.parent ? idx.get(p.parent) : undefined) {
      if (p.id === n.id) return fix(n);   // n is inside the cycle
      if (seen.has(p.id)) break;          // cycle above n; its members fix themselves
      seen.add(p.id);
    }
    return n;
  });
  // Every member of a cycle is reparented; all land in Eingang. `updated` stays, so devices agree.
  return { ...d, nodes };
}
