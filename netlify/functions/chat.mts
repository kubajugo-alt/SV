// POST /chat  {text, person, tz} -> {reply, actions}; {nudge, person, tz} lets him speak first.
import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { guard } from "../lib/auth.mts";
import { mind, who } from "../lib/env.mts";
import { nudge, respond } from "../lib/mind.mts";

export default async (req: Request, context: Context) => {
  const denied = guard(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "expected JSON" }, { status: 400 }); }
  const kind = String(body.nudge ?? "");
  const text = kind ? "" : String(body.text ?? "").trim();
  if ((!text && !kind) || text.length > 2000) return Response.json({ error: "text must be 1-2000 characters" }, { status: 400 });
  const whom = who(body.person, body.tz);
  try {
    const result = kind ? await nudge(mind(), whom, kind) : await respond(mind(), whom, text);
    context.waitUntil(result.after());          // folding old turns into notes need not hold the answer up
    return Response.json({ reply: result.reply, actions: "actions" in result ? result.actions : [] });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.log("Claude rejected the key (ANTHROPIC_API_KEY).");
    else if (err instanceof Anthropic.RateLimitError) console.log("Claude: rate limited.");
    else if (err instanceof Anthropic.APIError) console.log(`Claude answered ${err.status}: ${err.message}`);
    else console.log(`Chat failed: ${(err as Error).message}`);
    return Response.json({ error: "the language model did not answer" }, { status: 502 });
  }
};

export const config: Config = { path: "/chat", method: "POST" };
