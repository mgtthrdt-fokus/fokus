import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import { INBOX, STATUSES, addDays, isActionable, isOpen, today, type FNode, type NodeType, type Status } from "./model.ts";
import { S, add, addChild, childType, getTree, indent, moveBy, moveRel, outdent, remove, setStatus, setUi, toggleDone, update } from "./store.ts";
import type { Tree } from "./tree.ts";
import { fmtDue, hours, isOverdue, overdueDays } from "./fmt.ts";
import { byRank } from "./rank.ts";
import { liveTasks } from "./today.ts";
import { startTimer } from "./Timer.tsx";
import { toast } from "./views.tsx";
export const REPEAT_NAME: Record<string, string> = { daily: "täglich", weekdays: "werktags", weekly: "wöchentlich", monthly: "monatlich", yearly: "jährlich" };

export type View = "outline" | "today" | "board" | "meetings" | "review";
export interface Route { id: string | null; v: View; f: boolean }
export function parseHash(h = location.hash): Route {
  const m = h.match(/^#\/(?:n\/([\w-]{1,64}))?(?:\?(.*))?$/), q = new URLSearchParams(m?.[2] ?? "");
  const v = q.get("v") as View;
  return { id: m?.[1] ?? null, v: ["today", "board", "meetings", "review"].includes(v) ? v : "outline", f: q.has("f") };
}
export const href = (r: Route) => {
  const q = [r.v !== "outline" ? "v=" + r.v : "", r.f ? "f" : ""].filter(Boolean).join("&");
  return "#/" + (r.id ? "n/" + r.id : "") + (q ? "?" + q : "");
};
export const nav = (p: Partial<Route>) => { location.hash = href({ ...parseHash(), ...p }); };
/** Zoom keeps the view, except Heute/Rückblick, which ignore zoom; there zooming opens the outline. */
export const go = (id: string | null) => { const r = parseHash(); nav({ id, v: r.v === "today" || r.v === "review" ? "outline" : r.v }); };

/* ---------- focus handoff across re-renders ---------- */
let pending: { id: string; caret: number | "end" } | null = null;
let editingId: string | null = null;   // row with the caret; stays visible past the depth limit
export const focusTitle = (id: string, caret: number | "end" = "end") => { pending = { id, caret }; };
/** What "＋" creates under a node, in words. */
export const NEW_NAME: Record<string, string> = { area: "Neuer Bereich", project: "Neues Projekt", package: "Neues Arbeitspaket", task: "Neue Aufgabe", note: "Neue Notiz", meeting: "Neues Meeting" };
function caretOffset(el: HTMLElement): number {
  const s = getSelection(); if (!s || !s.rangeCount) return el.textContent!.length;
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
  return r.toString().length;
}
function placeCaret(el: HTMLElement, pos: number | "end") {
  el.focus();
  const t = el.firstChild, len = t?.textContent?.length ?? 0, p = pos === "end" ? len : Math.min(pos, len);
  const r = document.createRange();
  if (t) r.setStart(t, p); else r.setStart(el, 0);
  r.collapse(true);
  const s = getSelection(); s?.removeAllRanges(); s?.addRange(r);
}
const titles = () => [...document.querySelectorAll<HTMLElement>("[data-title]")];

/* ---------- editable title (uncontrolled while focused, so the caret never jumps) ---------- */
export function Title({ n, root, tag = "span", class: cls = "title", flat = false }: { n: FNode; root: string | null; tag?: "span" | "h1"; class?: string; flat?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (document.activeElement !== el && el.textContent !== n.title) el.textContent = n.title;
    if (pending?.id === n.id) { const p = pending; pending = null; placeCaret(el, p.caret); }
  });
  const onInput = (e: JSX.TargetedEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (el.textContent!.includes("\n")) el.textContent = el.textContent!.replace(/\s*\n\s*/g, " ");
    update(n.id, { title: el.textContent! });
  };
  const onKey = (e: KeyboardEvent) => {
    const el = ref.current!, mod = e.ctrlKey || e.metaKey, tree = getTree();
    const isRoot = n.id === root;
    if (e.key === "Enter" && mod) { e.preventDefault(); if (isActionable(n)) toggleDone(n.id); return; }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); setUi({ sel: S.sel === n.id ? null : n.id }); return; }
    // cards (Heute, Board …) have no tree around them: Enter/Esc only commit
    if (flat && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); el.blur(); return; }
    if (flat && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (isRoot) { const id = add(n.id, null); focusTitle(id, 0); return; }
      const text = el.textContent!, at = caretOffset(el);
      if (at === 0 && text) { const prev = tree.kids(n.parent).filter(s => s.rank < n.rank).pop(); const id = add(n.parent, prev?.id ?? null); focusTitle(id, 0); return; }
      if (at < text.length) { el.textContent = text.slice(0, at); update(n.id, { title: text.slice(0, at) }); }
      // with visible children, a new line goes first among them, like every outliner
      const open = tree.kids(n.id).length > 0 && !S.collapsed.has(n.id);
      const id = open ? add(n.id, null) : add(n.parent, n.id);
      if (at < text.length) update(id, { title: text.slice(at) });
      focusTitle(id, 0); return;
    }
    if (e.key === "Tab" && !isRoot) { e.preventDefault(); const c = caretOffset(el); e.shiftKey ? outdent(n.id, root) : indent(n.id); focusTitle(n.id, c); return; }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !isRoot) { e.preventDefault(); const c = caretOffset(el); moveBy(n.id, e.key === "ArrowUp" ? -1 : 1); focusTitle(n.id, c); return; }
    if (!e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const all = titles(), i = all.indexOf(el), j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (all[j]) { e.preventDefault(); placeCaret(all[j], e.key === "ArrowUp" ? "end" : 0); }
      return;
    }
    if (e.key === "Backspace" && !isRoot && el.textContent === "" && tree.kids(n.id).length === 0 && n.id !== INBOX) {
      e.preventDefault();
      const all = titles(), prev = all[all.indexOf(el) - 1]?.dataset.title;
      remove(n.id); if (prev) focusTitle(prev, "end"); return;
    }
    if (mod && e.key === ".") { e.preventDefault(); go(n.id); return; }
    if (mod && e.key === "/") { e.preventDefault(); const r = el.getBoundingClientRect(); openMenu(n.id, r.left, r.bottom); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); el.blur(); }
  };
  const Tag = tag as any;
  return <Tag ref={ref} class={cls} data-title={n.id} contentEditable={n.id === INBOX ? false : "plaintext-only"} spellcheck={false}
    role="textbox" aria-label="Titel" onInput={onInput} onKeyDown={onKey}
    onFocus={() => { editingId = n.id; if (S.sel && S.sel !== n.id) setUi({ sel: n.id }); }}
    onBlur={() => {
      if (editingId === n.id) editingId = null;
      // a fresh outline row left empty is clutter, not data: drop it (never rows with children or older ones)
      const x = getTree().byId.get(n.id);
      if (!flat && x && n.id !== root && n.id !== INBOX && !x.title.trim() && !getTree().kids(n.id).length && Date.now() - Date.parse(x.created) < 10 * 60_000)
        setTimeout(() => { const y = getTree().byId.get(n.id); if (y && !y.title.trim() && document.activeElement?.getAttribute("data-title") !== n.id) remove(n.id); }, 0);
    }} />;
}

