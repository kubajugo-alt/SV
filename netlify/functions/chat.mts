// POST /chat  {text, person, tz} -> {reply, actions}; {nudge, person, tz} lets him speak first.
// With stream: true the answer comes sentence by sentence, so he can start speaking sooner.
import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { guard } from "../lib/auth.mts";
import { mind, who } from "../lib/env.mts";
import { fillerTopic, nudge, respond, sentenceCutter } from "../lib/mind.mts";

export default async (req: Request, context: Context) => {
  const denied = guard(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "expected JSON" }, { status: 400 }); }
  const kind = String(body.nudge ?? "");
  const text = kind ? "" : String(body.text ?? "").trim();
  const interrupted = typeof body.interrupted === "string" ? body.interrupted : undefined;   // he was cut off mid-reply: what he had said by then
  if ((!text && !kind) || text.length > 2000) return Response.json({ error: "text must be 1-2000 characters" }, { status: 400 });
  const whom = who(body.person, body.tz);
  const failed = (err: unknown) => {
    if (err instanceof Anthropic.AuthenticationError) console.log("Claude rejected the key (ANTHROPIC_API_KEY).");
    else if (err instanceof Anthropic.RateLimitError) console.log("Claude: rate limited.");
    else if (err instanceof Anthropic.APIError) console.log(`Claude answered ${err.status}: ${err.message}`);
    else console.log(`Chat failed: ${(err as Error).message}`);
  };
  if (body.stream && !kind) {
    // One JSON object per line: {"say": sentence} as each sentence is written, then {"reply", "actions"}.
    const encoder = new TextEncoder();
    const lines = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true, saying = false;
        const send = (data: object) => { if (open) controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); };
        const cutter = sentenceCutter((say) => { saying = true; send({ say }); });
        const brain = mind();
        // In parallel: which thinking line fits, so the page can say one while he works it out.
        fillerTopic(brain, text).then((topic) => { if (topic && !saying) send({ filler: topic }); }).catch(() => {});
        try {
          const result = await respond(brain, whom, text, (delta) => cutter.add(delta), interrupted);
          cutter.end();
          send({ reply: result.reply, actions: result.actions });
          context.waitUntil(result.after());
        } catch (err) {
          failed(err);
          send({ error: "the language model did not answer" });
        }
        open = false;
        controller.close();
      },
    });
    return new Response(lines, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  }
  try {
    const result = kind ? await nudge(mind(), whom, kind, Math.max(0, Math.min(100000, Number(body.away) || 0))) : await respond(mind(), whom, text, undefined, interrupted);
    context.waitUntil(result.after());          // folding old turns into notes need not hold the answer up
    return Response.json({ reply: result.reply, actions: "actions" in result ? result.actions : [] });
  } catch (err) {
    failed(err);
    return Response.json({ error: "the language model did not answer" }, { status: 502 });
  }
};

export const config: Config = { path: "/chat", method: "POST" };
