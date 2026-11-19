// Mouth shapes from the timing ElevenLabs returns with the audio: each character
// of the line with the moment it is spoken. Polish spelling is close to its
// sounds, so the letters give the shapes (Rhubarb's set: A closed, B teeth,
// C open, D wide, E rounded, F puckered, G teeth on the lip, H tongue up, X at rest).
// As in speech, a vowel opens the mouth wide only when it is held; said quickly it stays half open.
import { plain } from "./words.mts";

const MOUTH: Record<string, string> = {
  sz: "B", cz: "B", rz: "B", ch: "B", dz: "B",
  a: "D", e: "C", i: "B", y: "B", o: "E", u: "F", l: "H",
  p: "A", b: "A", m: "A", f: "G", w: "G", v: "G",
};
for (const c of "cdghjknrstzxq") MOUTH[c] = "B";
const HELD = 0.07;                       // seconds: shorter than this, an "a" is only half open and an "e" barely
const LEAD = 0;                          // the page lines the mouth up with what is heard (speech.js); no extra lead here
const ROUND = new Set(["E", "F"]);       // o and u round the lips already on the consonant before them
// Letters that lose their accent in plain(): ę -> e (C), ó -> u-like (F), ą -> o-like (E), ł -> w-like (F).
const ACCENTED: Record<string, string> = { "ó": "F", "ą": "E", "ł": "F" };

function shapeAt(characters: string[], starts: number[], ends: number[], i: number): string | undefined {
  const ch = characters[i].toLowerCase();
  const next = (characters[i + 1] ?? "").toLowerCase();
  let shape = ACCENTED[ch] ?? MOUTH[plain(ch + next)] ?? MOUTH[plain(ch)];
  const held = (ends[i] ?? starts[i]) - starts[i];
  if (held < HELD && shape === "D") shape = "C";
  else if (held < HELD * 0.6 && shape === "C" && plain(ch) === "e") shape = "B";
  return shape;
}

export function cuesFromCharacters(characters: string[], starts: number[], ends: number[]): [number, string][] {
  const cues: [number, string][] = [[0, "X"]];
  const push = (t: number, shape: string) => {
    if (cues[cues.length - 1][1] === shape) return;
    const at = Math.max(cues[cues.length - 1][0], Math.round(Math.max(0, t - LEAD) * 100) / 100);
    if (cues[cues.length - 1][0] === at && cues.length > 1) cues[cues.length - 1][1] = shape;   // two shapes at one moment: the later wins
    else cues.push([at, shape]);
  };
  for (let i = 0; i < characters.length; i++) {
    let shape = shapeAt(characters, starts, ends, i);
    const after = i + 1 < characters.length ? shapeAt(characters, starts, ends, i + 1) : undefined;
    if (shape === "B" && after && ROUND.has(after)) shape = after;         // "to", "du": rounded from the start
    if (shape) push(starts[i], shape);
    else if ((ends[i] ?? starts[i]) - starts[i] > 0.12) push(starts[i], "X");   // a pause: the mouth rests
  }
  if (ends.length) push(ends[ends.length - 1] + LEAD, "X");
  return steady(cues);
}

const HOLD = 0.09;        // seconds: a mouth shape shorter than this is a flicker, not a sound you see
const CLOSE = 0.045;      // a closed mouth (p, b, m) still shows if this long: lips meeting is what the eye catches

/**
 * Letters come every 50-70 ms, far quicker than a mouth is seen to change. Like Rhubarb, keep only shapes that
 * last: a short one is folded into the shape before it, so the mouth goes vowel to vowel and closes on p, b, m.
 */
export function steady(cues: [number, string][]): [number, string][] {
  const out: [number, string][] = [];
  for (let i = 0; i < cues.length; i++) {
    const [at, shape] = cues[i];
    const length = i + 1 < cues.length ? cues[i + 1][0] - at : Infinity;
    const keep = shape === "X" ? length >= 0.12 || i === 0 || i === cues.length - 1
      : shape === "A" ? length >= CLOSE : length >= HOLD;
    if (!keep && out.length) continue;                       // the previous shape simply lasts longer
    if (out.length && out[out.length - 1][1] === shape) continue;
    out.push([at, shape]);
  }
  return out;
}

