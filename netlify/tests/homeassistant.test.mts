import assert from "node:assert/strict";
import { test } from "node:test";
import { homeAssistant } from "../lib/homeassistant.mts";
import { memoryStore } from "../lib/store.mts";
import { runTool, TOOLS } from "../lib/tools.mts";

const STATES = [
  { entity_id: "sensor.salon_temperature", state: "21.5", attributes: { friendly_name: "Temperatura salon", unit_of_measurement: "°C" } },
  { entity_id: "light.salon", state: "on", attributes: { friendly_name: "Światło salon", brightness: 128 } },
  { entity_id: "switch.czajnik", state: "off", attributes: { friendly_name: "Gniazdko czajnik" } },
  { entity_id: "climate.sypialnia", state: "heat", attributes: { friendly_name: "Ogrzewanie sypialnia", temperature: 20, current_temperature: 19 } },
  { entity_id: "lock.drzwi", state: "locked", attributes: { friendly_name: "Zamek drzwi" } },
  { entity_id: "sensor.zepsuty", state: "unavailable", attributes: { friendly_name: "Zepsuty czujnik" } },
];

/** A Home Assistant that answers /api/states and records service calls. */
function fakeHome() {
  const calls: { path: string; body: any; auth: string | null }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") });
    return path === "/api/states" ? Response.json(STATES) : Response.json([]);
  }) as typeof fetch;
  const ctx = { store: memoryStore(), person: "kuba", tz: "Europe/Warsaw", now: new Date("2026-11-18T10:00:00Z"), calendars: [],
    home: homeAssistant("https://dom.example.org/", "token123"), fetcher };
  return { ctx, calls };
}

test("Home Assistant needs an https address and a token", () => {
  assert.equal(homeAssistant("http://192.168.1.10:8123", "t"), undefined);
  assert.equal(homeAssistant("https://dom.example.org", ""), undefined);
  assert.deepEqual(homeAssistant("https://dom.example.org/", " t "), { url: "https://dom.example.org", token: "t" });
  assert.ok(TOOLS.some((t) => t.name === "home_state") && TOOLS.some((t) => t.name === "home_control"));
});

test("without Home Assistant he says so", async () => {
  const { ctx } = fakeHome();
  assert.match(await runTool("home_state", {}, { ...ctx, home: undefined }), /^Błąd: nie masz jeszcze dostępu do domu/);
});

test("he reads the flat, without locks or broken sensors", async () => {
  const { ctx, calls } = fakeHome();
  const all = await runTool("home_state", {}, ctx);
  assert.match(all, /Temperatura salon: 21,5 °C/);
  assert.match(all, /Światło salon: włączone \(50%\)/);
  assert.match(all, /Ogrzewanie sypialnia: grzanie, ustawione 20°C, jest 19°C/);
  assert.doesNotMatch(all, /Zamek|Zepsuty/);
  assert.equal(calls[0].auth, "Bearer token123");
  const salon = await runTool("home_state", { query: "salon" }, ctx);
  assert.doesNotMatch(salon, /sypialnia|czajnik/);
});

test("he switches lights and plugs, sets the heating, and never touches a lock", async () => {
  const { ctx, calls } = fakeHome();
  assert.equal(await runTool("home_control", { device: "światło w salonie", action: "on", brightness: 30 }, ctx), "Wykonano: Światło salon włączone, jasność 30%.");
  assert.deepEqual(calls.at(-1), { path: "/api/services/light/turn_on", body: { entity_id: "light.salon", brightness_pct: 30 }, auth: "Bearer token123" });
  assert.equal(await runTool("home_control", { device: "czajnik", action: "toggle" }, ctx), "Wykonano: Gniazdko czajnik przełączone.");
  assert.equal(calls.at(-1)!.path, "/api/services/switch/toggle");
  assert.equal(await runTool("home_control", { device: "ogrzewanie sypialnia", temperature: 21.5 }, ctx), "Wykonano: ogrzewanie Ogrzewanie sypialnia ustawione na 21,5°C.");
  assert.deepEqual(calls.at(-1)!.body, { entity_id: "climate.sypialnia", temperature: 21.5 });
  const before = calls.length;
  assert.match(await runTool("home_control", { device: "ogrzewanie sypialnia", temperature: 35 }, ctx), /^Błąd: temperatura/);
  assert.match(await runTool("home_control", { device: "zamek drzwi", action: "off" }, ctx), /^Błąd: nie ma urządzenia/);
  assert.match(await runTool("home_control", { device: "lock.drzwi", action: "off" }, ctx), /^Błąd: nie ma urządzenia/);
  assert.ok(calls.slice(before).every((c) => c.path === "/api/states"));
});

test("a Home Assistant that does not answer is an error, not a crash", async () => {
  const { ctx } = fakeHome();
  const down = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
  assert.equal(await runTool("home_state", {}, { ...ctx, fetcher: down }), "Błąd: Home Assistant nie odpowiada (zły token).");
});
