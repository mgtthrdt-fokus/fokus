// Schema 2: one tree of nodes. See fokus-data/docs/HANDOVER.md §5.
export type NodeType = "area" | "project" | "package" | "task" | "note" | "meeting" | "system";
export type Status = "inbox" | "now" | "next" | "later" | "waiting" | "done";

export interface FNode {
  id: string;
  type: NodeType;
  parent: string | null;
  rank: string;
  title: string;
  body?: string;
  status?: Status;
  prev?: Status;          // status before "done", restored on uncheck (v1)
  due?: string | null;
  start?: string | null;
  waitingOn?: string;
  est?: number | null;
  act?: number | null;
  priority?: 1 | 2 | 3;
  done?: string | null;
  focus?: string | null;
  when?: string;
  resume?: string;
  short?: string;
  color?: string;
  archived?: boolean;
  state?: "active" | "holding";
  reviewed?: string | null;
  date?: string;
  series?: string;
  attendees?: string;
  meeting?: string | null;
  proposed?: boolean;
  touched?: string;
  created: string;
  updated: string;
  [k: string]: unknown;   // unknown fields survive round-trips
}

export interface FileV2 { schema: 2; nodes: FNode[]; deleted: Record<string, string> }

export const INBOX = "sys_inbox";
export const STATUSES: Status[] = ["inbox", "now", "next", "later", "waiting", "done"];

export const now = () => new Date().toISOString();
export const ts = (s?: string | null) => { const v = Date.parse(s || ""); return isNaN(v) ? 0 : v; };
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return isoDate(d); };
export const uid = (p: string) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Only tasks are actionable; a status left over after a type change is kept but ignored.
export const isActionable = (n: FNode) => n.type === "task";
export const isOpen = (n: FNode) => n.status !== "done";

export function emptyFile(): FileV2 {
  const t = "2026-01-01T00:00:00.000Z";
  return { schema: 2, deleted: {}, nodes: [{ id: INBOX, type: "system", parent: null, rank: "a0", title: "Eingang", created: t, updated: t }] };
}
