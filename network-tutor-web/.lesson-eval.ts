import { readFileSync } from "node:fs";
import { matchLesson } from "@/lib/textbook/lesson-match";
// 간단 CSV 파서(따옴표 포함)
function parse(text: string): string[][] { const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else f += c; }
  return rows; }
const rows = parse(readFileSync(process.argv[2], "utf8")).slice(1).filter((r) => r.length >= 4);
const by = new Map<string, number>(); let none = 0; const bySubj = new Map<string, [number, number]>();
const samples: string[] = [];
for (const [id, subject, stem, choices] of rows) {
  const ch = (() => { try { return JSON.parse(choices) as string[]; } catch { return []; } })();
  const m = matchLesson(stem, ch, subject);
  const s = bySubj.get(subject) ?? [0, 0]; s[1]++; if (m) s[0]++; bySubj.set(subject, s);
  if (!m) { none++; continue; }
  by.set(m.slug, (by.get(m.slug) ?? 0) + 1);
  if (Number(id) % 97 === 0 && samples.length < 25) samples.push(`${m.slug} <= ${stem.slice(0, 70).replace(/\n/g, " ")}`);
}
console.log("total", rows.length, "matched", rows.length - none, `(${Math.round(100 * (rows.length - none) / rows.length)}%)`);
for (const [k, [a, b]] of bySubj) console.log(k, `${a}/${b}`);
console.log([...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "));
console.log(samples.join("\n"));
