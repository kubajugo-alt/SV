// The backups of his memory, for the B window on the page:
//   GET  /backup                          -> the list, the status, whether the key is set
//   GET  /backup?file=<name>[&plain=1]    -> one backup: the encrypted file, or readable JSON
//   POST /backup {now: true}              -> take one by hand
//   POST /backup {restore: <name>, only?} -> put one back (a backup of the present is taken first)
//   POST /backup?restore=upload[&only=]   -> put back a file sent as the body
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { backUp, blobVault, listBackups, open, restore, status } from "../lib/backup.mts";
import { offsite, passphrase } from "../lib/backupenv.mts";
import { blobStore } from "../lib/store.mts";

const NAME = /^(daily|weekly|monthly|manual)\/[\w.-]+$/;
const ONLY = /^(|own|household|talk\/[a-ząćęłńóśźż]+|log\/[a-ząćęłńóśźż]+)$/;   // his journal and growth are his: only a whole restore brings them back

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const key = passphrase();
  const vault = blobVault();
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.has("file")) {
    return Response.json({ key: Boolean(key), offsite: Boolean(offsite()), status: await status(vault), backups: key ? await listBackups(vault) : [] });
  }
  if (!key) return Response.json({ error: "Brak klucza ALAN_BACKUP_KEY w ustawieniach strony." }, { status: 503 });
  const now = new Date();
  try {
    if (req.method === "GET") {
      const name = url.searchParams.get("file") ?? "";
      const file = NAME.test(name) ? await vault.get(name) : null;
      if (!file) return Response.json({ error: "nie ma takiej kopii" }, { status: 404 });
      const base = `alan-${name.replace("/", "-")}`;
      if (url.searchParams.get("plain") === "1") {
        return new Response(JSON.stringify(open(file, key), null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.json"`, "Cache-Control": "no-store" } });
      }
      return new Response(new Uint8Array(file), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${base}.alan"`, "Cache-Control": "no-store" } });
    }
    if (url.searchParams.get("restore") === "upload") {
      const only = url.searchParams.get("only") ?? "";
      if (!ONLY.test(only)) return Response.json({ error: "zły zakres" }, { status: 400 });
      const file = Buffer.from(await req.arrayBuffer());
      if (file.length > 50 * 1024 * 1024) return Response.json({ error: "plik za duży" }, { status: 413 });
      return Response.json(await restore(blobStore(), vault, key, file, now, only));
    }
    const body = await req.json().catch(() => ({})) as { now?: boolean; restore?: string; only?: string };
    if (body.now) return Response.json(await backUp(blobStore(), vault, key, now, { name: now.toISOString().replace(/[:.]/g, "-") }));
    if (body.restore) {
      const only = body.only ?? "";
      const file = NAME.test(body.restore) ? await vault.get(body.restore) : null;
      if (!file) return Response.json({ error: "nie ma takiej kopii" }, { status: 404 });
      if (!ONLY.test(only)) return Response.json({ error: "zły zakres" }, { status: 400 });
      return Response.json(await restore(blobStore(), vault, key, file, now, only));
    }
    return Response.json({ error: "nie wiem, co zrobić" }, { status: 400 });
  } catch (err) {
    console.log(`Backup endpoint: ${(err as Error).message}`);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
};

export const config: Config = { path: "/backup", method: ["GET", "POST"] };
