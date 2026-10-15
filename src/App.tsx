import { useEffect, useState } from "preact/hooks";
import { S, exportText, importText, loadVault, setUi, signOut, sync, unlock, useStore } from "./store.ts";
import { FocusList, Outline, RowMenu, Title, go, href, nav, parseHash, type Route, type View } from "./Outline.tsx";
import { metaLine } from "./fmt.ts";
import { INBOX, today } from "./model.ts";
import { Inspector } from "./Inspector.tsx";
import { Palette } from "./Palette.tsx";
import { BoardView, MeetingsView, ReviewView, Toast, TodayView } from "./views.tsx";
import type { Tree } from "./tree.ts";

const ACTIVE_CAP = 5;   // F4, HANDOVER §10
const VIEWS: [View, string, string][] = [
  ["outline", "Gliederung", "M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01"],
  ["today", "Heute", "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],
  ["board", "Board", "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z"],
  ["meetings", "Meetings", "M4 5h16v11H9l-5 4z"],
  ["review", "Rückblick", "M4 12a8 8 0 1 0 3-6.2M4 4v4h4"],
];
const KEYS: Record<string, View> = { o: "outline", h: "today", b: "board", m: "meetings", r: "review" };
const editing = () => (document.activeElement as HTMLElement | null)?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
const Icon = ({ d }: { d: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>;

export function App() {
  const t = useStore();
  const [route, setRoute] = useState<Route>(parseHash);
  const [sheet, setSheet] = useState(false);
  useEffect(() => { const f = () => setRoute(parseHash()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  useEffect(() => { loadVault(); }, []);

  const scoped = route.v !== "today" && route.v !== "review";
  const root = scoped && route.id && t.byId.has(route.id) ? route.id : null;
  const rootNode = root ? t.byId.get(root)! : null;
  const sel = S.sel ? t.byId.get(S.sel) : undefined;
  const up = () => go(rootNode?.parent ?? null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); setUi({ depth: +e.code.slice(5) }); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setUi({ palette: S.palette ? null : "search" }); return; }
      if (sheet || S.palette || editing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") { e.preventDefault(); if (S.sel) setUi({ sel: null }); else if (root) up(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); setUi({ palette: "new" }); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); nav({ f: !route.f, v: "outline" }); }
      else if (e.key === "i" || e.key === "I") { e.preventDefault(); setUi({ sel: S.sel ? null : root }); }
      else if (KEYS[e.key]) { e.preventDefault(); nav({ v: KEYS[e.key], f: false }); }
    };
    // swipe from the left edge = one level up (iOS standalone has no back button)
    let x0 = -1, y0 = 0;
    const ts = (e: TouchEvent) => { const p = e.touches[0]; x0 = p.clientX < 24 ? p.clientX : -1; y0 = p.clientY; };
    const te = (e: TouchEvent) => { const p = e.changedTouches[0]; if (x0 >= 0 && p.clientX - x0 > 70 && Math.abs(p.clientY - y0) < 50 && root) up(); x0 = -1; };
    addEventListener("keydown", key); addEventListener("touchstart", ts, { passive: true }); addEventListener("touchend", te);
    return () => { removeEventListener("keydown", key); removeEventListener("touchstart", ts); removeEventListener("touchend", te); };
  });

  const r = t.rollup(root);
  const syncLabel = { off: "lokal", locked: "gesperrt", idle: "synchron", syncing: "sync…", error: "Fehler", offline: "offline" }[S.sync];
  const viewName = VIEWS.find(v => v[0] === route.v)![1];

  return <div class={"shell" + (sel ? " has-insp" : "")}>
    <Sidebar t={t} active={root} />
    <div class="center">
      <header class="top">
        <nav class="crumbs" aria-label="Pfad" ref={el => { if (el) el.scrollLeft = el.scrollWidth; }}>
          {scoped ? <>
            <a href={href({ ...route, id: null })}>Alle</a>
            {t.path(root).map(p => <><span class="sep" aria-hidden="true">›</span><a href={href({ ...route, id: p.id })}>{p.title || "Ohne Titel"}</a></>)}
          </> : <span>{viewName}</span>}
        </nav>
        <span class="sync" data-s={S.sync} title={S.err || (S.lastSync ? "Letzter Sync " + new Date(S.lastSync).toLocaleString("de-AT") : "")}>
          <i aria-hidden="true" /><span>{S.dirty && S.sync !== "syncing" ? syncLabel + " ·" : syncLabel}</span>
        </span>
        <div class="seg views" role="tablist" aria-label="Ansicht">
          {VIEWS.map(([v, l]) => <button role="tab" aria-selected={route.v === v} aria-pressed={route.v === v} onClick={() => nav({ v, f: false })}>{l}</button>)}
        </div>
        {route.v === "outline" && <div class="seg" role="group" aria-label="Detailtiefe">
          {[1, 2, 3, 4].map(d => <button aria-pressed={S.depth === d} title={`Detailtiefe ${d} (Alt+${d})`} onClick={() => setUi({ depth: d })}>{d}</button>)}
        </div>}
        <button class="iconbtn" title="Suchen (Strg+K)" aria-label="Suchen" onClick={() => setUi({ palette: "search" })}><Icon d="M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4" /></button>
        <button class="iconbtn" title="Einstellungen" aria-label="Einstellungen" onClick={() => setSheet(true)}><Icon d="M4 7h10M18 7h2M4 17h4M12 17h8M16 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0" /></button>
      </header>

      <main key={route.v + (root ?? "all") + route.f} class="zoom">
        {S.sync === "locked" && <Unlock />}
        {S.sync === "error" && <div class="banner" role="alert"><p class="err">Sync: {S.err}</p><button class="btn sec" onClick={() => sync()}>Erneut</button></div>}
        {scoped ? <>
          <p class="label">{route.f ? "Fokus" : viewName} / {rootNode ? typeName[rootNode.type] : "Alle Bereiche"}</p>
          {rootNode ? <Title n={rootNode} root={root} tag="h1" class="root" /> : <h1 class="root">Alle</h1>}
          <p class="meta">
            {metaLine(r)}
            {!root && t.activeProjects > ACTIVE_CAP && <> <span class="w">◇ {t.activeProjects} aktive Projekte, mehr als {ACTIVE_CAP}. Eins pausieren?</span></>}
            {rootNode && r.noNext && <> <span class="w">◇ Kein nächster Schritt.</span></>}
          </p>
          {rootNode?.resume && <p class="resume">↳ Weitermachen bei: {rootNode.resume}</p>}
          <div class="bar" aria-label={`${r.pct} % erledigt`}><i style={{ width: r.pct + "%" }} /></div>
          {route.v === "board" ? <BoardView t={t} root={root} /> : route.v === "meetings" ? <MeetingsView t={t} root={root} />
            : <>
              {route.v === "outline" && <div class="grp"><button class="btn sec sm" aria-pressed={route.f} onClick={() => nav({ f: !route.f })}>{route.f ? "Alles zeigen" : "Fokusmodus (F)"}</button></div>}
              {route.f ? <FocusList t={t} root={root} /> : <Outline t={t} root={root} />}
            </>}
        </> : <>
          <p class="label">{viewName} / {new Date().toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 class="root">{route.v === "today" ? "Heute." : "Wochenrückblick."}</h1>
          <p class="meta">{metaLine(t.rollup(null))}</p>
          <div class="bar" />
          {route.v === "today" ? <TodayView t={t} /> : <ReviewView t={t} />}
        </>}
      </main>
    </div>
    {sel && <Inspector n={sel} t={t} />}
    {sel && <div class="scrim insp-scrim" onClick={() => setUi({ sel: null })} />}

    <nav class="tabs" aria-label="Ansicht">
      {VIEWS.map(([v, l, d]) => <a href={href({ ...route, v, f: false })} aria-current={route.v === v ? "page" : undefined}><Icon d={d} /><span>{l}</span></a>)}
    </nav>
    <button class="fab" aria-label="Neu erfassen" onClick={() => setUi({ palette: "new" })}><Icon d="M12 5v14M5 12h14" /></button>

    <RowMenu />
    {S.palette && <Palette t={t} root={root} />}
    {sheet && <Settings close={() => setSheet(false)} />}
    <Toast />
  </div>;
}

function Sidebar({ t, active }: { t: Tree; active: string | null }) {
  const line = (id: string, title: string, lvl: number) => {
    const r = t.rollup(id);
    return <a key={id} class="sitem" style={{ "--lvl": lvl } as any} aria-current={active === id ? "true" : undefined} href={href({ ...parseHash(), id, v: parseHash().v === "today" || parseHash().v === "review" ? "outline" : parseHash().v })}>
      <span class="st">{title || "Ohne Titel"}</span>
      <span class="sn mono">{r.overdue ? <span class="od">⚠{r.overdue} </span> : null}{r.open || ""}</span>
    </a>;
  };
  return <aside class="sidebar" aria-label="Bereiche und Projekte">
    <p class="label">Fokus</p>
    {line(INBOX, "Eingang", 0)}
    {t.kids(null).filter(n => n.id !== INBOX && !n.archived).map(a => <>
      {line(a.id, a.title, 0)}
      {t.kids(a.id).filter(p => (p.type === "project" || p.type === "area") && !p.archived).map(p => line(p.id, p.title, 1))}
    </>)}
  </aside>;
}

const typeName: Record<string, string> = { area: "Bereich", project: "Projekt", package: "Arbeitspaket", task: "Aufgabe", note: "Notiz", meeting: "Meeting", system: "Eingang" };

function Unlock() {
  const [pass, setPass] = useState(""), [remember, setRemember] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [show, setShow] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      // keep the input on failure, so it can be revealed and compared; the length hints at a typo without showing it
      if (await unlock(pass, remember)) setPass("");
      else setErr(`Passphrase stimmt nicht (${pass.trim().length} Zeichen eingegeben). Groß-/Kleinschreibung, Ziffern und Bindestriche prüfen, oder aus dem Passwort-Manager einfügen.`);
    } catch (x: any) { setErr("Entsperren fehlgeschlagen: " + (x?.message || x)); }
    setBusy(false);
  };
  return <form class="banner" onSubmit={submit}>
    <label class="field"><span class="label">Entsperren</span>
      <input type={show ? "text" : "password"} value={pass} onInput={e => setPass(e.currentTarget.value)} autocomplete="current-password" placeholder="Fokus-Passphrase" autoFocus
        autocapitalize="off" autocorrect="off" spellcheck={false} /></label>
    <button type="button" class="btn sec sm" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Verbergen" : "Anzeigen"}</button>
    <label class="chk"><input type="checkbox" checked={remember} onChange={e => setRemember(e.currentTarget.checked)} /> Auf diesem Gerät merken</label>
    <button class="btn" disabled={busy || !pass}>{busy ? "Prüfe…" : "Entsperren"}</button>
    {err && <p class="err" role="alert">{err}</p>}
  </form>;
}

function Settings({ close }: { close: () => void }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "");
  const pickTheme = (v: string) => { setTheme(v); v ? document.documentElement.dataset.theme = v : delete document.documentElement.dataset.theme; try { v ? localStorage.setItem("fk2_theme", v) : localStorage.removeItem("fk2_theme"); } catch { /* ignore */ } };
  const exportJson = async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([await exportText()], { type: "application/json" }));
    a.download = `fokus-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = (f?: File) => f && f.text().then(async txt => {
    if (!confirm("Import ersetzt die Daten auf diesem Gerät (der nächste Sync führt sie mit GitHub zusammen). Fortfahren?")) return;
    try { await importText(txt); close(); } catch { alert("Datei nicht lesbar: kein gültiges JSON oder mit anderer Passphrase verschlüsselt."); }
  });
  const reloadApp = async () => { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); location.reload(); };
  const out = () => {
    if (S.dirty && !confirm("Es gibt noch nicht synchronisierte Änderungen. Trotzdem abmelden und lokal löschen?")) return;
    if (confirm("Passphrase und lokale Daten auf diesem Gerät löschen?")) signOut();
  };
  return <>
    <div class="scrim" onClick={close} />
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Einstellungen" onKeyDown={e => e.key === "Escape" && close()}>
      <h2>Einstellungen.</h2>
      <p class="label">01 / Sync</p>
      <p>{S.vault ? (S.token ? "Verbunden mit dem privaten Daten-Repo." : "Gesperrt. Passphrase nötig.") : "Kein Tresor (vault.json) gefunden. Daten bleiben nur auf diesem Gerät."}
        {S.lastSync && <> Letzter Sync: {new Date(S.lastSync).toLocaleString("de-AT")}.</>} {S.err}</p>
      <p class="label">02 / Darstellung</p>
      <div class="grp seg" role="group" aria-label="Farbschema">
        {[["", "System"], ["light", "Hell"], ["dark", "Dunkel"]].map(([v, l]) => <button aria-pressed={theme === v} onClick={() => pickTheme(v)}>{l}</button>)}
      </div>
      <p class="label">03 / Daten</p>
      <div class="grp">
        <button class="btn sec" onClick={exportJson}>Export JSON</button>
        <label class="btn sec">Import JSON<input type="file" accept="application/json,.json" class="sr" onChange={e => importJson(e.currentTarget.files?.[0])} /></label>
        <button class="btn sec" onClick={reloadApp}>App aktualisieren</button>
      </div>
      <div class="grp"><button class="btn danger" onClick={out}>Gerät abmelden</button></div>
      <p class="mono" style={{ fontSize: "12px", color: "var(--text-3)" }}>Fokus v{__APP_VERSION__} · {S.file.nodes.length} Einträge</p>
      <div class="grp"><button class="btn" onClick={close}>Fertig</button></div>
    </div>
  </>;
}
