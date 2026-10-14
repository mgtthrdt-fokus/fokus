import { INBOX, STATUSES, isActionable, type FNode, type NodeType, type Status } from "./model.ts";
import { remove, setStatus, setUi, update } from "./store.ts";
import { STATUS_NAME, Title, go } from "./Outline.tsx";
import type { Tree } from "./tree.ts";

const TYPE_NAME: [NodeType, string][] = [["area", "Bereich"], ["project", "Projekt"], ["package", "Arbeitspaket"], ["task", "Aufgabe"], ["note", "Notiz"], ["meeting", "Meeting"]];
const COLORS = ["#3A9AD9", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#9AA6B2"];   // Okabe-Ito + grey
const fmtTs = (s?: string | null) => s ? new Date(s).toLocaleString("de-AT", { dateStyle: "medium", timeStyle: "short" }) : "—";
// "2,5" and "2.5" both work (v1 nit: desktop Chromium rejected the comma in type=number)
const num = (s: string) => { const v = parseFloat(s.replace(",", ".")); return isFinite(v) && v >= 0 ? v : null; };

export function Inspector({ n, t }: { n: FNode; t: Tree }) {
  const set = (p: Partial<FNode>) => update(n.id, p);
  const close = () => setUi({ sel: null });
  const backlinks = [...t.byId.values()].filter(x => x.meeting === n.id);
  const meeting = n.meeting ? t.byId.get(n.meeting) : undefined;
  const fixed = n.id === INBOX;
  const Txt = ({ k, label, ph }: { k: "waitingOn" | "short" | "series" | "attendees" | "resume"; label: string; ph?: string }) =>
    <label class="field"><span class="label">{label}</span><input type="text" key={k + n.id + (n[k] ?? "")} defaultValue={(n[k] as string) || ""} placeholder={ph} onChange={e => set({ [k]: e.currentTarget.value })} /></label>;
  const DateF = ({ k, label }: { k: "due" | "start" | "date"; label: string }) =>
    <label class="field"><span class="label">{label}</span><input type="date" value={(n[k] as string) || ""} onChange={e => set({ [k]: e.currentTarget.value || null })} /></label>;
  return <aside class="inspector" aria-label="Details">
    <div class="ihead">
      <select aria-label="Typ" value={n.type} disabled={fixed} onChange={e => { const ty = e.currentTarget.value as NodeType; set(ty === "task" ? { type: ty, status: n.status ?? "next" } : { type: ty }); }}>
        {fixed ? <option value="system">Eingang</option> : TYPE_NAME.map(([v, l]) => <option value={v}>{l}</option>)}
      </select>
      <span class="sp" />
      <button class="iconbtn" aria-label="Hineinzoomen" title="Hineinzoomen" onClick={() => go(n.id)}>⤢</button>
      <button class="iconbtn" aria-label="Schließen" title="Schließen (Esc)" onClick={close}>✕</button>
    </div>
    <Title n={n} root={null} tag="h1" class="root ititle" flat />
    {n.proposed && <p class="prop">Vorschlag von Claude. <button class="link" onClick={() => set({ proposed: undefined })}>Annehmen</button> · <button class="link" onClick={() => { remove(n.id); close(); }}>Verwerfen</button></p>}

    {isActionable(n) && <div class="fields">
      <label class="field"><span class="label">Status</span>
        <select value={n.status ?? "next"} onChange={e => setStatus(n.id, e.currentTarget.value as Status)}>{STATUSES.map(s => <option value={s}>{STATUS_NAME[s]}</option>)}</select></label>
      {DateF({ k: "due", label: "Fällig" })}
      {DateF({ k: "start", label: "Ab (vorher ausgeblendet)" })}
      {Txt({ k: "waitingOn", label: "Wartet auf", ph: "Name oder Firma" })}
      <label class="field"><span class="label">Aufwand (h)</span><input type="text" inputMode="decimal" key={"est" + n.id + n.est} defaultValue={n.est != null ? String(n.est).replace(".", ",") : ""} onChange={e => set({ est: num(e.currentTarget.value) })} /></label>
      <label class="field"><span class="label">Priorität</span>
        <select value={String(n.priority ?? "")} onChange={e => { const v = e.currentTarget.value; set({ priority: v ? (+v as 1 | 2 | 3) : undefined }); }}>
          <option value="">—</option><option value="1">1 hoch</option><option value="2">2</option><option value="3">3 niedrig</option></select></label>
    </div>}

    {(n.type === "project" || n.type === "package") && <div class="fields">
      {n.type === "project" && Txt({ k: "short", label: "Kürzel für #", ph: "nord" })}
      <label class="field"><span class="label">Zustand</span>
        <select value={n.state ?? "active"} onChange={e => set({ state: e.currentTarget.value as "active" | "holding" })}><option value="active">aktiv</option><option value="holding">pausiert</option></select></label>
      {n.type === "project" && <div class="field"><span class="label">Farbe</span><div class="swatches">{COLORS.map(c =>
        <button aria-label={"Farbe " + c} aria-pressed={n.color === c} style={{ background: c }} onClick={() => set({ color: c })} />)}</div></div>}
      <label class="chk"><input type="checkbox" checked={!!n.archived} onChange={e => set({ archived: e.currentTarget.checked })} /> Archiviert</label>
    </div>}

    {n.type === "meeting" && <div class="fields">{DateF({ k: "date", label: "Datum" })}{Txt({ k: "series", label: "Serie" })}{Txt({ k: "attendees", label: "Teilnehmer" })}</div>}

    {Txt({ k: "resume", label: "Weitermachen bei…", ph: "wo ich stehe, nächster Schritt" })}
    <label class="field"><span class="label">Notizen</span>
      <textarea rows={7} value={n.body || ""} onInput={e => set({ body: e.currentTarget.value })} /></label>

    {meeting && <p class="hint">Aus Meeting: <button class="link" onClick={() => setUi({ sel: meeting.id })}>{meeting.title}</button></p>}
    {backlinks.length > 0 && <><p class="label">Aktionen aus diesem Meeting</p>
      <ul class="plain">{backlinks.map(b => <li key={b.id}><button class="link" onClick={() => setUi({ sel: b.id })}>{b.status === "done" ? "✓ " : ""}{b.title}</button></li>)}</ul></>}

    <p class="hint mono">Erstellt {fmtTs(n.created)} · Geändert {fmtTs(n.updated)}{n.done ? " · Erledigt " + n.done : ""}</p>
    {!fixed && <div class="grp">
      <button class="btn sec" onClick={() => setUi({ palette: "move" })}>Verschieben…</button>
      <button class="btn danger" onClick={() => { if (confirm(`„${n.title || "Ohne Titel"}“ mit allen Unterpunkten löschen?`)) { remove(n.id); close(); } }}>Löschen</button>
    </div>}
  </aside>;
}