/* ---------- row menu (right-click / long-press on bullet / Ctrl+/) ---------- */
let setMenuState: (m: { id: string; x: number; y: number } | null) => void = () => {};
export const openMenu = (id: string, x: number, y: number) => setMenuState({ id, x, y });
const TYPES: [NodeType, string][] = [["area", "Bereich"], ["project", "Projekt"], ["package", "Arbeitspaket"], ["task", "Aufgabe"], ["note", "Notiz"], ["meeting", "Meeting"]];
export const STATUS_NAME: Record<Status, string> = { inbox: "Eingang", now: "Fokus heute", next: "Diese Woche", later: "Später", waiting: "Wartet auf", done: "Erledigt" };

// Things-style "When": the four dates people actually pick
const nextMonday = () => { const t = today(), d = new Date(t + "T12:00:00").getDay(); return addDays(t, ((8 - d) % 7) || 7); };
export const QUICK: [string, () => string | null][] = [["Heute", today], ["Morgen", () => addDays(today(), 1)], ["Nächste Woche (Mo)", nextMonday], ["Kein Datum", () => null]];

export function RowMenu() {
  const [m, set] = useState<{ id: string; x: number; y: number } | null>(null);
  setMenuState = set;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    // clamp with the real size: the menu is taller for tasks than for projects
    const r = el.getBoundingClientRect();
    el.style.top = Math.max(8, Math.min(r.top, innerHeight - r.height - 8)) + "px";
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - r.width - 8)) + "px";
    el.querySelector<HTMLElement>("button, a")?.focus();
  }, [m]);
  if (!m) return null;
  const n = getTree().byId.get(m.id); if (!n) return null;
  const close = () => set(null);
  const act = (f: () => void) => () => { f(); close(); };
  const setType = (t: NodeType) => update(n.id, t === "task" ? { type: t, status: n.status ?? "next" } : { type: t });
  const x = m.x, y = m.y;
  return <>
    <div class="scrim" style={{ background: "transparent" }} onClick={close} onContextMenu={e => { e.preventDefault(); close(); }} />
    <div class="menu" role="menu" ref={box} style={{ left: Math.max(8, x) + "px", top: Math.max(8, y) + "px" }}
      onKeyDown={e => { if (e.key === "Escape") close(); }}>
      <button role="menuitem" onClick={act(() => go(n.id))}>Hineinzoomen</button>
      <button role="menuitem" onClick={act(() => setUi({ sel: n.id }))}>Details</button>
      {n.type !== "task" && <button role="menuitem" onClick={act(() => focusTitle(addChild(n.id), 0))}>＋ {NEW_NAME[childType[n.type]]} darin</button>}
      {isActionable(n) && isOpen(n) && <button role="menuitem" onClick={act(() => startTimer(n.id))}>▶ Fokus-Timer 25 min</button>}
      {n.obsidian && <a role="menuitem" class="mi" href={n.obsidian} onClick={close}>◈ In Obsidian öffnen</a>}
      {n.id !== INBOX && <>
        {isActionable(n) && <><div class="h">Fällig</div>
          {QUICK.map(([l, f]) => <button role="menuitemradio" aria-checked={(n.due ?? null) === f()} onClick={act(() => update(n.id, { due: f() }))}>{l}</button>)}</>}
        <div class="h">Typ</div>
        {TYPES.map(([t, name]) => <button role="menuitemradio" aria-checked={n.type === t} onClick={act(() => setType(t))}>{name}</button>)}
        {isActionable(n) && <><div class="h">Status</div>
          {STATUSES.map(s => <button role="menuitemradio" aria-checked={n.status === s} onClick={act(() => setStatus(n.id, s))}>{STATUS_NAME[s]}</button>)}</>}
        {(n.type === "project" || n.type === "package") && <><div class="h">Projekt</div>
          <button role="menuitem" onClick={act(() => update(n.id, { state: n.state === "holding" ? "active" : "holding" }))}>{n.state === "holding" ? "Wieder aktiv" : "Pausieren"}</button>
          <button role="menuitem" onClick={act(() => update(n.id, { archived: !n.archived }))}>{n.archived ? "Aus Archiv holen" : "Archivieren"}</button></>}
        <div class="h" />
        <button role="menuitem" class="danger" onClick={act(() => { const k = getTree().kids(n.id).length; remove(n.id); toast(`„${n.title || "Ohne Titel"}“${k ? " mit Unterpunkten" : ""} gelöscht.`, true); })}>Löschen</button>
      </>}
    </div>
  </>;
}