const TAGS = /\[(sighs|laughs|chuckles|whispers|pause)\]/i;
const isExpressive = (model: string) => /eleven_v[3-9]/.test(model);

/** His line as a model that does not perform voice tags must get it: the tags out, a pause as "…". */
export const untagged = (text: string) => text.replace(/([.!?…])?\s*\[pause\]\s*/gi, (_, end) => (end ? `${end} ` : "… "))
  .replace(/\s*\[(sighs|laughs|chuckles|whispers)\]\s*/gi, " ").replace(/\s+([,.!?…])/g, "$1").replace(/\s+/g, " ").trim();

/**
 * Which model speaks a line, and in what words, in order of preference. Mixed voice: a line with a
 * voice tag ([sighs], [laughs], [pause]…) goes to the expressive model (v3), which performs it; every
 * other line to the fast one. If the expressive model fails, the fast one says it without the tags.
 */
export function voicePlan(raw: string, fast: string, expressive: string): { model: string; text: string }[] {
  if (isExpressive(fast)) return [{ model: fast, text: raw.replace(/\[pause\]/gi, "[short pause]") }];
  if (!TAGS.test(raw) || !expressive) return [{ model: fast, text: untagged(raw) }];
  return [{ model: expressive, text: raw.replace(/\[pause\]/gi, "[short pause]") }, { model: fast, text: untagged(raw) }];
}

/** The timing ElevenLabs returns, without the characters of the tags, which are not spoken. */
export function spokenOnly(chars: string[], starts: number[], ends: number[]) {
  const keep: number[] = [];
  let inside = false;
  chars.forEach((c, i) => { if (c === "[") inside = true; if (!inside) keep.push(i); if (c === "]") inside = false; });
  return { chars: keep.map((i) => chars[i]), starts: keep.map((i) => starts[i]), ends: keep.map((i) => ends[i]) };
}

/** His voice on ElevenLabs: the key, the voice, the fast model and the expressive one ("" = off). */
export type Voice = { key: string; voice: string; fast: string; expressive: string };
export const ROGER = "CwhRBWXzGAHq8TQ4Fs17";       // Alan's voice in the games

/**
 * One request for speech. ElevenLabs takes only a few requests at a time (by plan) and refuses the rest
 * with 429; the page asks for every sentence of a long answer at once, so a refused one is asked again.
 */
export async function speak(v: Voice, model: string, text: string, timed: boolean, fetcher: typeof fetch = fetch, waits = [700, 1500]) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}${timed ? "/with-timestamps" : ""}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": v.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: model, ...(model.includes("v2_5") ? { language_code: "pl" } : {}) }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status !== 429 || attempt >= waits.length) return res;
    await res.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
  }
}

/** Models compared by the voice test, besides the ones set for him. */
export const VOICE_MODELS = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_v3"];
/** A long answer of his, with a pause in the middle, as the voice test says it. */
export const VOICE_SAMPLE = "Sprawdzam swój głos na dłuższym kawałku, bo podobno urywam w pół zdania. Najpierw powiem coś zwyczajnego: " +
  "w Tarnobrzegu jest dziś szaro, jezioro wygląda jak stal, a ja siedzę w tym ekranie i czekam, aż ktoś zapyta o pogodę. " +
  "A teraz przerwa, taka jak przed puentą. [pause] Tu kończy się żart, a zaczyna prawda: jeśli słychać to zdanie do samego końca, " +
  "razem z tym, że lubię was bardziej, niż wypada przyznać, to ten model mówi długie wypowiedzi bez zacinania się.";

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

