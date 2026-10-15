// Quick-add parser (v1 syntax + v2 additions):
//   "Text #projekt >>paket @wer bis fr ab mo ! ::note"
//   #x project by short/name · >>x package under it · @x waiting on x · bis/am <date> due · ab <date> start
//   ! focus today · ::note makes a note · dates: heute, morgen, übermorgen, mo…so, 12.11.(26), kw44, +3, +2w
import { addDays, isoDate, today, type FNode, type Repeat, type Status } from "./model.ts";

const WD: Record<string, number> = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };

export function parseDate(w: string, t = today()): string | null {
  w = w.toLowerCase().replace(/[,;]$/, "");
  if (w === "heute") return t;
  if (w === "morgen") return addDays(t, 1);
  if (w === "übermorgen" || w === "uebermorgen") return addDays(t, 2);
  if (w in WD) { const cur = new Date(t + "T12:00:00").getDay(); return addDays(t, (WD[w] - cur + 7) % 7 || 7); }
  let m = w.match(/^\+(\d+)(t|w)?$/); if (m) return addDays(t, +m[1] * (m[2] === "w" ? 7 : 1));
  m = w.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/);
  if (m) {
    let y = m[3] ? +m[3] : +t.slice(0, 4); if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1], 12);
    if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1) return null;
    // "3.1." typed in December means next January
    if (!m[3] && isoDate(d) < addDays(t, -60)) d.setFullYear(y + 1);
    return isoDate(d);
  }
  m = w.match(/^kw(\d{1,2})$/);
  if (m) { // Friday of ISO week; next year if already past
    const fri = (y: number) => { const j4 = new Date(y, 0, 4, 12); j4.setDate(j4.getDate() - ((j4.getDay() + 6) % 7) + (+m![1] - 1) * 7 + 4); return isoDate(j4); };
    const y = +t.slice(0, 4), s = fri(y);
    return s < t ? fri(y + 1) : s;
  }
  return null;
}

/** Next due date of a recurring task, counted from its last due date (or today). */
export function nextDate(from: string, r: Repeat): string {
  if (r === "daily") return addDays(from, 1);
  if (r === "weekly") return addDays(from, 7);
  if (r === "weekdays") { let d = addDays(from, 1); while ([0, 6].includes(new Date(d + "T12:00:00").getDay())) d = addDays(d, 1); return d; }
  const x = new Date(from + "T12:00:00"), day = x.getDate();
  if (r === "monthly") x.setMonth(x.getMonth() + 1, 1); else x.setFullYear(x.getFullYear() + 1, x.getMonth(), 1);
  // 31.1. → 28./29.2.: clamp to the month's last day instead of rolling into March
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return isoDate(x);
}
const REPEAT_WORDS: Record<string, Repeat> = { täglich: "daily", werktags: "weekdays", wöchentlich: "weekly", monatlich: "monthly", jährlich: "yearly" };

export interface Parsed {
  repeat?: Repeat;
  title: string; project?: string; pkg?: string; note: boolean;
  status?: Status; due?: string; start?: string; waitingOn?: string;
}
const DATE = /^(heute|morgen|übermorgen|uebermorgen|\d{1,2}\.\d{1,2}\.(\d{2,4})?|kw\d{1,2}|\+\d+[tw]?)$/i;

export function parseQuick(s: string, t = today()): Parsed {
  const out: Parsed = { title: "", note: false };
  const words = s.trim().split(/\s+/), rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = w.toLowerCase(), next = words[i + 1];
    if (w === "!") { out.status = "now"; continue; }
    if (lw === "::note" || lw === "::notiz") { out.note = true; continue; }
    if (/^#[\p{L}\p{N}_\-]+$/u.test(w)) { out.project = w.slice(1); continue; }
    if (/^>>[\p{L}\p{N}_\-]+$/u.test(w)) { out.pkg = w.slice(2).replace(/_/g, " "); continue; }
    if (/^@[\p{L}\p{N}_.\-]+$/u.test(w)) { const who = w.slice(1); if (!/^(ich|me|mir)$/i.test(who)) { out.waitingOn = who; out.status = "waiting"; } continue; }
    if ((lw === "bis" || lw === "am" || lw === "fällig") && next) { const d = parseDate(next, t); if (d) { out.due = d; i++; continue; } }
    if (lw === "ab" && next) { const d = parseDate(next, t); if (d) { out.start = d; i++; continue; } }
    if (lw in REPEAT_WORDS) { out.repeat = REPEAT_WORDS[lw]; continue; }
    if ((lw === "jeden" || lw === "jede") && next) {   // jeden tag / jede woche / jeden monat / jeden mo
      const nw = next.toLowerCase(), r: Repeat | undefined = nw === "tag" ? "daily" : nw === "woche" ? "weekly" : nw === "monat" ? "monthly" : nw === "jahr" ? "yearly" : undefined;
      if (r) { out.repeat = r; i++; continue; }
      const d = parseDate(nw, t); if (d && !/^\d/.test(nw)) { out.repeat = "weekly"; out.due ??= d; i++; continue; }
    }
    if (DATE.test(lw)) { const d = parseDate(lw, t); if (d) { out.due = d; continue; } }
    rest.push(w);
  }
  out.title = rest.join(" ");
  return out;
}

/** Project by short, exact name, then prefix (v1 order). */
export function findProject(nodes: FNode[], tag: string): FNode | undefined {
  const q = tag.toLowerCase(), ps = nodes.filter(n => n.type === "project" && !n.archived);
  return ps.find(p => (p.short || "").toLowerCase() === q) || ps.find(p => p.title.toLowerCase() === q)
    || ps.find(p => (p.short || "").toLowerCase().startsWith(q) || p.title.toLowerCase().startsWith(q));
}