/* ---------- rows ---------- */
export function Chips({ n, t, showRollup }: { n: FNode; t: Tree; showRollup: boolean }) {
  const c: JSX.Element[] = [];
  if (isActionable(n) && isOpen(n)) {
    if (n.status === "waiting") c.push(<span class="wt">⏳ {n.waitingOn || "wartet"}</span>);
    if (n.status === "now") c.push(<span>◎ heute</span>);
    if (n.due) c.push(isOverdue(n.due) && n.status !== "waiting" ? <span class="od">⚠ {overdueDays(n.due)} T überfällig</span> : <span>→ {fmtDue(n.due)}</span>);
    if (n.est || n.act) c.push(<span title="Ist / geschätzt">{n.act ? `⏱ ${hours(Number(n.act))}${n.est ? " / " + hours(Number(n.est)) : ""}` : hours(Number(n.est))}</span>);
    if (n.plan) c.push(<span title="Zeitblock">▦ {n.plan.slice(8, 10)}.{n.plan.slice(5, 7)}. {n.plan.slice(11)}</span>);
  }
  if (n.repeat) c.push(<span title="Wiederholt sich">↻ {REPEAT_NAME[n.repeat]}</span>);
  if (n.obsidian) c.push(<a class="obs" href={n.obsidian} title="Notiz in Obsidian öffnen">◈ Notiz</a>);
  if (n.proposed) c.push(<span class="prop">Vorschlag von Claude
    <button onClick={() => update(n.id, { proposed: undefined })} aria-label="Vorschlag annehmen">✓ annehmen</button>
    <button onClick={() => remove(n.id)} aria-label="Vorschlag verwerfen">✕</button></span>);
  if (n.archived) c.push(<span>archiviert</span>);
  if (showRollup) {
    const r = t.rollup(n.id);
    if (r.holding && (n.type === "project" || n.type === "package")) c.push(<span>⏸ pausiert</span>);
    if (r.total) {
      c.push(<span>{r.open} offen</span>);
      if (r.overdue) c.push(<span class="od">⚠ {r.overdue} überfällig</span>);
      if (r.waiting) c.push(<span class="wt">⏳ {r.waiting}</span>);
      if (r.nextDue && !r.overdue) c.push(<span>→ {fmtDue(r.nextDue)}</span>);
      if (r.est) c.push(<span>{hours(r.est)}</span>);
    }
    if (r.noNext) c.push(<span class="nx">◇ kein nächster Schritt</span>);
  }
  return c.length ? <span class="chips">{c}</span> : null;
}

