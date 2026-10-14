// node tools/make-vault.ts  →  writes public/vault.json (token encrypted under your Fokus passphrase).
// Prompts hide input; nothing is printed or logged. Commit + push public/vault.json afterwards.
import { writeFileSync } from "node:fs";
import { deriveKey, makeVault, openVault } from "../src/vault.ts";

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
const pass = await ask("Fokus-Passphrase (≥ 6 zufällige Wörter): ");
if (pass.length < 20 || pass.trim().split(/[\s\-_.]+/).length < 4) { console.error("Passphrase zu kurz. Bitte ≥ 6 zufällige Wörter aus dem Passwort-Manager. Abbruch."); process.exit(1); }
if (await ask("Passphrase wiederholen: ") !== pass) { console.error("Stimmt nicht überein. Abbruch."); process.exit(1); }

const v = await makeVault(token, pass);
if (await openVault(v, await deriveKey(pass, v.salt)) !== token) { console.error("Selbsttest fehlgeschlagen. Nichts geschrieben."); process.exit(1); }
writeFileSync("public/vault.json", JSON.stringify(v, null, 1) + "\n");
console.log("public/vault.json geschrieben. Jetzt: git add public/vault.json, commit, push.");
