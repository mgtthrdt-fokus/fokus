import { useEffect, useState } from "preact/hooks";
import { INBOX, emptyFile, now, today, uid, type FNode, type FileV2, type NodeType, type Status } from "./model.ts";
import { merge, normalize, serialize } from "./merge.ts";
import { rankBetween } from "./rank.ts";
import { buildTree, type Tree } from "./tree.ts";
import { findProject, nextDate, parseQuick } from "./parse.ts";
import { decryptData, deriveKey, encryptData, openVault, type Vault } from "./vault.ts";

export const REPO = { owner: "mgtthrdt", repo: "fokus-data", path: "data.json", branch: "main" };

/* ---------- local persistence (keys fk2_*, v1 used fk_*) ---------- */
const LS = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota or private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function initialFile(): FileV2 {
  const v2 = LS.get<any>("fk2_data", null);
  if (v2) return normalize(v2);
  const v1 = LS.get<any>("fk_data", null);   // a device that used v1 locally keeps its data
  return v1 ? normalize(v1) : emptyFile();
}
// v1 kept its GitHub token in plaintext (fk_cfg) on the shared origin: never leave it behind
const V1_KEYS = ["fk_data", "fk_cfg", "fk_sha", "fk_dirty", "fk_last", "fk_view", "fk_filter"];
function dropV1() { if (LS.get("fk2_data", null)) V1_KEYS.forEach(LS.del); }   // only once v2 holds the data

export type SyncState = "off" | "locked" | "idle" | "syncing" | "error" | "offline";
export const S = {
  file: initialFile(),
  sha: LS.get<string | null>("fk2_sha", null),
  dirty: LS.get("fk2_dirty", false),
  lastSync: LS.get<string | null>("fk2_last", null),
  sync: "off" as SyncState,
  err: "",
  token: null as string | null,
  dataKey: null as CryptoKey | null,   // E2E: data.json on GitHub is only ever written encrypted
  vault: null as Vault | null,
  collapsed: new Set<string>(LS.get<string[]>("fk2_collapsed", [])),  // per device, not synced
  depth: LS.get("fk2_depth", 2),
  sel: null as string | null,                                  // node shown in the inspector
  palette: null as null | "search" | "new" | "move",
};
let tree: Tree = buildTree(S.file.nodes);
export const getTree = () => tree;

const subs = new Set<() => void>();
function emit() { subs.forEach(f => f()); }
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(x => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return tree;
}

function saveLocal() { LS.set("fk2_data", S.file); LS.set("fk2_dirty", S.dirty); LS.set("fk2_sha", S.sha); dropV1(); }
saveLocal();   // first v2 start: persist migrated v1 data, then drop the v1 keys
/* ---------- undo: per user action, only the nodes it changed (never other devices' edits) ---------- */
type Snap = Map<string, FNode | null>;   // id → node before the action; null = did not exist
const undoStack: Snap[] = [];
let group: Snap | null = null, restoring = false;
function record(prev: FNode[], next: FNode[]) {
  const before = new Map(prev.map(n => [n.id, n])), after = new Map(next.map(n => [n.id, n]));
  const snap: Snap = group ?? new Map();
  for (const [id, n] of before) if (after.get(id) !== n && !snap.has(id)) snap.set(id, n);   // nodes are replaced, never mutated
  for (const id of after.keys()) if (!before.has(id) && !snap.has(id)) snap.set(id, null);
  if (!group && snap.size) { undoStack.push(snap); if (undoStack.length > 50) undoStack.shift(); }
}
/** Several commits that the user sees as one action (done + next repeat, bulk moves) undo together. */
export function batch(f: () => void) {
  if (group) return f();
  group = new Map();
  try { f(); } finally { const g = group; group = null; if (g.size) undoStack.push(g); }
}
export const canUndo = () => undoStack.length > 0;
export function undo(): boolean {
  const snap = undoStack.pop(); if (!snap) return false;
  const t = now(), deleted = { ...S.file.deleted };
  // restored versions get a fresh `updated`, so they also win the merge against copies already synced
  const back = [...snap.values()].filter((n): n is FNode => !!n).map(n => ({ ...n, updated: t }));
  const ids = new Set(snap.keys());
  for (const [id, n] of snap) if (n === null) deleted[id] = t;
  for (const n of back) delete deleted[n.id];
  restoring = true;
  try { commit([...S.file.nodes.filter(n => !ids.has(n.id)), ...back], deleted); } finally { restoring = false; }
  return true;
}