const Caret = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>;

function Bullet({ n, more }: { n: FNode; more: boolean }) {
  const timer = useRef<number>(0), long = useRef(false);
  const down = (e: PointerEvent) => {
    long.current = false;
    if (e.pointerType !== "mouse") timer.current = window.setTimeout(() => { long.current = true; navigator.vibrate?.(10); openMenu(n.id, e.clientX, e.clientY); }, 450);
    // Chrome never drags a <button>; so the row becomes draggable while the bullet is held (text editing stays normal)
    else if (n.id !== INBOX) {
      const li = (e.currentTarget as HTMLElement).closest("li"); if (!li) return;
      li.draggable = true;
      addEventListener("pointerup", () => { li.draggable = false; }, { once: true });
    }
  };
  const up = () => clearTimeout(timer.current);
  // the bullet is also the drag handle (desktop); titles stay selectable text
  return <button class="bullet" data-t={n.type} data-more={more || undefined} aria-label={`In „${n.title || "Ohne Titel"}“ hineinzoomen`}
    style={n.color ? { "--pc": n.color } as any : undefined}
    onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
    onClick={() => { if (!long.current) go(n.id); }}><i class="b" /></button>;
}

interface Vis { n: FNode; lvl: number; kids: number; open: boolean }
function visible(t: Tree, root: string | null, depth: number): Vis[] {
  const out: Vis[] = [];
  const walk = (id: string | null, lvl: number) => {
    for (const n of t.kids(id)) {
      const kids = t.kids(n.id).length;
      // past the depth limit only to keep the row being edited visible (e.g. right after Tab)
      const open = kids > 0 && !S.collapsed.has(n.id) && (lvl < depth || [pending?.id, editingId].some(x => x && t.path(x).some(a => a.id === n.id && a.id !== x)));
      out.push({ n, lvl, kids, open });
      if (open) walk(n.id, lvl + 1);
    }
  };
  walk(root, 1);
  return out;
}

export function Outline({ t, root }: { t: Tree; root: string | null }) {
  const [drop, setDrop] = useState<{ id: string; where: "before" | "after" | "inside" } | null>(null);
  const rows = visible(t, root, S.depth);
  const last = t.kids(root).at(-1);
  const addEnd = () => focusTitle(addChild(root), 0);
  const newName = NEW_NAME[root ? childType[t.byId.get(root)?.type ?? "task"] : "area"];
  return <>
    <ul class="tree" role="tree" aria-label="Gliederung">
      {rows.map(({ n, lvl, kids, open }) => {
        const act = isActionable(n);
        const container = n.type === "project" || n.type === "area" || n.type === "package";
        const showRollup = container || (kids > 0 && !open);
        const r = kids > 0 ? t.rollup(n.id) : null;
        return <li key={n.id} class="row" role="treeitem" aria-level={lvl} aria-expanded={kids ? open : undefined}
          data-t={n.type} data-lvl={lvl - 1} data-done={n.status === "done" || undefined} data-arch={n.archived || undefined} data-prop={n.proposed || undefined}
          data-drop={drop?.id === n.id ? drop.where : undefined}
          onDragStart={e => { if (!e.currentTarget.draggable) return; e.dataTransfer!.setData("text/plain", n.id); e.dataTransfer!.effectAllowed = "move"; }}
          onDragEnd={e => { e.currentTarget.draggable = false; setDrop(null); }}
          style={{ "--lvl": lvl - 1, "--guide": lvl > 1 ? "block" : "none" } as any}
          onDragOver={e => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
            const where = y < 0.3 ? "before" : y > 0.7 ? "after" : "inside";
            if (drop?.id !== n.id || drop.where !== where) setDrop({ id: n.id, where });
          }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}
          onDrop={e => {
            e.preventDefault(); setDrop(null);
            const id = e.dataTransfer?.getData("text/plain");
            if (id && drop && t.byId.has(id)) { moveRel(id, n.id, drop.where); if (drop.where === "inside" && S.collapsed.has(n.id)) setUi({ toggle: n.id }); }
          }}
          onContextMenu={e => { e.preventDefault(); openMenu(n.id, e.clientX, e.clientY); }}>
          <button class="caret" tabIndex={-1} aria-expanded={kids ? open : undefined} aria-label={kids ? (open ? "Zuklappen" : "Aufklappen") : undefined}
            onClick={() => kids && (lvl >= S.depth && !open ? go(n.id) : setUi({ toggle: n.id }))}>{kids ? <Caret /> : null}</button>
          <Bullet n={n} more={kids > 0 && !open} />
          {act && <span class="check"><button role="checkbox" aria-checked={n.status === "done"} aria-label="Erledigt" onClick={() => toggleDone(n.id)}>
            {n.status === "done" && <Tick />}
          </button></span>}
          <span class="body">
            <Title n={n} root={root} />
            <Chips n={n} t={t} showRollup={showRollup} />
            {r && r.total > 0 && container && <span class="mini" aria-hidden="true"><i style={{ width: r.pct + "%" }} /></span>}
          </span>
          <button class="iconbtn rowmore" aria-label={`Aktionen für „${n.title || "Ohne Titel"}“`} title="Aktionen (Strg+/)"
            onClick={e => { const b = e.currentTarget.getBoundingClientRect(); openMenu(n.id, b.right - 220, b.bottom); }}>⋯</button>
        </li>;
      })}
    </ul>
    {!rows.length && <p class="empty">Noch leer. Unten auf „＋ {newName}“ klicken oder <span class="mono">N</span> drücken.</p>}
    <button class="add" onClick={addEnd}><span aria-hidden="true">＋</span> {newName}</button>
  </>;
}

