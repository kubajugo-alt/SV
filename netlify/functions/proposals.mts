// GET /proposals -> {proposals: [{number, title, body, url, state}]}: the changes to himself waiting for approval.
// POST /proposals {approve: number} merges one, once its tests have passed.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { approveProposal, listProposals } from "../lib/proposals.mts";

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const gh = { token: Netlify.env.get("ALAN_GITHUB_TOKEN") ?? "", repo: Netlify.env.get("ALAN_GITHUB_REPO") ?? "kubajugo-alt/SV" };
  if (!gh.token) return Response.json({ error: "ALAN_GITHUB_TOKEN is not set for this site" }, { status: 503 });
  try {
    if (req.method === "GET") return Response.json({ proposals: await listProposals(gh) }, { headers: { "Cache-Control": "no-store" } });
    let number = 0;
    try { number = Number((await req.json()).approve); } catch { /* answered below */ }
    if (!Number.isInteger(number) || number < 1) return Response.json({ error: "expected {approve: number}" }, { status: 400 });
    const title = await approveProposal(gh, number);
    console.log(`Proposal #${number} approved: ${title}`);
    return Response.json({ approved: number, title });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
};

export const config: Config = { path: "/proposals", method: ["GET", "POST"] };
