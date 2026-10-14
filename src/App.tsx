import { useEffect, useState } from "preact/hooks";
import { S, loadVault, replaceAll, setUi, signOut, sync, unlock, useStore } from "./store.ts";
import { FocusList, Outline, RowMenu, Title, go } from "./Outline.tsx";
import { metaLine } from "./fmt.ts";
import { normalize, serialize } from "./merge.ts";
import { today } from "./model.ts";

const ACTIVE_CAP = 5;   // F4, HANDOVER §10

function parseHash() {
  const m = location.hash.match(/^#\/(?:n\/([\w-]+))?(\?f)?/);
  return { id: m?.[1] ?? null, focus: !!m?.[2] };
}
const editing = () => (document.activeElement as HTMLElement | null)?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");

export function App() {
  const t = useStore();
  const [route, setRoute] = useState(parseHash);
  const [sheet, setSheet] = useState(false);
  useEffect(() => { const f = () => setRoute(parseHash()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  useEffect(() => { loadVault(); }, []);

  const root = route.id && t.byId.has(route.id) ? route.id : null;
  const rootNode = root ? t.byId.get(root)! : null;
  const path = t.path(root);
  const up = () => go(rootNode?.parent ?? null, route.focus);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); setUi({ depth: +e.code.slice(5) }); return; }
      if (sheet || editing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" && root) { e.preventDefault(); up(); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); go(root, !route.focus); }
      else if (e.key === "i" && !root) { /* inspector: M2 */ }
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

  return <>
    <header class="top">
      <nav class="crumbs" aria-label="Pfad" ref={el => { if (el) el.scrollLeft = el.scrollWidth; }}>
        <a href={route.focus ? "#/?f" : "#/"}>Alle</a>
        {path.map(p => <><span class="sep" aria-hidden="true">›</span><a href={`#/n/${p.id}${route.focus ? "?f" : ""}`}>{p.title || "Ohne Titel"}</a></>)}
      </nav>
      <span class="sync" data-s={S.sync} title={S.err || (S.lastSync ? "Letzter Sync " + new Date(S.lastSync).toLocaleString("de-AT") : "")}>
        <i aria-hidden="true" /><span>{S.dirty && S.sync !== "syncing" ? syncLabel + " ·" : syncLabel}</span>
      </span>
      <div class="seg" role="group" aria-label="Detailtiefe">
        {[1, 2, 3, 4].map(d => <button aria-pressed={S.depth === d} title={`Detailtiefe ${d} (Alt+${d})`} onClick={() => setUi({ depth: d })}>{d}</button>)}
      </div>
      <button class="iconbtn" aria-pressed={route.focus} title="Fokusmodus (F)" aria-label="Fokusmodus" onClick={() => go(root, !route.focus)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
      </button>
      <button class="iconbtn" title="Einstellungen" aria-label="Einstellungen" onClick={() => setSheet(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
      </button>
    </header>

    <main key={root ?? "all"} class="zoom">
      {S.sync === "locked" && <Unlock />}
      {S.sync === "error" && <div class="banner" role="alert"><p class="err">Sync: {S.err}</p><button class="btn sec" onClick={() => sync()}>Erneut</button></div>}
      <p class="label">{route.focus ? "Fokus" : "Gliederung"} / {rootNode ? typeName[rootNode.type] : "Alle Bereiche"}</p>
      {rootNode ? <Title n={rootNode} root={root} tag="h1" class="root" /> : <h1 class="root">Alle</h1>}
      <p class="meta">
        {metaLine(r)}
        {!root && t.activeProjects > ACTIVE_CAP && <> <span class="w">◇ {t.activeProjects} aktive Projekte, mehr als {ACTIVE_CAP}. Eins pausieren?</span></>}
        {rootNode && r.noNext && <> <span class="w">◇ Kein nächster Schritt.</span></>}
      </p>
      <div class="bar" aria-label={`${r.pct} % erledigt`}><i style={{ width: r.pct + "%" }} /></div>
      {route.focus ? <FocusList t={t} root={root} /> : <Outline t={t} root={root} />}
    </main>
    <RowMenu />
    {sheet && <Settings close={() => setSheet(false)} />}
  </>;
}

const typeName: Record<string, string> = { area: "Bereich", project: "Projekt", package: "Arbeitspaket", task: "Aufgabe", note: "Notiz", meeting: "Meeting", system: "Eingang" };

function Unlock() {
  const [pass, setPass] = useState(""), [remember, setRemember] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr("");
    if (!(await unlock(pass, remember))) setErr("Passphrase stimmt nicht.");
    setBusy(false); setPass("");
  };
  return <form class="banner" onSubmit={submit}>
    <label class="field"><span class="label">Entsperren</span>
      <input type="password" value={pass} onInput={e => setPass(e.currentTarget.value)} autocomplete="current-password" placeholder="Fokus-Passphrase" autoFocus /></label>
    <label class="chk"><input type="checkbox" checked={remember} onChange={e => setRemember(e.currentTarget.checked)} /> Auf diesem Gerät merken</label>
    <button class="btn" disabled={busy || !pass}>{busy ? "Prüfe…" : "Entsperren"}</button>
    {err && <p class="err" role="alert">{err}</p>}
  </form>;
}

function Settings({ close }: { close: () => void }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "");
  const pickTheme = (v: string) => { setTheme(v); v ? document.documentElement.dataset.theme = v : delete document.documentElement.dataset.theme; try { v ? localStorage.setItem("fk2_theme", v) : localStorage.removeItem("fk2_theme"); } catch { /* ignore */ } };
  const exportJson = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([serialize(S.file)], { type: "application/json" }));
    a.download = `fokus-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = (f?: File) => f && f.text().then(txt => {
    let d; try { d = JSON.parse(txt); } catch { alert("Keine gültige JSON-Datei."); return; }
    if (confirm("Import ersetzt die Daten auf diesem Gerät (der nächste Sync führt sie mit GitHub zusammen). Fortfahren?")) { replaceAll(normalize(d)); close(); }
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
