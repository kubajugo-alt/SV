// Mouth shapes from the timing ElevenLabs returns with the audio: each character
// of the line with the moment it is spoken. Polish spelling is close to its
// sounds, so the letters give the shapes (Rhubarb's set: A closed, B teeth,
// C open, D wide, E rounded, F puckered, X at rest). The same table as serve.py.
import { plain } from "./words.mts";

const MOUTH: Record<string, string> = {
  sz: "B", cz: "B", rz: "B", ch: "B", dz: "B",
  a: "D", e: "C", i: "B", y: "B", o: "E", u: "F", l: "C",
  p: "A", b: "A", m: "A",
};
for (const c of "cdfghjknrstwzvxq") MOUTH[c] = "B";
// Letters that lose their accent in plain(): ę -> e (C), ó -> u-like (F), ą -> o-like (E), ł -> w-like (F).
const ACCENTED: Record<string, string> = { "ó": "F", "ą": "E", "ł": "F" };

export function cuesFromCharacters(characters: string[], starts: number[], ends: number[]): [number, string][] {
  const cues: [number, string][] = [[0, "X"]];
  const push = (t: number, shape: string) => { if (cues[cues.length - 1][1] !== shape) cues.push([Math.round(t * 100) / 100, shape]); };
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i].toLowerCase();
    const next = (characters[i + 1] ?? "").toLowerCase();
    const shape = ACCENTED[ch] ?? MOUTH[plain(ch + next)] ?? MOUTH[plain(ch)];
    if (shape) push(starts[i], shape);
    else if ((ends[i] ?? starts[i]) - starts[i] > 0.12) push(starts[i], "X");   // a pause: the mouth rests
  }
  if (ends.length) push(ends[ends.length - 1], "X");
  return cues;
}
