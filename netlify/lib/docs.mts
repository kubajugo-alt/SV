// Documents he makes with show_document: kept in the store as doc/<id>, shown as a plain printable page.

export type Doc = { title: string; text: string; person: string; at: string };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function docPage(doc: Doc): string {
  const day = doc.at.slice(0, 10).split("-").reverse().join(".");
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(doc.title)}</title>
<style>
body { font: 17px/1.5 system-ui, sans-serif; max-width: 40em; margin: 2em auto; padding: 0 1em; color: #111; }
h1 { font-size: 1.4em; margin-bottom: .2em; } .meta { color: #666; font-size: .85em; margin-bottom: 1.5em; }
.text { white-space: pre-wrap; } button { margin-top: 2em; font: inherit; padding: .5em 1em; }
@media print { button { display: none; } }
</style></head><body>
<h1>${escape(doc.title)}</h1>
<div class="meta">ALAN · ${escape(day)}</div>
<div class="text">${escape(doc.text)}</div>
<button onclick="print()">Drukuj / zapisz jako PDF</button>
</body></html>
`;
}
