/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

// Origin mgtthrdt.github.io is shared with other apps: no inline script, network only to GitHub API.
// Build only, because the dev server injects inline HMR scripts.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self' https://api.github.com; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const csp: Plugin = {
  name: "csp", apply: "build",
  transformIndexHtml: html => {
    if (!html.includes("<head>")) throw new Error("CSP: <head> not found, refusing to build without CSP");
    return html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  },
};

export default defineConfig({
  base: "./", // works under /fokus/ and any preview subpath
  plugins: [preact(), csp],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: "es2022", assetsInlineLimit: 0 },
  test: { environment: "node" },
});
