import assert from "node:assert/strict";
import { test } from "node:test";
import { backUp, listBackups, memoryVault, open, restore, seal, slots, staleWarning, status } from "../lib/backup.mts";
import { memoryStore } from "../lib/store.mts";

const KEY = "długie hasło do kopii";
const memory = () => memoryStore({ own: { lists: { zakupy: ["mleko"] } }, "talk/kuba": { notes: "lubi kawę", turns: [] }, "log/kuba/2026-11": [{ t: "cześć" }], places: { rows: [1, 2, 3] } });

test("a backup is encrypted, opens only with its key, and leaves out what can be downloaded again", async () => {
  const store = memory(), vault = memoryVault();
  const done = await backUp(store, vault, KEY, new Date("2026-11-14T03:40:00Z"));
  assert.equal(done.name, "daily/2026-11-14");
  const file = vault.data.get("daily/2026-11-14")!;
  assert.ok(!file.toString("latin1").includes("mleko"));
  const snap = open(file, KEY);
  assert.deepEqual(Object.keys(snap.entries), ["log/kuba/2026-11", "own", "talk/kuba"]);
  assert.throws(() => open(file, "inne hasło"), /zły klucz/);
  const broken = Buffer.from(file); broken[broken.length - 3] ^= 1;
  assert.throws(() => open(broken, KEY), /zły klucz albo uszkodzony/);
  assert.equal((await status(vault)).lastName, "daily/2026-11-14");
});

test("Sundays and first days fill weekly and monthly slots; old ones are let go", async () => {
  assert.deepEqual(slots(new Date("2026-11-01T03:40:00Z")), ["daily/2026-11-01", "weekly/2026-11-01", "monthly/2026-11"]);
  const store = memory(), vault = memoryVault();
  for (let d = 1; d <= 20; d++) await backUp(store, vault, KEY, new Date(Date.UTC(2026, 10, d, 3, 40)));
  const names = (await listBackups(vault)).map((b) => b.name);
  assert.equal(names.filter((n) => n.startsWith("daily/")).length, 14);
  assert.ok(!names.includes("daily/2026-11-06") && names.includes("daily/2026-11-07"));
  assert.deepEqual(names.filter((n) => n.startsWith("weekly/")), ["weekly/2026-11-15", "weekly/2026-11-08", "weekly/2026-11-01"]);
  assert.ok(names.includes("monthly/2026-11"));
});

test("a restore puts the past back, a part of it if asked, and can itself be undone", async () => {
  const store = memory(), vault = memoryVault();
  await backUp(store, vault, KEY, new Date("2026-11-14T03:40:00Z"));
  await store.set("own", { lists: {} });                            // a bug wipes the lists
  await store.set("talk/kuba", { notes: "nowe", turns: [] });
  await store.set("talk/hubert", { notes: "nowy", turns: [] });
  const file = vault.data.get("daily/2026-11-14")!;
  const one = await restore(store, vault, KEY, file, new Date("2026-11-14T10:00:00Z"), "own");
  assert.equal(one.restored, 1);
  assert.deepEqual(await store.get("own"), { lists: { zakupy: ["mleko"] } });
  assert.deepEqual(await store.get("talk/kuba"), { notes: "nowe", turns: [] });   // outside the scope: untouched
  const all = await restore(store, vault, KEY, file, new Date("2026-11-14T10:05:00Z"));
  assert.equal(all.removed, 1);                                     // talk/hubert did not exist then
  assert.deepEqual(await store.get("places"), { rows: [1, 2, 3] });  // never part of a backup, never removed
  const safety = open(vault.data.get(all.safety)!, KEY);
  assert.deepEqual(safety.entries["talk/hubert"], { notes: "nowy", turns: [] });
});

test("he says so once a day when backups have stopped, but gives the first night a chance", async () => {
  const vault = memoryVault();
  assert.equal(await staleWarning(vault, new Date("2026-11-14T10:00:00Z")), null);
  assert.equal(await staleWarning(vault, new Date("2026-11-15T10:00:00Z")), null);
  assert.match((await staleWarning(vault, new Date("2026-11-16T10:00:00Z")))!, /Nie mam jeszcze żadnej kopii/);
  assert.equal(await staleWarning(vault, new Date("2026-11-16T20:00:00Z")), null);
  await backUp(memory(), vault, KEY, new Date("2026-11-16T21:00:00Z"));
  assert.equal(await staleWarning(vault, new Date("2026-11-17T21:00:00Z")), null);
  assert.match((await staleWarning(vault, new Date("2026-11-18T12:00:00Z")))!, /nie zrobiła się od 39 godzin/);
});

test("the weekly copy goes to the private repository, and only the last 12 stay there", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: any, init: any = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    if (!init.method) return Response.json(Array.from({ length: 13 }, (_, i) => ({ name: `daily-2026-${String(i + 1).padStart(2, "0")}-01.alan`, path: `backups/x${i}`, sha: `s${i}` })));
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  await backUp(memory(), memoryVault(), KEY, new Date("2026-11-15T03:40:00Z"), { offsite: { token: "t", repo: "kuba/alan-pamiec" }, fetcher });
  assert.equal(calls[0], "PUT https://api.github.com/repos/kuba/alan-pamiec/contents/backups/daily-2026-11-15.alan");
  assert.deepEqual(calls.filter((c) => c.startsWith("DELETE")), ["DELETE https://api.github.com/repos/kuba/alan-pamiec/contents/backups/x0"]);
  assert.ok(seal({ version: 1, at: "", sha256: "", entries: {} }, KEY).length > 49);
});
