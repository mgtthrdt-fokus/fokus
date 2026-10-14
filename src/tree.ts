import { isActionable, isOpen, today, type FNode } from "./model.ts";
import { byRank } from "./rank.ts";

export interface Rollup {
  total: number; open: number; overdue: number; waiting: number;
  pct: number;              // 0..100 done, by est if every actionable has est, else by count
  nextDue: string | null;   // earliest due among open items
  est: number;              // Σ est of open items, hours
  noNext: boolean;          // F3: active project/package without an open task
  holding: boolean;         // F4
}

export interface Tree {
  byId: Map<string, FNode>;
  kids: (id: string | null) => FNode[];
  path: (id: string | null) => FNode[];   // root → id, excluding the virtual "Alle"
  rollup: (id: string | null) => Rollup;
  activeProjects: number;
}

export function buildTree(nodes: FNode[], day = today()): Tree {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const children = new Map<string | null, FNode[]>();
  for (const n of nodes) {
    const k = n.parent && byId.has(n.parent) ? n.parent : null;
    (children.get(k) ?? children.set(k, []).get(k)!).push(n);
  }
  for (const l of children.values()) l.sort(byRank);
  const kids = (id: string | null) => children.get(id) ?? [];

  const memo = new Map<string | null, Rollup>();
  // Iterative post-order would be safer for very deep trees; recursion is fine for a personal outline.
  const rollup = (id: string | null): Rollup => {
    const hit = memo.get(id); if (hit) return hit;
    const self = id ? byId.get(id) : undefined;
    let total = 0, open = 0, overdue = 0, waiting = 0, est = 0, estAll = 0, estDone = 0, everyEst = true, done = 0;
    let nextDue: string | null = null;
    const walk = (n: FNode) => {
      if (n.archived) return;
      if (isActionable(n)) {
        total++;
        const e = Number(n.est) || 0;
        if (!e) everyEst = false;
        estAll += e;
        if (isOpen(n)) {
          open++; est += e;
          if (n.status === "waiting") waiting++;
          else if (n.due && n.due < day) overdue++;
          if (n.due && (!nextDue || n.due < nextDue)) nextDue = n.due;
        } else { done++; estDone += e; }
      }
      for (const c of kids(n.id)) walk(c);
    };
    for (const c of kids(id)) walk(c);
    const pct = total === 0 ? 0 : Math.round(100 * (everyEst && estAll > 0 ? estDone / estAll : done / total));
    const holding = self?.state === "holding" || (self ? path(self.id).some(a => a.state === "holding") : false);
    const noNext = !!self && (self.type === "project" || self.type === "package") && !self.archived && !holding && open === 0;
    const r = { total, open, overdue, waiting, pct, nextDue, est, noNext, holding };
    memo.set(id, r);
    return r;
  };

  const path = (id: string | null): FNode[] => {
    const out: FNode[] = [];
    const seen = new Set<string>();
    for (let n = id ? byId.get(id) : undefined; n && !seen.has(n.id); n = n.parent ? byId.get(n.parent) : undefined) { seen.add(n.id); out.unshift(n); }
    return out;
  };

  const activeProjects = nodes.filter(n => n.type === "project" && !n.archived && n.state !== "holding").length;
  return { byId, kids, path, rollup, activeProjects };
}
