// What the backups read from the site's environment.
import type { Offsite } from "./backup.mts";

export const passphrase = () => Netlify.env.get("ALAN_BACKUP_KEY") ?? "";
export function offsite(): Offsite | undefined {
  const token = Netlify.env.get("ALAN_BACKUP_TOKEN"), repo = Netlify.env.get("ALAN_BACKUP_REPO") ?? "kubajugo-alt/alan-pamiec";
  return token ? { token, repo } : undefined;
}