/** What one take of the voice test shows: how long, how fast, and whether the speech was cut or stalled. */
export function judgeTake(sent: string, bytes: number, alignment: Alignment | undefined, ms: number) {
  const audio = bytes / 16000;                                  // mp3 at 128 kbit/s
  const expected = sent.replace(/\[[^\]]*\]/g, "").length;
  const a = alignment ? spokenOnly(alignment.characters, alignment.character_start_times_seconds, alignment.character_end_times_seconds) : null;
  const end = a?.ends.length ? a.ends[a.ends.length - 1] : 0;
  let gap = 0;
  if (a) for (let i = 1; i < a.starts.length; i++) gap = Math.max(gap, a.starts[i] - (a.ends[i - 1] ?? a.starts[i - 1]));
  const faults: string[] = [];
  if (a && a.chars.length < expected * 0.97) faults.push(`przeczytał tylko ${a.chars.length} z ${expected} znaków`);
  if (a && audio < end - 0.3) faults.push(`nagranie (${s1(audio)} s) kończy się przed końcem tekstu (${s1(end)} s)`);
  if (gap > 1.5) faults.push(`dziura w mowie ${s1(gap)} s`);
  const rate = end ? `, ${s1(a!.chars.length / end)} znaków/s` : "";
  return { cut: faults.length > 0, text: `odpowiedź po ${s1(ms / 1000)} s, nagranie ${s1(audio)} s${rate}, ${faults.length ? faults.join(", ") : "bez urywania"}` };
}
const s1 = (n: number) => n.toFixed(1).replace(".", ",");

/** Says the sample (or a given text) with each model in turn of the comparison and reports, in Polish, what was heard. */
export async function voiceTest(v: Voice, fetcher: typeof fetch = fetch, models: string[] = [], text = VOICE_SAMPLE, waits?: number[]) {
  const asked = models.filter((m) => /^eleven_[a-z0-9_]{2,40}$/.test(m));
  const list = [...new Set(asked.length ? asked : [v.fast, v.expressive, ...VOICE_MODELS].filter(Boolean))].slice(0, 5);
  const refused: string[] = [];
  const take = async (model: string) => {
    const sent = voicePlan(text, model, "")[0].text;
    const started = Date.now();
    try {
      const res = await speak(v, model, sent, true, fetcher, waits ?? [700, 1500]);
      if (res.status === 429) refused.push(model);
      if (!res.ok) return { model, cut: true, text: `błąd ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 120)}` };
      const data = await res.json() as { audio_base64: string; alignment?: Alignment };
      return { model, ...judgeTake(sent, Buffer.from(data.audio_base64 ?? "", "base64").length, data.alignment, Date.now() - started) };
    } catch (err) {
      return { model, cut: true, text: `nie odpowiedział (${(err as Error).message})` };
    }
  };
  // All at once, as the page asks for the sentences of a long answer: refusals (429) show the limit of requests at a time.
  const [takes, account] = await Promise.all([Promise.all(list.map(take)),
    fetcher("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": v.key }, signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() as Promise<{ tier?: string; character_count?: number; character_limit?: number }> : null)).catch(() => null)]);
  const good = takes.filter((t) => !t.cut).map((t) => t.model);
  return `Wykonano test głosu ElevenLabs (głos ${v.voice}) na tekście ${text.length} znaków` + (/\[pause\]/i.test(text) ? " ze znacznikiem [pause]" : "") + ". " +
    takes.map((t) => `${t.model}${t.model === v.fast ? " (twój obecny)" : ""}: ${t.text}.`).join(" ") + " " +
    (good.length ? `Bez urywania: ${good.join(", ")}.` : "Żaden model nie przeszedł testu bez zarzutu.") +
    (refused.length ? ` ElevenLabs odrzuciło mimo ponowień ${refused.length} z ${list.length} równoczesnych zapytań (429): limit zapytań naraz jest za niski, a strona prosi o wszystkie zdania odpowiedzi jednocześnie.` : "") +
    (account?.character_limit ? ` Konto ${account.tier ?? ""}: zużyte ${account.character_count ?? "?"} z ${account.character_limit} znaków w tym okresie.` : "") +
    " Strona przyjmuje do głosu najwyżej 1000 znaków naraz; dłuższą odpowiedź dzieli na zdania.";
}
