// Backups of ALAN's memory: everything in the "alan" blob store (conversations, notes about the
// household, reminders, lists, his own calendar, favourites, music) photographed every night,
// compressed and encrypted, and kept in a second store, "alan-backups":
//   daily/YYYY-MM-DD     the last 14 nights
//   weekly/YYYY-MM-DD    the last 8 Sundays
//   monthly/YYYY-MM      the last 12 first-of-the-months
//   manual/<time>        taken by hand, or just before a restore (the last 10)
//   status               when the last backup worked, how big it was, what went wrong
// Once a week a copy also goes to a private GitHub repository, when a token for it is set, so his
// memory outlives the Netlify site. His personality and code live in git and need none of this.
//
// File format: "ALAN1" | salt (16) | iv (12) | tag (16) | AES-256-GCM(gzip(JSON)); the key is
// scrypt(ALAN_BACKUP_KEY, salt). Without that passphrase no backup can be read: keep it twice.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { getStore } from "@netlify/blobs";
import type { Store } from "./store.mts";

const MAGIC = Buffer.from("ALAN1");
const SKIP = /^places$/;                     // downloaded afresh every week: no need to keep it
const KEEP = { daily: 14, weekly: 8, monthly: 12, manual: 10 };
export const STALE_HOURS = 36;

export type Snapshot = { version: 1; at: string; sha256: string; entries: Record<string, unknown> };
export type Status = { lastOk?: string; lastSize?: number; lastName?: string; lastError?: string; lastErrorAt?: string; offsite?: string; warnedAt?: string; firstSeen?: string };

/** The second store: whole files, by name. */
export interface Vault {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export function blobVault(): Vault {
  const store = getStore({ name: "alan-backups", consistency: "strong" });
  return {
    put: async (key, data) => { await store.set(key, new Uint8Array(data).buffer as ArrayBuffer); },
    get: async (key) => { const b = await store.get(key, { type: "arrayBuffer" }); return b ? Buffer.from(b) : null; },
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
    delete: async (key) => { await store.delete(key); },
  };
}

export function memoryVault(): Vault & { data: Map<string, Buffer> } {
  const data = new Map<string, Buffer>();
  return {
    data,
    put: async (k, v) => { data.set(k, Buffer.from(v)); },
    get: async (k) => data.get(k) ?? null,
    list: async (p) => [...data.keys()].filter((k) => k.startsWith(p)).sort(),
    delete: async (k) => { data.delete(k); },
  };
}

const keyFrom = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const digest = (entries: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(entries)).digest("hex");

export function seal(snapshot: Snapshot, passphrase: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(snapshot))), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/** Opens a backup file; throws if the passphrase is wrong, the file is damaged or its contents do not add up. */
export function open(file: Buffer, passphrase: string): Snapshot {
  if (!file.subarray(0, 5).equals(MAGIC)) throw new Error("to nie jest plik kopii Alana");
  const salt = file.subarray(5, 21), iv = file.subarray(21, 33), tag = file.subarray(33, 49);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try { plain = Buffer.concat([decipher.update(file.subarray(49)), decipher.final()]); } catch { throw new Error("zły klucz albo uszkodzony plik"); }
  const snapshot = JSON.parse(gunzipSync(plain).toString("utf8")) as Snapshot;
  if (snapshot.version !== 1 || digest(snapshot.entries) !== snapshot.sha256) throw new Error("suma kontrolna się nie zgadza");
  return snapshot;
}

/** Everything he remembers, as it is now. */
export async function photograph(store: Store, now: Date): Promise<Snapshot> {
  const entries: Record<string, unknown> = {};
  for (const key of (await store.list("")).sort()) if (!SKIP.test(key)) entries[key] = await store.get(key);
  return { version: 1, at: now.toISOString(), sha256: digest(entries), entries };
}

/** Where tonight's backup goes, and which other slots it also fills. */
export function slots(now: Date): string[] {
  const day = now.toISOString().slice(0, 10);
  return [`daily/${day}`, ...(now.getUTCDay() === 0 ? [`weekly/${day}`] : []), ...(now.getUTCDate() === 1 ? [`monthly/${day.slice(0, 7)}`] : [])];
}

async function prune(vault: Vault) {
  for (const [kind, keep] of Object.entries(KEEP)) {
    const names = (await vault.list(`${kind}/`)).sort();
    for (const old of names.slice(0, Math.max(0, names.length - keep))) await vault.delete(old);
  }
}

export async function status(vault: Vault): Promise<Status> {
  const raw = await vault.get("status");
  return raw ? JSON.parse(raw.toString("utf8")) : {};
}
const saveStatus = (vault: Vault, s: Status) => vault.put("status", Buffer.from(JSON.stringify(s)));

export type Offsite = { token: string; repo: string };

