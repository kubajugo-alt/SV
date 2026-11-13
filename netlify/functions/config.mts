// GET /js/config.local.js -> the page's settings for the cloud: no flat to read, timers polled
// less often (each poll is a function call), the microphone on push-to-talk by default so that
// only what is meant for him is sent for recognition.
import type { Config } from "@netlify/functions";

const SETTINGS = { cloud: true, home: "", handsfree: false, agendaEvery: 15000 };

export default async () => new Response(`export default ${JSON.stringify(SETTINGS)};\n`, {
  headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
});

export const config: Config = { path: "/js/config.local.js", method: "GET" };