/* ---------- card: task row for Heute, Board, Rückblick, Meetings, Fokus ---------- */
export function Card({ n, t, path = true, extra, drag, root = null }: { n: FNode; t: Tree; path?: boolean; extra?: ComponentChildren; drag?: boolean; root?: string | null }) {
  // touch swipe: right = done, left = later (HANDOVER §3.6)
  const x0 = useRef<number | null>(null), [dx, setDx] = useState(0);
  const down = (e: PointerEvent) => { if (e.pointerType === "touch") x0.current = e.clientX; };
  const move = (e: PointerEvent) => { if (x0.current != null) setDx(Math.max(-120, Math.min(120, e.clientX - x0.current))); };
  const up = () => { if (dx > 80) toggleDone(n.id); else if (dx < -80) setStatus(n.id, "later"); x0.current = null; setDx(0); };
  return <li class="row card" data-t={n.type} data-done={n.status === "done" || undefined} data-prop={n.proposed || undefined}
    data-swipe={dx > 80 ? "done" : dx < -80 ? "later" : undefined}
    style={{ "--lvl": 0, transform: dx ? `translateX(${dx}px)` : "" } as any}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { x0.current = null; setDx(0); }}
    draggable={drag} onDragStart={drag ? e => e.dataTransfer?.setData("text/plain", n.id) : undefined}
    onContextMenu={e => { e.preventDefault(); openMenu(n.id, e.clientX, e.clientY); }}>
    <span class="check"><button role="checkbox" aria-checked={n.status === "done"} aria-label="Erledigt" onClick={() => toggleDone(n.id)}>
      {n.status === "done" && <Tick />}</button></span>
    <span class="body" onClick={e => { if (!(e.target as HTMLElement).closest("a, button, input")) setUi({ sel: n.id }); }}>
      {path && <span class="path">{t.path(n.parent).slice(t.path(root).length).map(p => p.title).join(" › ") || "\u00a0"}</span>}
      <span class="title">{n.title || "Ohne Titel"}</span>
      <Chips n={n} t={t} showRollup={false} />
    </span>
    {extra && <span class="extra">{extra}</span>}
    <button class="iconbtn more" aria-label="Details" title="Details (Strg+I)" onClick={() => setUi({ sel: n.id })}>›</button>
  </li>;
}
const Tick = () => <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>;

/* ---------- focus mode: open actionable items of the zoom root, by due date ---------- */
export function FocusList({ t, root }: { t: Tree; root: string | null }) {
  const items = liveTasks(t, today(), root).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : byRank(a, b));
  if (!items.length) return <p class="empty">Nichts offen. Gut gemacht.</p>;
  return <ul class="tree cards" role="list">{items.map(n => <Card key={n.id} n={n} t={t} root={root} />)}</ul>;
}
