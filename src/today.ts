// Heute + Wochenrückblick as pure functions over the tree (HANDOVER §10: F1, F2, F5, F8, F9, F11, F15, F16).
import { addDays, isActionable, isOpen, ts, today, type FNode } from "./model.ts";
import { byRank } from "./rank.ts";
import type { Tree } from "./tree.ts";

export const DAY_HOURS = 8;     // F11 default (§11)
export const FOCUS_MAX = 3;     // F5
export const WEEK_MAX = 10;     // F5
const STALE_WAIT = 7, STALE = 14, DECAY = 60;   // days

const byDue = (a: FNode, b: FNode) => (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : byRank(a, b);
export const ageDays = (n: FNode, day = today()) => Math.floor((ts(day + "T12:00:00") - ts(n.touched || n.updated)) / 864e5);
export const isFocus = (n: FNode, day = today()) => n.status === "now" || (!!n.focus && n.focus <= day && n.status !== "done");

/** Open tasks that count: not archived/paused above, start date reached, not an unaccepted proposal. */
export function liveTasks(t: Tree, day = today(), root: string | null = null): FNode[] {
  const out: FNode[] = [];
  const walk = (id: string | null) => {
    for (const n of t.kids(id)) {
      if (n.archived || n.state === "holding") continue;
      if (isActionable(n) && isOpen(n) && !n.proposed && (!n.start || n.start <= day)) out.push(n);
      walk(n.id);
    }
  };
  walk(root);
  return out;
}

export function todayView(t: Tree, day = today()) {
  const open = liveTasks(t, day);
  const focus = open.filter(n => isFocus(n, day)).sort(byDue);
  const used = new Set(focus.map(n => n.id));
  const take = (f: (n: FNode) => boolean) => { const r = open.filter(n => !used.has(n.id) && f(n)).sort(byDue); r.forEach(n => used.add(n.id)); return r; };
  const follow = take(n => n.status === "waiting" && (n.due ? n.due <= day : ageDays(n, day) >= STALE_WAIT));   // F1
  const overdue = take(n => !!n.due && n.due < day && n.status !== "waiting");
  const soon = take(n => !!n.due && n.due <= addDays(day, 1) && n.status !== "waiting");
  const week = take(n => n.status === "next");
  // F15: one important item without a deadline, so due dates alone don't run the day (mere urgency effect)
  const slot = open.filter(n => !used.has(n.id) && !n.due && n.status !== "waiting" && n.status !== "inbox")
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || ageDays(b, day) - ageDays(a, day))[0] ?? null;
  const all = [...t.byId.values()];
  return {
    focus, follow, overdue, soon, week, slot,
    inbox: all.filter(n => n.parent === "sys_inbox" && isActionable(n) && isOpen(n)).length,
    proposed: all.filter(n => n.proposed),
    doneToday: all.filter(n => isActionable(n) && n.status === "done" && n.done === day),
    focusHours: focus.reduce((s, n) => s + (Number(n.est) || 0), 0),                                 // F11
    weekCount: open.filter(n => n.status === "next").length,
  };
}

export function reviewView(t: Tree, day = today()) {
  const all = [...t.byId.values()];
  const open = liveTasks(t, "9999-12-31");   // include deferred items: the review sees everything
  const containers = all.filter(n => (n.type === "project" || n.type === "package") && !n.archived);
  return {
    inbox: all.filter(n => n.parent === "sys_inbox" && n.type !== "system" && (!isActionable(n) || isOpen(n))),
    noNext: containers.filter(n => t.rollup(n.id).noNext),                                         // F3
    overdue: open.filter(n => n.due && n.due < day && n.status !== "waiting").sort(byDue),
    staleWaiting: open.filter(n => n.status === "waiting" && ageDays(n, day) >= STALE_WAIT),
    untouched: open.filter(n => n.status !== "waiting" && ageDays(n, day) >= STALE).sort((a, b) => ageDays(b, day) - ageDays(a, day)),
    decayDays: DECAY,                                                                                // F16
    holding: all.filter(n => (n.type === "project" || n.type === "package") && n.state === "holding" && !n.archived),
    unreviewed: all.filter(n => n.type === "project" && !n.archived && n.state !== "holding" && (!n.reviewed || n.reviewed <= addDays(day, -7))),
    doneWeek: all.filter(n => isActionable(n) && n.status === "done" && !!n.done && n.done > addDays(day, -7)),   // F9
  };
}