function commit(nodes: FNode[], deleted = S.file.deleted) {
  if (!restoring) record(S.file.nodes, nodes);
  S.file = { schema: 2, nodes, deleted };
  tree = buildTree(nodes);
  S.dirty = true; saveLocal(); emit(); scheduleSync();
}
export function setUi(p: { depth?: number; toggle?: string; sel?: string | null; palette?: typeof S.palette }) {
  if (p.sel !== undefined) S.sel = p.sel;
  if (p.palette !== undefined) S.palette = p.palette;
  if (p.depth) { S.depth = p.depth; LS.set("fk2_depth", p.depth); }
  if (p.toggle) { S.collapsed.has(p.toggle) ? S.collapsed.delete(p.toggle) : S.collapsed.add(p.toggle); LS.set("fk2_collapsed", [...S.collapsed]); }
  emit();
}

/* ---------- edits ---------- */
const stamp = (n: FNode): FNode => { const t = now(); return { ...n, updated: t, touched: t }; };
const replace = (id: string, f: (n: FNode) => FNode) => commit(S.file.nodes.map(n => n.id === id ? stamp(f(n)) : n));

export const update = (id: string, patch: Partial<FNode>) => replace(id, n => ({ ...n, ...patch }));

export const childType: Record<NodeType, NodeType> = { area: "project", project: "task", package: "task", task: "task", note: "note", meeting: "task", system: "task" };

/** New last child of `parent` (null = top level: a Bereich), opened if it was collapsed. */
export function addChild(parent: string | null): string {
  if (parent && S.collapsed.has(parent)) setUi({ toggle: parent });
  return add(parent, tree.kids(parent).at(-1)?.id ?? null, { type: parent ? childType[tree.byId.get(parent)!.type] : "area" });
}

/** New node directly after `after` (or first child of `parent` when after is null). */
export function add(parent: string | null, after: string | null, p: Partial<FNode> = {}): string {
  const sibs = tree.kids(parent);
  const i = after ? sibs.findIndex(s => s.id === after) : -1;
  const ref = after ? tree.byId.get(after) : undefined;
  const parentNode = parent ? tree.byId.get(parent) : undefined;
  // a sibling copies its neighbour's type, except after a meeting or Eingang (then the parent's default)
  const type: NodeType = p.type ?? (ref && ref.type !== "system" && ref.type !== "meeting" ? ref.type : parentNode ? childType[parentNode.type] : "area");
  const t = now();
  const n: FNode = {
    id: uid(type === "task" ? "t" : type[0]), type, parent, rank: rankBetween(sibs[i]?.rank, sibs[i + 1]?.rank),
    title: "", created: t, updated: t, touched: t,
    ...(type === "task" ? { status: "next" as const } : {}), ...p,
  };
  commit([...S.file.nodes, n]);
  return n.id;
}

function placeAt(id: string, parent: string | null, index: number) {
  const sibs = tree.kids(parent).filter(s => s.id !== id);
  const rank = rankBetween(sibs[index - 1]?.rank, sibs[index]?.rank);
  replace(id, n => ({ ...n, parent, rank }));
}
const isFixed = (id: string) => id === INBOX;

