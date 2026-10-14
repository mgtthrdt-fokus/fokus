// node tools/migrate.ts <data.json> [out.json] [--areas areas.json]
// Same migration the app runs on first sync. Without out.json it only prints a check, nothing is written.
// --areas: the private area mapping ([{id, title, shorts}]); without it everything goes under one area.
import { readFileSync, writeFileSync } from "node:fs";
import { normalize, serialize } from "../src/merge.ts";

const args = process.argv.slice(2), ai = args.indexOf("--areas");
const areas = ai >= 0 ? JSON.parse(readFileSync(args.splice(ai, 2)[1], "utf8")) : undefined;
const [inp, out] = args;
if (!inp) { console.error("usage: node tools/migrate.ts <data.json> [out.json] [--areas areas.json]"); process.exit(2); }
const v1 = JSON.parse(readFileSync(inp, "utf8"));
const v2 = normalize(structuredClone(v1), areas);
const count = (t: string) => v2.nodes.filter(n => n.type === t).length;
console.log(`schema ${v1.schema ?? 1} → 2: ${v1.projects?.length ?? 0} Projekte, ${v1.tasks?.length ?? 0} Aufgaben, ${v1.meetings?.length ?? 0} Meetings`);
console.log(`  nodes: ${count("area")} area, ${count("system")} system, ${count("project")} project, ${count("task")} task, ${count("meeting")} meeting`);
const lost = [...(v1.projects ?? []), ...(v1.tasks ?? []), ...(v1.meetings ?? [])].filter((x: any) => !v2.nodes.some(n => n.id === x.id));
if (lost.length) { console.error("  FEHLT:", lost.map((x: any) => x.id)); process.exit(1); }
for (const p of v2.nodes.filter(n => n.type === "project")) console.log(`  ${p.parent} › ${p.title}`);
if (out) { writeFileSync(out, serialize(v2)); console.log("geschrieben:", out); }
