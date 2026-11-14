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
const HELD = 0.09;                       // seconds: shorter than this, an "a" is only half open and an "e" barely
// Letters that lose their accent in plain(): ę -> e (C), ó -> u-like (F), ą -> o-like (E), ł -> w-like (F).
const ACCENTED: Record<string, string> = { "ó": "F", "ą": "E", "ł": "F" };

export function cuesFromCharacters(characters: string[], starts: number[], ends: number[]): [number, string][] {
  const cues: [number, string][] = [[0, "X"]];
  const push = (t: number, shape: string) => { if (cues[cues.length - 1][1] !== shape) cues.push([Math.round(t * 100) / 100, shape]); };
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i].toLowerCase();
    const next = (characters[i + 1] ?? "").toLowerCase();
    let shape = ACCENTED[ch] ?? MOUTH[plain(ch + next)] ?? MOUTH[plain(ch)];
    const held = (ends[i] ?? starts[i]) - starts[i];
    if (held < HELD && shape === "D") shape = "C";
    else if (held < HELD * 0.6 && shape === "C" && plain(ch) === "e") shape = "B";
    if (shape) push(starts[i], shape);
    else if ((ends[i] ?? starts[i]) - starts[i] > 0.12) push(starts[i], "X");   // a pause: the mouth rests
  }
  if (ends.length) push(ends[ends.length - 1], "X");
  return cues;
}
