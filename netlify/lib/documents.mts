// Documents he writes for the household (make_document): kept in the store as doc/<id>
// and served at /doc/<id> as a page to print, save as PDF or download.
// The id is long and random: the address itself is the key, so a phone that scanned
// the QR code can open it without signing in (like the calendar feed).
import { randomBytes } from "node:crypto";
import type { Store } from "./store.mts";

export type Doc = { title: string; text: string; person: string; at: string };

/** How long a document stays available. */
export const DOC_DAYS = 90;

export async function saveDocument(store: Store, doc: Doc): Promise<string> {
  const id = randomBytes(16).toString("hex");
  await store.set(`doc/${id}`, doc);
  return id;
}

export async function loadDocument(store: Store, id: string, now = new Date()): Promise<Doc | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const doc = await store.get<Doc>(`doc/${id}`);
  return doc && now.getTime() - new Date(doc.at).getTime() < DOC_DAYS * 86400000 ? doc : null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The document as a page: # headings, - points, paragraphs split by blank lines. */
export function documentPage(doc: Doc, id: string): string {
  const blocks = doc.text.replace(/\r/g, "").split(/\n\s*\n/).map((block) => {
    const lines = block.trim().split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${escape(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) return `<h${heading[1].length + 1}>${escape(heading[2])}</h${heading[1].length + 1}>`;
    return `<p>${lines.map(escape).join("<br>")}</p>`;
  }).filter((b) => b !== "<p></p>");
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(doc.title)}</title>
<style>
body { font: 17px/1.5 Georgia, serif; max-width: 42em; margin: 2em auto; padding: 0 1em; color: #111; }
nav { margin-bottom: 2em; } nav a, nav button { font: inherit; margin-right: 1em; }
@media print { nav { display: none; } body { margin: 0; } }
</style></head><body>
<nav><button onclick="print()">Drukuj / zapisz jako PDF</button><a href="/doc/${id}?download" download>Pobierz jako tekst</a></nav>
<h1>${escape(doc.title)}</h1>
${blocks.join("\n")}
</body></html>`;
}

export const documentFileName = (doc: Doc) => (doc.title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "dokument") + ".txt";
