import { useEffect, useState } from "preact/hooks";
import { getTree, update } from "./store.ts";
import { toast } from "./views.tsx";

// Focus timer (Pomodoro 25/5). Runs on timestamps, so a reload or a sleeping phone loses nothing.
// Focus time is added to the task's `act` hours, which the Rückblick compares with `est`.
const FOCUS = 25 * 60_000, BREAK = 5 * 60_000;
interface T { id: string | null; kind: "focus" | "break"; end: number; dur: number; paused?: number }
const KEY = "fk2_timer";
const load = (): T | null => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const save = (t: T | null) => { try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

let setT: (t: T | null) => void = () => {};
export const startTimer = (id: string | null, kind: "focus" | "break" = "focus") => {
  const dur = kind === "focus" ? FOCUS : BREAK, t = { id, kind, end: Date.now() + dur, dur };
  save(t); setT(t);
};

function book(t: T, left: number) {
  const h = Math.round(((t.dur - left) / 3_600_000) * 100) / 100;
  const n = t.id ? getTree().byId.get(t.id) : undefined;
  if (t.kind === "focus" && n && h >= 0.02) update(n.id, { act: Math.round(((Number(n.act) || 0) + h) * 100) / 100 });
}
function chime() {
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 660; g.gain.setValueAtTime(0.15, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 1.2);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 1.2);
  } catch { /* no audio */ }
  navigator.vibrate?.([200, 100, 200]);
}
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function TimerBar() {
  const [t, set] = useState<T | null>(load);
  const [, tick] = useState(0);
  setT = set;
  const left = t ? (t.paused ?? t.end - Date.now()) : 0;
  useEffect(() => {
    if (!t || t.paused != null) { document.title = "Fokus"; return; }
    const i = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(i);
  }, [t]);
  useEffect(() => {
    if (!t || t.paused != null) return;
    document.title = `${mmss(left)} · Fokus`;
    if (left <= 0) {
      book(t, 0); chime(); save(null); set(null); document.title = "Fokus";
      toast(t.kind === "focus" ? "Fokusblock geschafft. 5 Minuten Pause?" : "Pause vorbei.");
      if (t.kind === "focus") setTimeout(() => startTimer(t.id, "break"), 0);
    }
  });
  if (!t) return null;
  const n = t.id ? getTree().byId.get(t.id) : undefined;
  const stop = () => { book(t, left); save(null); set(null); };
  const pause = () => { const p = t.paused != null ? { ...t, end: Date.now() + t.paused, paused: undefined } : { ...t, paused: left }; save(p); set(p); };
  return <div class="timer" role="timer" aria-live="off" data-kind={t.kind}>
    <span class="mono big">{mmss(left)}</span>
    <span class="tt">{t.kind === "break" ? "Pause" : n?.title || "Fokus"}</span>
    <i class="tbar" aria-hidden="true"><i style={{ width: Math.min(100, 100 * (1 - left / t.dur)) + "%" }} /></i>
    <button class="btn sec sm" onClick={pause}>{t.paused != null ? "Weiter" : "Pause"}</button>
    <button class="btn sec sm" onClick={stop}>Stopp</button>
  </div>;
}
