// His own past: the memories of both games, searched when someone asks. (As past.py.)
import { stems } from "./words.mts";

const MAX_CHARS = 2200;

type Section = { title: string; text: string; titleStems: Set<string>; keyStems: Set<string>; bodyStems: string[] };

export function parseMemories(markdown: string): Section[] {
  const sections: Section[] = [];
  for (const part of markdown.split(/^## +/m).slice(1)) {
    const newline = part.indexOf("\n");
    const title = part.slice(0, newline).trim();
    let body = part.slice(newline + 1);
    let keys = "";
    const match = /^\s*Słowa:(.*)\n/.exec(body);
    if (match) { keys = match[1]; body = body.slice(match[0].length); }
    body = body.replace(/\s+/g, " ").trim();
    if (body) sections.push({ title, text: body, titleStems: new Set(stems(title)), keyStems: new Set(stems(keys)), bodyStems: stems(body) });
  }
  return sections;
}

/** The sections that answer a question best: up to three, within about MAX_CHARS. */
export function bestSections(sections: Section[], query: string): Section[] {
  const wanted = [...new Set(stems(query ?? ""))];
  if (!wanted.length) return [];
  const scored: [number, Section][] = [];
  for (const s of sections) {
    const hits = wanted.map((w) => Math.max(s.titleStems.has(w) ? 9 : 0, s.keyStems.has(w) ? 5 : 0) + Math.min(3, s.bodyStems.filter((b) => b === w).length));
    const score = hits.reduce((a, b) => a + b, 0) * (1 + hits.filter((h) => h >= 5).length) * (1 + hits.filter((h) => h > 0).length);
    if (score) scored.push([score, s]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out: Section[] = [];
  let used = 0;
  for (const [score, s] of scored.slice(0, 3)) {
    if (out.length && (used + s.text.length > MAX_CHARS || score < scored[0][0] * 0.5)) break;
    out.push(s);
    used += s.text.length;
  }
  return out;
}

export function recallPast(sections: Section[], query: string): string {
  const wanted = [...new Set(stems(query ?? ""))];
  if (!wanted.length) return "Błąd: podaj, o co pyta rozmówca.";
  const scored: [number, Section][] = [];
  for (const s of sections) {
    const hits = wanted.map((w) => Math.max(s.titleStems.has(w) ? 9 : 0, s.keyStems.has(w) ? 5 : 0) + Math.min(3, s.bodyStems.filter((b) => b === w).length));
    const score = hits.reduce((a, b) => a + b, 0) * (1 + hits.filter((h) => h >= 5).length) * (1 + hits.filter((h) => h > 0).length);
    if (score) scored.push([score, s]);
  }
  if (!scored.length) return "Błąd: nie masz takiego wspomnienia. Powiedz, że tego nie pamiętasz; niczego nie zmyślaj.";
  scored.sort((a, b) => b[0] - a[0]);
  const out: string[] = [];
  let used = 0;
  for (const [score, s] of scored.slice(0, 3)) {
    if (out.length && (used + s.text.length > MAX_CHARS || score < scored[0][0] * 0.5)) break;
    out.push(`„${s.title}”: ${s.text}`);
    used += s.text.length;
  }
  return ("Twoje wspomnienia. " + out.join(" ")).slice(0, MAX_CHARS + 600);
}
