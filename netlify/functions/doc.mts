// GET /doc/<id>           -> a document he wrote (make_document), as a page to print or save as PDF.
// GET /doc/<id>?download  -> the same as a text file.
// The long random id is the key: the QR code on his screen opens it on a phone that never signed in.
import type { Config, Context } from "@netlify/functions";
import { documentFileName, documentPage, loadDocument } from "../lib/documents.mts";
import { blobStore } from "../lib/store.mts";

export default async (req: Request, context: Context) => {
  const id = String(context.params.id ?? "");
  const doc = await loadDocument(blobStore(), id);
  if (!doc) return new Response("Nie ma takiego dokumentu albo już wygasł.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
  if (new URL(req.url).searchParams.has("download")) {
    return new Response(`${doc.title}\n\n${doc.text}\n`, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${documentFileName(doc)}"` } });
  }
  return new Response(documentPage(doc, id), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
};

export const config: Config = { path: "/doc/:id", method: "GET" };
