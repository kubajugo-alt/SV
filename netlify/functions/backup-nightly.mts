// Every night at 3:40 UTC: a backup of his memory (see lib/backup.mts). On Netlify's schedule; no address of its own.
import type { Config } from "@netlify/functions";
import { backUp, blobVault } from "../lib/backup.mts";
import { offsite, passphrase } from "../lib/backupenv.mts";
import { blobStore } from "../lib/store.mts";

export default async () => {
  const key = passphrase();
  if (!key) { console.log("Backup: ALAN_BACKUP_KEY is not set; nothing done."); return; }
  try {
    const done = await backUp(blobStore(), blobVault(), key, new Date(), { offsite: offsite() });
    console.log(`Backup: ${done.name}, ${done.size} bytes`);
  } catch (err) {
    console.log(`Backup failed: ${(err as Error).message}`);
  }
};

export const config: Config = { schedule: "40 3 * * *" };
