// POST /chat  {text, person, tz} -> {reply, actions}; {nudge, person, tz} lets him speak first.
// With stream: true the answer comes sentence by sentence, so he can start speaking sooner.
import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { guard } from "../lib/auth.mts";
import { mind, who } from "../lib/env.mts";
import { nudge, respond } from "../lib/mind.mts";

/** His mind, knowing the page's address for links to documents he makes. */
const site = (req: Request) => ({ ...mind(), site: new URL(req.url).origin });

export default async (req: Request, context: Context) => {
  const denied = guard(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "expected JSON" }, { status: 400 }); }
  const kind = String(body.nudge ?? "");
  const text = kind ? "" : String(body.text ?? "").trim();
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
        const send = (data: object) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        try {
          const result = await respond(site(req), whom, text, (say) => send({ say }));
          send({ reply: result.reply, actions: result.actions });
          context.waitUntil(result.after());
        } catch (err) {
          failed(err);
          send({ error: "the language model did not answer" });
        }
        controller.close();
      },
    });
    return new Response(lines, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  }
  try {
    const result = kind ? await nudge(site(req), whom, kind) : await respond(site(req), whom, text);
    context.waitUntil(result.after());          // folding old turns into notes need not hold the answer up
    return Response.json({ reply: result.reply, actions: "actions" in result ? result.actions : [] });
  } catch (err) {
    failed(err);
    return Response.json({ error: "the language model did not answer" }, { status: 502 });
  }
};

export const config: Config = { path: "/chat", method: "POST" };
