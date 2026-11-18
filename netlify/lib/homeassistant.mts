// The flat through Home Assistant (on the Mac mini at home), reached over its REST API from the cloud.
// The same rules as home.py: he reads sensors and may switch lights, plugs, fans and set the heating;
// there is deliberately nothing for locks, alarms, doors, gates, blinds or cameras.
import { plain, stems } from "./words.mts";

/** The address Home Assistant is reachable at from the internet (https://...) and a long-lived access token. */
export type HomeAssistant = { url: string; token: string };
type State = { entity_id: string; state: string; attributes?: Record<string, any> };

const READ = new Set(["sensor", "binary_sensor", "light", "switch", "fan", "climate", "person", "weather", "media_player"]);
const CONTROL = new Set(["light", "switch", "fan", "climate"]);
export const MIN_TEMP = 5, MAX_TEMP = 28;
const HIDDEN = new Set(["unknown", "unavailable"]);
const ON_OFF: Record<string, string> = { on: "włączone", off: "wyłączone", home: "w domu", not_home: "poza domem", heat: "grzanie", cool: "chłodzenie", auto: "automatycznie" };

export function homeAssistant(url: string, token: string): HomeAssistant | undefined {
  const u = url.trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+/.test(u) && token.trim() ? { url: u, token: token.trim() } : undefined;
}

async function request(ha: HomeAssistant, path: string, fetcher: typeof fetch, body?: object): Promise<any> {
  const res = await fetcher(ha.url + path, {
    method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${ha.token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(res.status === 401 ? "zły token" : `kod ${res.status}`);
  return res.json();
}

const nameOf = (s: State) => String(s.attributes?.friendly_name ?? s.entity_id);
const domainOf = (s: State) => s.entity_id.split(".")[0];

function describe(s: State): string {
  const a = s.attributes ?? {};
  let value = ON_OFF[s.state] ?? s.state.replace(".", ",");
  if (a.unit_of_measurement) value += ` ${a.unit_of_measurement}`;
  if (domainOf(s) === "light" && s.state === "on" && a.brightness) value += ` (${Math.round(a.brightness / 255 * 100)}%)`;
  if (domainOf(s) === "climate") value = `${ON_OFF[s.state] ?? s.state}${a.temperature != null ? `, ustawione ${a.temperature}°C` : ""}${a.current_temperature != null ? `, jest ${a.current_temperature}°C` : ""}`;
  return `${nameOf(s)}: ${value}`;
}

/** The entity a spoken name means: its id, or the most words of its name in common. */
function find(states: State[], wanted: string): State | undefined {
  const exact = states.find((s) => s.entity_id === wanted.trim());
  if (exact) return exact;
  const words = stems(wanted);
  let best: State | undefined, score = 0;
  for (const s of states) {
    const have = stems(`${nameOf(s)} ${s.entity_id.replace(/[._]/g, " ")}`);
    const n = words.filter((w) => have.includes(w)).length;
    if (n > score) [best, score] = [s, n];
  }
  return best;
}

/** What the flat looks like now: everything readable, or only what fits `query`. */
export async function homeState(ha: HomeAssistant, query: string, fetcher: typeof fetch = fetch): Promise<string> {
  const states = ((await request(ha, "/api/states", fetcher)) as State[]).filter((s) => READ.has(domainOf(s)) && !HIDDEN.has(s.state));
  const words = stems(query);
  const fits = words.length
    ? states.filter((s) => { const have = stems(`${nameOf(s)} ${s.entity_id.replace(/[._]/g, " ")}`); return words.some((w) => have.includes(w)); })
    : states;
  if (!fits.length) return words.length ? `W domu nie ma urządzenia ani czujnika pasującego do „${query.trim()}”.` : "Home Assistant nie ma jeszcze żadnych urządzeń ani czujników.";
  const shown = fits.slice(0, 40);
  return "Stan domu: " + shown.map(describe).join("; ") + (fits.length > shown.length ? `; i jeszcze ${fits.length - shown.length}, zawęź pytanie.` : ".");
}

/** Switch something on or off, set its brightness, or set the heating. */
export async function homeControl(ha: HomeAssistant, input: { device?: unknown; action?: unknown; brightness?: unknown; temperature?: unknown },
  fetcher: typeof fetch = fetch): Promise<string> {
  const wanted = String(input.device ?? "").trim().slice(0, 120);
  if (!wanted) return "Błąd: podaj, które urządzenie.";
  const states = ((await request(ha, "/api/states", fetcher)) as State[]).filter((s) => CONTROL.has(domainOf(s)));
  const target = find(states, wanted);
  if (!target) return `Błąd: nie ma urządzenia „${wanted}”, którym możesz sterować (sterujesz tylko światłami, gniazdkami, wentylatorami i ogrzewaniem).`;
  const domain = domainOf(target), name = nameOf(target), entity_id = target.entity_id;
  const action = plain(String(input.action ?? ""));
  if (domain === "climate" || input.temperature != null) {
    if (domain !== "climate") return `Błąd: ${name} to nie ogrzewanie; temperaturę ustawiasz tylko ogrzewaniu.`;
    if (action === "off") {
      await request(ha, "/api/services/climate/turn_off", fetcher, { entity_id });
      return `Wykonano: ogrzewanie ${name} wyłączone.`;
    }
    const degrees = Number(input.temperature);
    if (!(degrees >= MIN_TEMP && degrees <= MAX_TEMP)) return `Błąd: temperatura musi być między ${MIN_TEMP} a ${MAX_TEMP} stopni. Niczego nie zmieniono.`;
    await request(ha, "/api/services/climate/set_temperature", fetcher, { entity_id, temperature: degrees });
    return `Wykonano: ogrzewanie ${name} ustawione na ${String(degrees).replace(".", ",")}°C.`;
  }
  if (!["on", "off", "toggle"].includes(action)) return "Błąd: powiedz, czy włączyć (on), wyłączyć (off), czy przełączyć (toggle).";
  const data: Record<string, unknown> = { entity_id };
  const pct = Number(input.brightness);
  if (domain === "light" && action === "on" && input.brightness != null && pct > 0) data.brightness_pct = Math.max(1, Math.min(100, Math.round(pct)));
  await request(ha, `/api/services/${domain}/${action === "toggle" ? "toggle" : `turn_${action}`}`, fetcher, data);
  const done = action === "on" ? "włączone" : action === "off" ? "wyłączone" : "przełączone";
  return `Wykonano: ${name} ${done}${data.brightness_pct ? `, jasność ${data.brightness_pct}%` : ""}.`;
}
