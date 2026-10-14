// Passphrase-only unlock (HANDOVER §11): vault.json in the public app repo holds the GitHub token,
// AES-GCM encrypted under PBKDF2-SHA256(passphrase, own salt). Shared by the app and tools/make-vault.ts,
// so this file must stay import-free and use only WebCrypto (browser + Node).
export interface Vault { v: 1; iter: number; salt: string; iv: string; ct: string; dataSalt: string }

export const ITER = 600_000;
const enc = new TextEncoder(), dec = new TextDecoder();
export const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function deriveKey(pass: string, salt: string, iter = ITER, extractable = false): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(salt), iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

export async function makeVault(token: string, pass: string): Promise<Vault> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token)));
  // dataSalt is reserved for the later data-E2E key, so token key and data key differ.
  return { v: 1, iter: ITER, salt, iv: b64(iv), ct: b64(ct), dataSalt: b64(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Throws on a wrong passphrase (AES-GCM authentication fails). */
export async function openVault(v: Vault, key: CryptoKey): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv) }, key, unb64(v.ct));
  return dec.decode(pt);
}
