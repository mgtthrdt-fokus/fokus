import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { INBOX, STATUSES, addDays, isActionable, isOpen, today, type FNode, type Status } from "./model.ts";
import { S, add, capture, setStatus, setUi, update } from "./store.ts";
import { Card, STATUS_NAME, Title, go } from "./Outline.tsx";
import { DAY_HOURS, FOCUS_MAX, WEEK_MAX, ageDays, isFocus, reviewView, todayView } from "./today.ts";
import { hours } from "./fmt.ts";
import { byRank } from "./rank.ts";
import type { Tree } from "./tree.ts";

const pad2 = (i: number) => String(i).padStart(2, "0");
function Section({ i, title, n, warn, actions, children }: { i: number; title: string; n?: string | number; warn?: boolean; actions?: ComponentChildren; children: ComponentChildren }) {
  return <section class="sec">
    <h2 class={"label" + (warn ? " w" : "")}>{pad2(i)} / {title}{n != null && <span class="n"> {n}</span>}{actions && <span class="acts">{actions}</span>}</h2>
    {children}
  </section>;
}
const List = ({ items, t, empty }: { items: FNode[]; t: Tree; empty?: string }) =>
  items.length ? <ul class="tree cards">{items.map(n => <Card key={n.id} n={n} t={t} />)}</ul> : empty ? <p class="empty">{empty}</p> : null;

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Kopiert."); } catch { prompt("Kopieren:", text); }
}
export let toast = (_: string) => {};
export function Toast() {
  const [m, set] = useState("");
  toast = (x: string) => { set(x); setTimeout(() => set(""), 2000); };
  return m ? <div class="toast" role="status">{m}</div> : null;
}

/* ---------- Heute (ignores zoom) ---------- */
export function TodayView({ t }: { t: Tree }) {
  const v = todayView(t), day = today();
  const [shut, setShut] = useState(false);
  let i = 0;
  return <>
    {v.focus.length > FOCUS_MAX && <div class="banner"><p class="w">◇ {v.focus.length} Dinge im Fokus. Mehr als {FOCUS_MAX} heißt: keins richtig. Eins nach „Diese Woche“?</p></div>}
    {v.focusHours > DAY_HOURS && <div class="banner"><p class="w">◇ Fokus geschätzt {hours(v.focusHours)}, der Tag hat {DAY_HOURS} h. Überplant.</p></div>}
    {v.inbox > 0 && <div class="banner"><p><b>{v.inbox}</b> unsortiert im Eingang.</p><button class="btn sec" onClick={() => go(INBOX)}>Ansehen</button></div>}
    <Section i={++i} title="Fokus heute" n={`${v.focus.length}/${FOCUS_MAX}`} warn={v.focus.length > FOCUS_MAX}>
      <List items={v.focus} t={t} empty="Noch nichts im Fokus. Unten etwas auswählen oder mit ! erfassen." />
      {v.slot && v.focus.length < FOCUS_MAX && <div class="slot">
        <p class="hint">Wichtig, ohne Termin. Liegt seit {ageDays(v.slot)} Tagen.</p>
        <ul class="tree cards"><Card n={v.slot} t={t} /></ul>
        <button class="btn sec" onClick={() => setStatus(v.slot!.id, "now")}>In den Fokus</button>
      </div>}
    </Section>
    {v.follow.length > 0 && <Section i={++i} title="Nachfassen" n={v.follow.length}>
      <ul class="tree cards">{v.follow.map(n => <Card key={n.id} n={n} t={t} extra={
        <button class="btn sec sm" onClick={() => copy(`Hallo ${n.waitingOn || ""}, kurze Nachfrage zu: ${n.title}. Gibt es einen Stand?`)}>Nachfassen</button>} />)}</ul>
    </Section>}
    {v.overdue.length > 0 && <Section i={++i} title="Überfällig" n={v.overdue.length} warn actions={<>
      <button class="btn sec sm" onClick={() => v.overdue.forEach(n => update(n.id, { due: addDays(day, 1) }))}>Alle auf morgen</button>
      <button class="btn sec sm" onClick={() => v.overdue.forEach(n => update(n.id, { status: "later", due: null }))}>Alle nach Später</button></>}>
      <List items={v.overdue} t={t} />
    </Section>}
    {v.soon.length > 0 && <Section i={++i} title="Heute und morgen fällig" n={v.soon.length}><List items={v.soon} t={t} /></Section>}
    <Section i={++i} title="Diese Woche" n={v.weekCount} warn={v.weekCount > WEEK_MAX}>
      {v.weekCount > WEEK_MAX && <p class="hint w">◇ {v.weekCount} für diese Woche geplant. Realistisch sind etwa {WEEK_MAX}.</p>}
      <List items={v.week} t={t} empty="Nichts weiter für diese Woche." />
    </Section>
    {v.proposed.length > 0 && <Section i={++i} title="Vorschläge von Claude" n={v.proposed.length}><List items={v.proposed} t={t} /></Section>}
    <Section i={++i} title="Erledigt heute" n={v.doneToday.length}><List items={v.doneToday} t={t} empty="Noch nichts abgehakt." /></Section>
    <div class="grp"><button class="btn" onClick={() => setShut(true)}>Feierabend</button></div>
    {shut && <Shutdown t={t} close={() => setShut(false)} />}
  </>;
}

