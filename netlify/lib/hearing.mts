// What ElevenLabs Scribe heard: the words, and the sounds that were not words (a laugh, a sigh).
// Scribe names its events in English; the household speaks Polish. Others pass as they come.
const EVENTS: [RegExp, string][] = [
  [/laugh|chuckl|giggl|śmiech/i, "śmiech"],
  [/sigh|westchn/i, "westchnienie"],
  [/cough|kaszel/i, "kaszel"],
  [/yawn|ziew/i, "ziewnięcie"],
  [/cry|sob|płacz/i, "płacz"],
  [/clap|oklaski/i, "oklaski"],
];

type Word = { text?: string; type?: string };

/** The words, and the sounds that were not words, of a Scribe answer. */
export function heard(answer: { text?: string; words?: Word[] }) {
  const words = Array.isArray(answer.words) ? answer.words : [];
  const events = words.filter((w) => w.type === "audio_event").map((w) => String(w.text ?? "").replace(/[()[\]]/g, "").trim()).filter(Boolean);
  if (!events.length) return { text: String(answer.text ?? "").trim(), tone: "" };
  const text = words.filter((w) => w.type !== "audio_event").map((w) => w.text ?? "").join("").replace(/\s+/g, " ").trim();
  const named = events.map((e) => EVENTS.find(([pattern]) => pattern.test(e))?.[1] ?? e.toLowerCase().slice(0, 20));
  const tone = [...new Set(named)].slice(0, 2).map((e) => `[${e}]`).join(" ");
  return { text, tone };
}
