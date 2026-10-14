import { today } from "./model.ts";
import type { Rollup } from "./tree.ts";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const days = (s: string) => Math.round((new Date(s + "T12:00:00").getTime() - new Date(today() + "T12:00:00").getTime()) / 864e5);

export function fmtDue(s: string): string {
  const d = days(s);
  if (d === 0) return "heute"; if (d === 1) return "morgen"; if (d === -1) return "gestern";
  const x = new Date(s + "T12:00:00");
  return `${WD[x.getDay()]} ${x.getDate()}.${x.getMonth() + 1}.` + (d < 0 ? ` (${-d} T überfällig)` : "");
}
export const overdueDays = (s: string) => -days(s);
export const isOverdue = (s?: string | null) => !!s && s < today();
export const hours = (h: number) => (Math.round(h * 10) / 10).toString().replace(".", ",") + " h";

/** "12 offen. 2 überfällig. 18 h geschätzt." */
export function metaLine(r: Rollup): string {
  if (r.total === 0) return "Noch keine Aufgaben.";
  const parts = [`${r.open} offen`];
  if (r.overdue) parts.push(`${r.overdue} überfällig`);
  if (r.waiting) parts.push(`${r.waiting} wartet`);
  if (r.est) parts.push(`${hours(r.est)} geschätzt`);
  if (r.open === 0) parts.push("alles erledigt");
  return parts.join(". ") + ".";
}
