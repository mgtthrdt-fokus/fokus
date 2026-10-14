import { render } from "preact";
import "./styles.css";
import { App } from "./App.tsx";

declare global { const __APP_VERSION__: string }

try { const th = localStorage.getItem("fk2_theme"); if (th) document.documentElement.dataset.theme = th; } catch { /* ignore */ }
render(<App />, document.getElementById("app")!);

// The version in the URL makes every release a new worker, which drops old fokus-* caches.
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`sw.js?v=${__APP_VERSION__}`).catch(() => {});