/* ---------- Feierabend: done list → leftovers → tomorrow's top 3 (F10) ---------- */
function Shutdown({ t, close }: { t: Tree; close: () => void }) {
  const day = today(), tomorrow = addDays(day, 1), v = todayView(t);
  const left = v.focus.filter(n => n.status !== "done");
  const cands = [...v.overdue, ...v.soon, ...v.week, ...(v.slot ? [v.slot] : [])].filter(n => !isFocus(n));
  const picked = [...t.byId.values()].filter(n => n.focus === tomorrow && isOpen(n));
  const pick = (n: FNode) => update(n.id, { focus: n.focus === tomorrow ? null : tomorrow });
  return <Sheet title="Feierabend." close={close}>
    <p class="label">01 / Geschafft</p>
    <p>{v.doneToday.length ? v.doneToday.map(n => n.title).join(" · ") : "Heute nichts abgehakt. Auch Denken ist Arbeit."}</p>
    {left.length > 0 && <><p class="label">02 / Was offen blieb</p>
      {left.map(n => <div class="leftover" key={n.id}><span>{n.title}</span>
        <button class="btn sec sm" onClick={() => update(n.id, { status: "next", focus: tomorrow })}>Morgen</button>
        <button class="btn sec sm" onClick={() => update(n.id, { status: "next", focus: null })}>Woche</button>
        <button class="btn sec sm" onClick={() => setStatus(n.id, "later")}>Später</button></div>)}</>}
    <p class="label">03 / Morgen im Fokus ({picked.length}/{FOCUS_MAX})</p>
    <div class="picks">{[...picked, ...cands.filter(c => !picked.includes(c))].slice(0, 12).map(n =>
      <label class="chk" key={n.id}><input type="checkbox" checked={n.focus === tomorrow} disabled={n.focus !== tomorrow && picked.length >= FOCUS_MAX} onChange={() => pick(n)} /> {n.title}</label>)}</div>
  </Sheet>;
}

export function Sheet({ title, close, children }: { title: string; close: () => void; children: ComponentChildren }) {
  return <>
    <div class="scrim" onClick={close} />
    <div class="sheet" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => e.key === "Escape" && close()}>
      <h2>{title}</h2>{children}
      <div class="grp"><button class="btn" onClick={close}>Fertig</button></div>
    </div>
  </>;
}

/* ---------- Board: status columns for all tasks below the zoom root ---------- */
export function BoardView({ t, root }: { t: Tree; root: string | null }) {
  const cutoff = addDays(today(), -14), items: FNode[] = [];
  const walk = (id: string | null) => { for (const n of t.kids(id)) { if (n.archived) continue; if (isActionable(n) && (isOpen(n) || (n.done ?? "") >= cutoff)) items.push(n); walk(n.id); } };
  walk(root);
  const [over, setOver] = useState<Status | null>(null);
  return <div class="board">{STATUSES.map(st => {
    const col = items.filter(n => (n.status ?? "next") === st).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || byRank(a, b));
    const wip = (st === "now" && col.length > FOCUS_MAX) || (st === "next" && col.length > WEEK_MAX);
    return <section class={"col" + (over === st ? " over" : "")} key={st}
      onDragOver={e => { e.preventDefault(); setOver(st); }} onDragLeave={() => setOver(null)}
      onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer?.getData("text/plain"); if (id && t.byId.has(id)) setStatus(id, st); }}>
      <h2 class={"label" + (wip ? " w" : "")}>{STATUS_NAME[st]} <span class="n">{col.length}</span>{wip && " ◇"}</h2>
      <ul class="tree cards">{col.map(n => <Card key={n.id} n={n} t={t} root={root} drag />)}</ul>
    </section>;
  })}</div>;
}

