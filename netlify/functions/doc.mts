// GET /doc/<id> -> a document he made (show_document), as a page to read on a phone, print or save as PDF.
// The address is the key (32 random hex characters), as with the calendar feed: a phone that scans the
// QR code has not signed in. Nothing else on the site opens this way.
import type { Config, Context } from "@netlify/functions";
import { docPage, type Doc } from "../lib/docs.mts";
import { blobStore } from "../lib/store.mts";

export default async (_req: Request, context: Context) => {
  const id = String(context.params?.id ?? "");
  const doc = /^[0-9a-f]{32}$/.test(id) ? await blobStore().get<Doc>(`doc/${id}`) : null;
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(docPage(doc), { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  } });
};

export const config: Config = { path: "/doc/:id", method: "GET" };