export function indent(id: string) {
  const n = tree.byId.get(id); if (!n || isFixed(id)) return;
  const sibs = tree.kids(n.parent), i = sibs.findIndex(s => s.id === id);
  if (i <= 0) return;
  const newParent = sibs[i - 1];
  if (S.collapsed.has(newParent.id)) setUi({ toggle: newParent.id });
  placeAt(id, newParent.id, tree.kids(newParent.id).length);
}
export function outdent(id: string, root: string | null) {
  const n = tree.byId.get(id); if (!n || !n.parent || n.parent === root || isFixed(id)) return;
  const parent = tree.byId.get(n.parent)!;
  const sibs = tree.kids(parent.parent);
  placeAt(id, parent.parent, sibs.findIndex(s => s.id === parent.id) + 1);
}
export function moveBy(id: string, dir: -1 | 1) {
  const n = tree.byId.get(id); if (!n || isFixed(id)) return;
  const sibs = tree.kids(n.parent), i = sibs.findIndex(s => s.id === id), j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  placeAt(id, n.parent, j);  // without n in the list, index j lands right before (up) / after (down) the neighbour
}
export function toggleDone(id: string) {
  const n = tree.byId.get(id); if (!n) return;
  setStatus(id, n.status === "done" ? (n.prev && n.prev !== "done" ? n.prev : "next") : "done");
}
/** Done on a recurring task: the done one keeps its history, a copy carries on with the next date. */
function repeatNext(n: FNode) {
  let due = nextDate(n.due ?? today(), n.repeat!);
  while (due <= today()) due = nextDate(due, n.repeat!);   // done late: skip the missed dates, don't create an overdue copy
  const { id: _i, created: _c, updated: _u, touched: _t, done: _d, prev: _p, act: _a, focus: _f, plan: _pl, ...keep } = n;
  add(n.parent, n.id, { ...keep, status: n.prev && n.prev !== "done" && n.prev !== "now" ? n.prev : "next", due });
}
/** Quick-add. Target: >>paket under #projekt, else #projekt, else `fallback` (zoom root), else Eingang. */
export function capture(text: string, fallback: string | null): string | null {
  const p = parseQuick(text);
  if (!p.title) return null;
  const nodes = S.file.nodes;
  let parent: string = fallback && tree.byId.has(fallback) ? fallback : INBOX;
  if (p.project) {
    // unknown #tag creates the project in Eingang, as v1 did, so nothing typed is lost
    parent = findProject(nodes, p.project)?.id ?? add(INBOX, tree.kids(INBOX).at(-1)?.id ?? null, { type: "project", title: p.project, short: p.project.toLowerCase() });
  }
  if (p.pkg) {
    const q = p.pkg.toLowerCase();
    parent = tree.kids(parent).find(n => n.type === "package" && n.title.toLowerCase() === q)?.id
      ?? add(parent, tree.kids(parent).at(-1)?.id ?? null, { type: "package", title: p.pkg });
  }
  const fields: Partial<FNode> = p.note ? { type: "note" } : {
    type: "task", status: p.status ?? (parent === INBOX ? "inbox" : "next"),
    ...(p.due ? { due: p.due } : {}), ...(p.start ? { start: p.start } : {}), ...(p.waitingOn ? { waitingOn: p.waitingOn } : {}),
    ...(p.repeat ? { repeat: p.repeat, due: p.due ?? today() } : {}),
  };
  return add(parent, tree.kids(parent).at(-1)?.id ?? null, { title: p.title, ...fields });
}
/** Move to the end of `parent`'s children; refuses to move a node into its own subtree. */
export function moveTo(id: string, parent: string | null) {
  if (isFixed(id) || id === parent || (parent && tree.path(parent).some(a => a.id === id))) return;
  placeAt(id, parent, tree.kids(parent).filter(s => s.id !== id).length);
}
export function setStatus(id: string, s: Status) {
  const n = tree.byId.get(id); if (!n) return;
  batch(() => {
    if (s === "done") {
      if (n.status === "done") return;
      replace(id, x => ({ ...x, prev: x.status ?? "next", status: "done", done: today(), repeat: undefined }));
      if (n.repeat) repeatNext({ ...n, prev: n.status });
    } else replace(id, x => ({ ...x, status: s, done: null }));
  });
}
/** Drag & drop in the outline: before / after a row, or as its last child. */
export function moveRel(id: string, target: string, where: "before" | "after" | "inside") {
  const t = tree.byId.get(target);
  if (!t || isFixed(id) || id === target || tree.path(target).some(a => a.id === id)) return;
  if (where === "inside") return moveTo(id, target);
  const sibs = tree.kids(t.parent).filter(s => s.id !== id);
  placeAt(id, t.parent, sibs.findIndex(s => s.id === target) + (where === "after" ? 1 : 0));
}
/** Removes the node and its whole subtree, with tombstones so the deletion syncs. */
export function remove(id: string) {
  if (isFixed(id)) return;
  const gone = new Set<string>();
  const walk = (x: string) => { gone.add(x); tree.kids(x).forEach(c => walk(c.id)); };
  walk(id);
  const t = now(), deleted = { ...S.file.deleted };
  gone.forEach(g => deleted[g] = t);
  commit(S.file.nodes.filter(n => !gone.has(n.id)), deleted);
}
export function replaceAll(f: FileV2) { commit(normalize(f).nodes, f.deleted); }