/* ---------- Meetings: series, notes, actions, carry-over, protocol ---------- */
export function MeetingsView({ t, root }: { t: Tree; root: string | null }) {
  const all = [...t.byId.values()];
  const scope = (n: FNode) => !root || t.path(n.id).some(a => a.id === root);
  const meetings = all.filter(n => n.type === "meeting" && scope(n)).sort((a, b) => (b.date || "").localeCompare(a.date || "") || byRank(a, b));
  const [open, setOpen] = useState<string | null>(null);
  const m = open ? t.byId.get(open) : undefined;
  const newMeeting = (prev?: FNode) => {
    const series = prev ? prev.series || prev.title : "";
    const parent = prev?.parent ?? (root && t.byId.get(root)?.type !== "task" ? root : INBOX);
    // continue the numbering of the series ("… #3" → "… #4"); count only if no number exists yet
    const nums = all.filter(x => x.type === "meeting" && (x.series || x.title) === series && series).map(x => +(x.title.match(/#(\d+)\s*$/)?.[1] ?? 0));
    const nr = Math.max(nums.length, ...nums) + 1;
    const id = add(parent, t.kids(parent).at(-1)?.id ?? null, {
      type: "meeting", title: series ? `${series} #${nr}` : "Meeting " + today(), date: today(),
      ...(series ? { series } : {}), ...(prev?.attendees ? { attendees: prev.attendees } : {}),
    });
    setOpen(id);
  };
  if (m) return <MeetingDetail m={m} t={t} back={() => setOpen(null)} follow={() => newMeeting(m)} />;
  return <>
    <div class="grp"><button class="btn" onClick={() => newMeeting()}>Neues Meeting</button></div>
    {meetings.length ? <ul class="tree mlist">{meetings.map(x => {
      const acts = all.filter(a => a.meeting === x.id && isActionable(a));
      return <li key={x.id} class="row mrow"><button class="body" onClick={() => setOpen(x.id)}>
        <span class="mono date">{x.date ?? "—"}</span><span class="title">{x.title || "Ohne Titel"}</span>
        <span class="chips">{acts.filter(isOpen).length} offen von {acts.length}{x.series && x.series !== x.title ? ` · ${x.series}` : ""}</span>
      </button></li>;
    })}</ul> : <p class="empty">Noch keine Meetings{root ? " in diesem Bereich" : ""}.</p>}
  </>;
}

function MeetingDetail({ m, t, back, follow }: { m: FNode; t: Tree; back: () => void; follow: () => void }) {
  const all = [...t.byId.values()];
  const series = m.series || m.title;
  const earlier = all.filter(x => x.type === "meeting" && x.id !== m.id && (x.series || x.title) === series && (x.date || "") <= (m.date || ""));
  const acts = all.filter(a => a.meeting === m.id && isActionable(a)).sort(byRank);
  const carried = all.filter(a => isActionable(a) && isOpen(a) && earlier.some(e => e.id === a.meeting));
  const [q, setQ] = useState("");
  const addAction = (e: Event) => {
    e.preventDefault();
    const id = capture(q, m.parent);
    if (id) { update(id, { meeting: m.id }); setQ(""); }
  };
  const protocol = () => [
    `${m.title}${m.date ? " – " + m.date : ""}`,
    m.attendees ? "Teilnehmer: " + m.attendees : "",
    (m.body || "").trim(),
    acts.length || carried.length ? "Aktionen:" : "",
    ...[...carried, ...acts].map(a => `- [${a.status === "done" ? "x" : " "}] ${a.title}${a.waitingOn ? " (" + a.waitingOn + ")" : ""}${a.due ? " bis " + a.due : ""}`),
  ].filter(Boolean).join("\n");   // filter: no blank lines when notes are empty (v1 nit)
  return <div class="meeting">
    <div class="grp"><button class="btn sec sm" onClick={back}>‹ Alle Meetings</button>
      <button class="btn sec sm" onClick={() => copy(protocol())}>Protokoll kopieren</button>
      <button class="btn sec sm" onClick={follow}>Folgetermin</button>
      <button class="btn sec sm" onClick={() => setUi({ sel: m.id })}>Details</button></div>
    <Title n={m} root={null} tag="h1" class="root" flat />
    <div class="fields">
      <label class="field"><span class="label">Datum</span><input type="date" value={m.date || ""} onChange={e => update(m.id, { date: e.currentTarget.value })} /></label>
      <label class="field"><span class="label">Teilnehmer</span><input type="text" key={"att" + m.id + (m.attendees ?? "")} defaultValue={m.attendees || ""} onChange={e => update(m.id, { attendees: e.currentTarget.value })} /></label>
    </div>
    <label class="field"><span class="label">Notizen · B: Beschluss · I: Info</span>
      <textarea rows={8} value={m.body || ""} onInput={e => update(m.id, { body: e.currentTarget.value })} /></label>
    <form class="qa" onSubmit={addAction}><input value={q} onInput={e => setQ(e.currentTarget.value)} placeholder="Aktion… @wer bis fr" aria-label="Neue Aktion" /></form>
    {carried.length > 0 && <><p class="label">Offen aus früheren Terminen</p><ul class="tree cards">{carried.map(a => <Card key={a.id} n={a} t={t} />)}</ul></>}
    <p class="label">Aktionen aus diesem Termin</p>
    {acts.length ? <ul class="tree cards">{acts.map(a => <Card key={a.id} n={a} t={t} />)}</ul> : <p class="empty">Noch keine.</p>}
  </div>;
}

/* ---------- Wochenrückblick (F2, F3, F16) ---------- */
export function ReviewView({ t }: { t: Tree }) {
  const r = reviewView(t), day = today();
  let i = 0;
  const ok = !r.inbox.length && !r.noNext.length && !r.overdue.length && !r.staleWaiting.length && !r.untouched.length;
  return <>
    {ok && <div class="banner"><p>Alles sortiert. Nichts liegt herum.</p></div>}
    {r.inbox.length > 0 && <Section i={++i} title="Eingang sortieren" n={r.inbox.length}>
      <p class="hint">Per „›“ öffnen und verschieben, oder im Eingang per Tab einsortieren.</p><List items={r.inbox.filter(isActionable)} t={t} /></Section>}
    {r.noNext.length > 0 && <Section i={++i} title="Ohne nächsten Schritt" n={r.noNext.length} warn>
      <ul class="tree plain">{r.noNext.map(n => <li key={n.id} class="row"><span class="body">
        <button class="link" onClick={() => go(n.id)}>{n.title || "Ohne Titel"}</button>
        <span class="chips"><button onClick={() => add(n.id, t.kids(n.id).at(-1)?.id ?? null, { title: "Nächster Schritt…" })}>＋ Schritt</button>
          <button onClick={() => update(n.id, { state: "holding" })}>⏸ pausieren</button></span></span></li>)}</ul></Section>}
    {r.overdue.length > 0 && <Section i={++i} title="Überfällig" n={r.overdue.length} warn><List items={r.overdue} t={t} /></Section>}
    {r.staleWaiting.length > 0 && <Section i={++i} title="Wartet zu lange" n={r.staleWaiting.length}><List items={r.staleWaiting} t={t} /></Section>}
    {r.untouched.length > 0 && <Section i={++i} title="Lange nicht angefasst" n={r.untouched.length}>
      <ul class="tree cards">{r.untouched.map(n => <Card key={n.id} n={n} t={t} extra={<>
        <span class="chips">{ageDays(n, day)} T{ageDays(n, day) >= r.decayDays ? " · Später?" : ""}</span>
        <button class="btn sec sm" onClick={() => setStatus(n.id, "later")}>Später</button>
        <button class="btn sec sm" onClick={() => update(n.id, {})}>Bleibt</button></>} />)}</ul></Section>}
    {r.unreviewed.length > 0 && <Section i={++i} title="Projekte prüfen" n={r.unreviewed.length}>
      <ul class="tree plain">{r.unreviewed.map(n => { const ro = t.rollup(n.id); return <li key={n.id} class="row"><span class="body">
        <button class="link" onClick={() => go(n.id)}>{n.title}</button>
        <span class="chips">{ro.open} offen{ro.overdue ? ` · ⚠ ${ro.overdue} überfällig` : ""}
          <button onClick={() => update(n.id, { reviewed: day })}>✓ geprüft</button></span></span></li>; })}</ul></Section>}
    {r.holding.length > 0 && <Section i={++i} title="Pausiert" n={r.holding.length}>
      <ul class="tree plain">{r.holding.map(n => <li key={n.id} class="row"><span class="body">
        <button class="link" onClick={() => go(n.id)}>{n.title}</button>
        <span class="chips"><button onClick={() => update(n.id, { state: "active" })}>▶ wieder aktiv</button></span></span></li>)}</ul></Section>}
    <Section i={++i} title="Erledigt diese Woche" n={r.doneWeek.length}><List items={r.doneWeek} t={t} empty="Noch nichts." /></Section>
  </>;
}
