import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { INBOX, type FNode } from "./model.ts";
import { S, capture, moveTo, setUi } from "./store.ts";
import { go } from "./Outline.tsx";
import { parseQuick } from "./parse.ts";
import type { Tree } from "./tree.ts";

// Ctrl+K: jump anywhere · N / FAB: capture · Inspector "Verschieben…": pick a new parent.
export function Palette({ t, root }: { t: Tree; root: string | null }) {
  const mode = S.palette!;
  const [q, setQ] = useState(""), [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => input.current?.focus(), []);
  const close = () => setUi({ palette: null });
  const moving = mode === "move" ? S.sel : null;

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: FNode[] = mode === "new" || !words.length ? [] : [...t.byId.values()]
    .filter(n => !n.archived && n.id !== moving && !(moving && t.path(n.id).some(a => a.id === moving)))
    .filter(n => { const hay = (t.path(n.id).map(p => p.title).join(" ") + " " + (n.short ?? "")).toLowerCase(); return words.every(w => hay.includes(w)); })
    .sort((a, b) => rankType(a) - rankType(b) || a.title.length - b.title.length)
    .slice(0, 30);
  type Item = { label: string; sub?: string; run: () => void };
  const items: Item[] = [];
  const target = root && t.byId.has(root) ? root : null;
  if (mode !== "move" && q.trim()) items.push({ label: "Neu: " + (parseQuick(q).title || q), sub: hint(q, t, target), run: () => { capture(q, target); } });
  if (mode === "move") items.push({ label: "Eingang", run: () => moveTo(moving!, INBOX) });
  for (const n of hits) items.push({
    label: n.title || "Ohne Titel", sub: t.path(n.parent).map(p => p.title).join(" › "),
    run: () => mode === "move" ? moveTo(moving!, n.id) : go(n.id),
  });
  const run = (k: number) => { const it = items[k]; if (it) { it.run(); close(); } };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setI(x => Math.min(x + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI(x => Math.max(x - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(i); }
  };
  const ph = mode === "new" ? "Neu…  #projekt >>paket @wer bis fr ab mo ! ::note" : mode === "move" ? "Verschieben nach…" : "Suchen oder neu anlegen…";
  return <>
    <div class="scrim" onClick={close} />
    <div class="palette" role="dialog" aria-modal="true" aria-label={ph}>
      <input ref={input} value={q} placeholder={ph} aria-label={ph} role="combobox" aria-expanded={items.length > 0} aria-controls="pal-list"
        aria-activedescendant={items.length ? "pal-" + i : undefined} onInput={e => { setQ(e.currentTarget.value); setI(0); }} onKeyDown={key}
        autocapitalize="sentences" enterKeyHint={mode === "new" ? "done" : "go"} />
      <ul id="pal-list" role="listbox">{items.map((it, k) =>
        <li id={"pal-" + k} role="option" aria-selected={k === i} key={k} onPointerDown={e => { e.preventDefault(); run(k); }}>
          <span>{it.label}</span>{it.sub && <span class="sub">{it.sub}</span>}</li>)}</ul>
      {mode === "new" && !q && <p class="hint">Ohne #projekt landet es {target ? "hier" : "im Eingang"}.</p>}
    </div>
  </>;
}
const rankType = (n: FNode) => ({ area: 0, project: 1, package: 2, meeting: 3, task: 4, note: 5, system: 0 } as const)[n.type];
function hint(q: string, t: Tree, target: string | null) {
  const p = parseQuick(q);
  return [p.project ? "#" + p.project : target ? "in " + (t.byId.get(target)?.title || "…") : "Eingang", p.pkg && ">> " + p.pkg,
    p.waitingOn && "wartet: " + p.waitingOn, p.due && "fällig " + p.due, p.start && "ab " + p.start, p.status === "now" && "Fokus", p.note && "Notiz"]
    .filter(Boolean).join(" · ");
}
