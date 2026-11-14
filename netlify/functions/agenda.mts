// GET /agenda -> what he should say now (timers and reminders come due, a backup that has stopped working) and the running timers.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { blobVault, staleWarning } from "../lib/backup.mts";
import { loadLife } from "../lib/life.mts";
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
  const mood = (await loadLife(blobStore()).catch(() => null))?.mood;
  const fresh = mood && now.getTime() - new Date(mood.at).getTime() < 12 * 3600000;
  return Response.json({ ...out, ...(fresh ? { mood: { energy: mood.energy, cheer: mood.cheer } } : {}) });
};

export const config: Config = { path: "/agenda", method: "GET" };
