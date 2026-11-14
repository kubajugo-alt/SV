import assert from "node:assert/strict";
import { test } from "node:test";
import { heard } from "../functions/stt.mts";

test("without tagged sounds the text is passed on as Scribe wrote it", () => {
  assert.deepEqual(heard({ text: " Alan, która godzina? " }), { text: "Alan, która godzina?", tone: "" });
  assert.deepEqual(heard({ text: "dobra", words: [{ text: "dobra", type: "word" }] }), { text: "dobra", tone: "" });
});

test("a laugh and a sigh come out of the words and into a short Polish tone prefix", () => {
  const words = [
    { text: "(laughter)", type: "audio_event" }, { text: " ", type: "spacing" },
    { text: "no", type: "word" }, { text: " ", type: "spacing" }, { text: "dobra", type: "word" },
    { text: " ", type: "spacing" }, { text: "(sighs)", type: "audio_event" }, { text: "(laughs)", type: "audio_event" },
  ];
  assert.deepEqual(heard({ text: "(laughter) no dobra (sighs)(laughs)", words }), { text: "no dobra", tone: "[śmiech] [westchnienie]" });
});

test("only a sound, no words: the tone alone", () => {
  assert.deepEqual(heard({ text: "(cough)", words: [{ text: "(cough)", type: "audio_event" }] }), { text: "", tone: "[kaszel]" });
});
