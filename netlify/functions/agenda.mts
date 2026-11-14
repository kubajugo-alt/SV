// GET /agenda -> what he should say now (timers and reminders come due, a backup that has stopped working) and the running timers.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { blobVault, staleWarning } from "../lib/backup.mts";
import { passphrase } from "../lib/backupenv.mts";
import { phone } from "../lib/env.mts";
import { blobStore } from "../lib/store.mts";
import { agenda } from "../lib/tools.mts";

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const now = new Date();
  const out = await agenda(blobStore(), now, phone());
  if (passphrase()) {
    const warning = await staleWarning(blobVault(), now).catch(() => null);
    if (warning) out.say.push(warning);
  }
  return Response.json(out);
};

export const config: Config = { path: "/agenda", method: "GET" };
