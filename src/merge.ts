import { INBOX, emptyFile, ts, type FNode, type FileV2 } from "./model.ts";
import { migrate, type AreaMap } from "./migrate.ts";

const byId = (a: FNode, b: FNode) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Any parsed file (v1, v2 or junk) → valid v2. */
export function normalize(d: any, areas?: AreaMap[]): FileV2 {
  if (!d || typeof d !== "object") return emptyFile();
  if (d.schema !== 2) return migrate(d, areas);
  const nodes: FNode[] = Array.isArray(d.nodes) ? d.nodes.filter((n: any) => n && typeof n.id === "string" && typeof n.type === "string") : [];
  if (!nodes.some(n => n.id === INBOX)) nodes.push(emptyFile().nodes[0]);
  const deleted = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
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
