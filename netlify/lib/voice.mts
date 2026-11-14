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