/** Puts the file in the private repository and keeps the last 12 there. */
async function sendOffsite(off: Offsite, name: string, file: Buffer, fetcher: typeof fetch) {
  const api = `https://api.github.com/repos/${off.repo}/contents`;
  const headers = { Authorization: `Bearer ${off.token}`, Accept: "application/vnd.github+json", "User-Agent": "alan-backup" };
  const path = `backups/${name.replace(/\//g, "-")}.alan`;
  const put = await fetcher(`${api}/${path}`, { method: "PUT", headers, body: JSON.stringify({ message: `Kopia pamięci Alana ${name}`, content: file.toString("base64") }) });
  if (!put.ok && put.status !== 422) throw new Error(`GitHub ${put.status}`);     // 422: already there
  const listed = await fetcher(`${api}/backups`, { headers });
  if (!listed.ok) return;
  const files = ((await listed.json()) as { name: string; path: string; sha: string }[]).filter((f) => f.name.endsWith(".alan")).sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files.slice(0, Math.max(0, files.length - 12))) {
    await fetcher(`${api}/${f.path}`, { method: "DELETE", headers, body: JSON.stringify({ message: `Stara kopia ${f.name}`, sha: f.sha }) });
  }
}

/** Takes a backup, checks that it opens, files it and tidies up. `name` given: a manual one. */
export async function backUp(store: Store, vault: Vault, passphrase: string, now: Date,
  opts: { name?: string; offsite?: Offsite; fetcher?: typeof fetch } = {}): Promise<{ name: string; size: number }> {
  const s = await status(vault);
  try {
    const snapshot = await photograph(store, now);
    const file = seal(snapshot, passphrase);
    if (open(file, passphrase).sha256 !== snapshot.sha256) throw new Error("kopia nie daje się odczytać");
    const names = opts.name ? [`manual/${opts.name}`] : slots(now);
    for (const name of names) await vault.put(name, file);
    await prune(vault);
    if (!opts.name && opts.offsite && names.some((n) => n.startsWith("weekly/"))) {
      try { await sendOffsite(opts.offsite, names[0], file, opts.fetcher ?? fetch); s.offsite = now.toISOString(); }
      catch (err) { s.lastError = `kopia na GitHubie: ${(err as Error).message}`; s.lastErrorAt = now.toISOString(); }
    }
    Object.assign(s, { lastOk: now.toISOString(), lastSize: file.length, lastName: names[0] });
    await saveStatus(vault, s);
    return { name: names[0], size: file.length };
  } catch (err) {
    await saveStatus(vault, { ...s, lastError: (err as Error).message, lastErrorAt: now.toISOString() });
    throw err;
  }
}

export async function listBackups(vault: Vault) {
  const out: { name: string; size: number }[] = [];
  for (const kind of Object.keys(KEEP)) {
    for (const name of await vault.list(`${kind}/`)) out.push({ name, size: (await vault.get(name))?.length ?? 0 });
  }
  return out.sort((a, b) => b.name.split("/")[1].localeCompare(a.name.split("/")[1]) || a.name.localeCompare(b.name));
}

/**
 * Puts a backup back. `only` limits it to keys under a prefix (e.g. "talk/hubert", "own").
 * A backup of the present is taken first, so a restore can itself be undone.
 */
export async function restore(store: Store & { delete?(key: string): Promise<void> }, vault: Vault, passphrase: string, file: Buffer, now: Date, only = "") {
  const snapshot = open(file, passphrase);
  const before = await backUp(store, vault, passphrase, now, { name: `przed-przywroceniem-${now.toISOString().replace(/[:.]/g, "-")}` });
  const wanted = Object.keys(snapshot.entries).filter((k) => k.startsWith(only));
  for (const key of wanted) await store.set(key, snapshot.entries[key]);
  let removed = 0;
  if (store.delete) {                        // keys that did not exist then go too, within the same scope
    for (const key of await store.list(only)) {
      if (!SKIP.test(key) && !(key in snapshot.entries)) { await store.delete(key); removed++; }
    }
  }
  return { restored: wanted.length, removed, from: snapshot.at, safety: before.name };
}

/** What he should say when the backups have stopped working; once a day at most. */
export async function staleWarning(vault: Vault, now: Date): Promise<string | null> {
  const s = await status(vault);
  if (!s.lastOk && !s.firstSeen) { await saveStatus(vault, { ...s, firstSeen: now.toISOString() }); return null; }   // give the first night a chance
  const last = new Date(s.lastOk ?? s.firstSeen!).getTime();
  if (now.getTime() - last < STALE_HOURS * 3600000) return null;
  if (s.warnedAt && now.getTime() - new Date(s.warnedAt).getTime() < 24 * 3600000) return null;
  await saveStatus(vault, { ...s, warnedAt: now.toISOString() });
  return s.lastOk
    ? `Kopia mojej pamięci nie zrobiła się od ${Math.round((now.getTime() - last) / 3600000)} godzin${s.lastError ? ` (${s.lastError})` : ""}. Naciśnij B, żeby zobaczyć.`
    : "Nie mam jeszcze żadnej kopii swojej pamięci. Naciśnij B, żeby ją zrobić.";
}
