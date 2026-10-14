// node tools/make-vault.ts  →  writes public/vault.json (token encrypted under your Fokus passphrase).
// Prompts hide input; nothing is printed or logged. Commit + push public/vault.json afterwards.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { deriveKey, makeVault, openVault, type Vault } from "../src/vault.ts";

const OUT = "public/vault.json";
const old: Vault | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;

function ask(q: string): Promise<string> {
  return new Promise(res => {
    const { stdin, stdout } = process;
    stdout.write(q);
    let s = "";
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
    const on = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", on); stdout.write("\n"); return res(s); }
        if (c === "\u0003") { stdout.write("\n"); process.exit(130); }      // Ctrl+C
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1); else s += c;
      }
    };
    stdin.on("data", on);
  });
}

const token = (await ask("GitHub-Token (github_pat_…): ")).trim();
if (!/^github_pat_\w{20,}$/.test(token)) { console.error("Das sieht nicht wie ein fine-grained Token aus. Abbruch."); process.exit(1); }
const pass = await ask(old ? "Fokus-Passphrase (dieselbe wie bisher): " : "Fokus-Passphrase (≥ 6 zufällige Wörter): ");
if (old) {
  // token renewal: same passphrase and same dataSalt, or the encrypted data.json becomes unreadable
  try { await openVault(old, await deriveKey(pass, old.salt, old.iter)); }
  catch { console.error("Passphrase passt nicht zum bisherigen Tresor. Abbruch, nichts geändert."); process.exit(1); }
} else {
  if (pass.trim().split(/[\s\-_.]+/).filter(Boolean).length < 6 && pass.length < 30) { console.error("Passphrase zu schwach: ≥ 6 zufällige Wörter (oder ≥ 30 Zeichen) aus dem Passwort-Manager. Abbruch."); process.exit(1); }
  if (await ask("Passphrase wiederholen: ") !== pass) { console.error("Stimmt nicht überein. Abbruch."); process.exit(1); }
}

const v = await makeVault(token, pass, old?.dataSalt);
if (await openVault(v, await deriveKey(pass, v.salt)) !== token) { console.error("Selbsttest fehlgeschlagen. Nichts geschrieben."); process.exit(1); }
writeFileSync(OUT, JSON.stringify(v, null, 1) + "\n");
console.log("public/vault.json geschrieben. Jetzt: git add public/vault.json, commit, push.");
