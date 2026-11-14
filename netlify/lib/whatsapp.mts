// Alan on WhatsApp, through Meta's WhatsApp Business Cloud API. Meta calls /whatsapp with each
// message (a webhook signed with the app secret); only the household's numbers are answered.
// He thinks with the same mind, memory and tools as on the page; what he shows on the page
// (links, maps, pictures, music) comes as links and photos instead.
//   WHATSAPP_TOKEN          a permanent access token (a system user's) for the Cloud API
//   WHATSAPP_PHONE_ID       the id of Alan's WhatsApp number in Meta's dashboard
//   WHATSAPP_APP_SECRET     the Meta app's secret, to check each call really comes from Meta
//   WHATSAPP_VERIFY_TOKEN   any phrase, typed also into Meta's webhook settings
//   ALAN_WHATSAPP_PEOPLE    who is who: "48500100200=kuba,48600100200=hubert"
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "./store.mts";

const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsApp = { token: string; phoneId: string; appSecret: string; verify: string; people: Map<string, string> };
export type Incoming = { id: string; from: string; kind: "text" | "audio" | "other"; text?: string; media?: string };

/** "48500100200=kuba, +48 600 100 200 = hubert" -> number (digits only) -> person. */
export function parsePeople(spec: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of spec.split(",")) {
    const [number, person] = pair.split("=").map((s) => s.trim());
    const digits = (number ?? "").replace(/\D/g, "");
    if (digits.length >= 8 && /^[a-ząćęłńóśźż]{1,24}$/.test((person ?? "").toLowerCase())) out.set(digits, person.toLowerCase());
  }
  return out;
}

/** True when the body was signed by Meta with the app secret (X-Hub-Signature-256). */
export function signedByMeta(raw: string, header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The messages in one webhook call (statuses and other events are left out). */
export function incoming(body: any): Incoming[] {
  const out: Incoming[] = [];
  for (const entry of body?.entry ?? []) for (const change of entry?.changes ?? []) {
    for (const m of change?.value?.messages ?? []) {
      const base = { id: String(m.id ?? ""), from: String(m.from ?? "").replace(/\D/g, "") };
      if (m.type === "text") out.push({ ...base, kind: "text", text: String(m.text?.body ?? "") });
      else if (m.type === "audio") out.push({ ...base, kind: "audio", media: String(m.audio?.id ?? "") });
      else out.push({ ...base, kind: "other" });
    }
  }
  return out.filter((m) => m.id && m.from);
}

/** Meta may deliver a message more than once: true the first time only. */
export async function firstTime(store: Store, id: string): Promise<boolean> {
  const seen = (await store.get<string[]>("whatsapp/seen")) ?? [];
  if (seen.includes(id)) return false;
  await store.set("whatsapp/seen", [...seen, id].slice(-300));
  return true;
}

const post = (wa: WhatsApp, body: object, fetcher: typeof fetch) => fetcher(`${GRAPH}/${wa.phoneId}/messages`, {
  method: "POST", headers: { Authorization: `Bearer ${wa.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ messaging_product: "whatsapp", ...body }), signal: AbortSignal.timeout(10000),
});

/** The two blue ticks, and "pisze…" while he thinks. */
export const seenAndTyping = (wa: WhatsApp, id: string, fetcher: typeof fetch = fetch) =>
  post(wa, { status: "read", message_id: id, typing_indicator: { type: "text" } }, fetcher).catch(() => null);

export async function sendText(wa: WhatsApp, to: string, text: string, fetcher: typeof fetch = fetch) {
  for (const part of text.match(/[\s\S]{1,3800}(?=\s|$)|[\s\S]{1,3800}/g) ?? []) {      // WhatsApp's limit is 4096 characters
    const res = await post(wa, { to, type: "text", text: { body: part.trim(), preview_url: true } }, fetcher);
    if (!res.ok) console.log(`WhatsApp send answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function sendImage(wa: WhatsApp, to: string, link: string, caption: string, fetcher: typeof fetch = fetch) {
  const res = await post(wa, { to, type: "image", image: { link, caption: caption.slice(0, 1000) } }, fetcher);
  if (!res.ok) console.log(`WhatsApp image answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}

/** A voice note: its bytes, fetched from Meta (two steps: where it is, then the file). */
export async function download(wa: WhatsApp, media: string, fetcher: typeof fetch = fetch): Promise<Blob | null> {
  const meta = await fetcher(`${GRAPH}/${media}`, { headers: { Authorization: `Bearer ${wa.token}` } });
  if (!meta.ok) return null;
  const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
  if (!url) return null;
  const file = await fetcher(url, { headers: { Authorization: `Bearer ${wa.token}` } });
  return file.ok ? new Blob([await file.arrayBuffer()], { type: mime_type ?? "audio/ogg" }) : null;
}

/**
 * What he does on the page, said in a chat instead: a map becomes a map link, a picture a photo,
 * music a YouTube link, a link stays a link. Returns the extra text lines and the photos to send.
 */
export function shown(actions: { ok: boolean; text: string }[]) {
  const lines: string[] = [], photos: { link: string; caption: string }[] = [];
  for (const a of actions) {
    if (!a.ok) { lines.push(`⚠️ ${a.text}`); continue; }
    const map = /^mapa na ekranie:\s*(.*?)\s*@(-?[\d.]+),(-?[\d.]+)/i.exec(a.text);
    if (map) { lines.push(`📍 ${map[1]}: https://www.openstreetmap.org/?mlat=${map[2]}&mlon=${map[3]}#map=17/${map[2]}/${map[3]}`); continue; }
    const pic = /^obraz na ekranie:\s*(.*?)\s+(https:\/\/\S+)$/i.exec(a.text);
    if (pic) { photos.push({ link: pic[2], caption: pic[1] }); continue; }
    const tune = /^muzyka:\s*(.*?)\s*yt:(video|list):([\w-]+)$/i.exec(a.text);
    if (tune) { lines.push(`🎵 ${tune[1]}: https://music.youtube.com/${tune[2] === "list" ? `playlist?list=${tune[3]}` : `watch?v=${tune[3]}`}`); continue; }
    if (/https:\/\//.test(a.text)) lines.push(`🔗 ${a.text.replace(/^link na ekranie:\s*/i, "")}`);
  }
  return { lines, photos };
}

/** His spoken reply, as chat text: voice tags out. */
export const chatText = (reply: string) => reply.replace(/([.!?…])?\s*\[pause\]\s*/gi, (_, end) => (end ? `${end} ` : "… ")).replace(/\s*\[(sighs|laughs|chuckles|whispers)\]\s*/gi, " ").replace(/\s+([,.!?…])/g, "$1").replace(/ {2,}/g, " ").trim();