/* ---------- GitHub sync (v1 algorithm on schema 2) ---------- */
const b64enc = (s: string) => { const b = new TextEncoder().encode(s); let r = ""; for (let i = 0; i < b.length; i += 0x8000) r += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(r); };
const b64dec = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
const api = (path: string) => `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`;
const hdr = (): Record<string, string> => ({ Authorization: "Bearer " + S.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

async function ghGet(path: string): Promise<{ text: string; sha: string } | null> {
  const r = await fetch(api(path) + "?ref=" + REPO.branch + "&t=" + Date.now(), { headers: hdr(), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GET " + r.status);
  const j = await r.json();
  if (j.content && j.encoding === "base64") return { text: b64dec(j.content), sha: j.sha };
  const r2 = await fetch(api(path) + "?ref=" + REPO.branch, { headers: { ...hdr(), Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
  if (!r2.ok) throw new Error("RAW " + r2.status);
  return { text: await r2.text(), sha: j.sha };   // > 1 MB: contents API omits the body
}
async function ghPut(path: string, text: string, sha: string | null, msg: string): Promise<{ sha?: string; conflict?: true }> {
  const body: Record<string, string> = { message: msg, content: b64enc(text), branch: REPO.branch };
  if (sha) body.sha = sha;
  const r = await fetch(api(path), { method: "PUT", headers: { ...hdr(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error("PUT " + r.status);
  return { sha: (await r.json()).content.sha };
}

async function readData(text: string): Promise<any> {
  const raw = JSON.parse(text);
  if (!raw?.enc) return raw;
  if (!S.dataKey) throw new Error("verschlüsselt, Schlüssel fehlt");
  return JSON.parse(await decryptData(raw.enc, S.dataKey));
}
async function writeData(f: FileV2): Promise<string> {
  const plain = serialize(f);
  if (!S.dataKey || !S.vault) throw new Error("kein Datenschlüssel");   // never write plaintext
  return JSON.stringify({ schema: 2, enc: await encryptData(plain, S.dataKey, S.vault.dataSalt, S.vault.iter) }, null, 1) + "\n";
}

/** Export stays encrypted once a data key exists (HANDOVER §11); import accepts both forms. */
export const exportText = () => S.dataKey ? writeData(S.file) : Promise.resolve(serialize(S.file));
export async function importText(text: string) { replaceAll(normalize(await readData(text))); }

let syncing = false, again = false, timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(ms = 1500) { clearTimeout(timer); timer = setTimeout(sync, ms); }

export async function sync() {
  if (!S.token) return;
  if (!navigator.onLine) { S.sync = "offline"; emit(); return; }
  if (syncing) { again = true; return; }
  syncing = true; S.sync = "syncing"; S.err = ""; emit();
  try {
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const before = serialize(S.file);
      const remote = await ghGet(REPO.path);
      const encrypted = remote ? !!JSON.parse(remote.text)?.enc : false;
      const raw = remote ? await readData(remote.text) : null;
      const rdata = raw ? normalize(raw) : null;
      const merged = rdata ? merge(S.file, rdata) : S.file;
      let sha = remote?.sha ?? null;
      if (!remote || raw.schema !== 2 || !encrypted || serialize(merged) !== serialize(rdata!)) {
        const res = await ghPut(REPO.path, await writeData(merged), sha, "Fokus: Update " + new Date().toLocaleString("de-AT"));
        if (res.conflict) continue;
        sha = res.sha!;
      }
      S.sha = sha;
      // edits made while the request was in flight must survive
      if (serialize(S.file) !== before) { S.file = merge(S.file, merged); S.dirty = true; again = true; }
      else { S.file = merged; S.dirty = false; }
      tree = buildTree(S.file.nodes);
      ok = true;
    }
    if (!ok) throw new Error("Konflikt (409)");
    S.lastSync = now(); LS.set("fk2_last", S.lastSync); S.sync = "idle";
  } catch (e: any) {
    S.sync = "error";
    S.err = /40[13]/.test(e.message) ? "Token ungültig oder abgelaufen" : /404/.test(e.message) ? "Repo nicht gefunden" : "Fehler (" + e.message + ")";
  }
  syncing = false; saveLocal(); emit();
  if (again) { again = false; scheduleSync(300); }
}

/* ---------- unlock: passphrase → token key + data key (remembered in IndexedDB, non-extractable) ---------- */
const idb = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> => new Promise((res, rej) => {
  const o = indexedDB.open("fokus", 1);
  o.onupgradeneeded = () => o.result.createObjectStore("kv");
  o.onerror = () => rej(o.error);
  o.onsuccess = () => { const r = f(o.result.transaction("kv", mode).objectStore("kv")); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
});

export async function loadVault(): Promise<void> {
  try {
    const r = await fetch("vault.json", { cache: "no-cache" });
    S.vault = r.ok ? await r.json() : null;
  } catch { S.vault = null; }
  if (!S.vault) { S.sync = "off"; emit(); return; }
  const keys = await idb<Keys | undefined>("readonly", s => s.get("keys")).catch(() => undefined);
  if (keys && await useKeys(keys)) return;
  S.sync = "locked"; emit();
}
type Keys = { token: CryptoKey; data: CryptoKey };
async function useKeys(k: Keys): Promise<boolean> {
  try { S.token = await openVault(S.vault!, k.token); } catch { return false; }
  S.dataKey = k.data;
  S.sync = "idle"; emit(); sync();
  return true;
}
/** false = wrong passphrase */
export async function unlock(pass: string, remember: boolean): Promise<boolean> {
  const v = S.vault!;
  const [token, data] = await Promise.all([deriveKey(pass, v.salt, v.iter), deriveKey(pass, v.dataSalt, v.iter)]);
  if (!(await useKeys({ token, data }))) return false;
  if (remember) await idb("readwrite", s => s.put({ token, data }, "keys")).catch(() => {});
  return true;
}
/** "Gerät abmelden": forget keys, token and local data on this device. */
export async function signOut() {
  await idb("readwrite", s => s.delete("keys")).catch(() => {});
  ["fk2_data", "fk2_sha", "fk2_dirty", "fk2_last", "fk2_collapsed", ...V1_KEYS].forEach(LS.del);
  location.reload();
}

/* ---------- triggers: debounce on edit, tab visible, every 3 min, back online ---------- */
document.addEventListener("visibilitychange", () => { if (S.token) scheduleSync(document.hidden ? 0 : 200); });
addEventListener("online", () => S.token && scheduleSync(200));
setInterval(() => { if (S.token && !document.hidden) sync(); }, 3 * 60_000);
