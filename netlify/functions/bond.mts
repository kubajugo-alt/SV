// His journal and "kim się staję", for the J window:
//   GET  /bond                         -> who he is becoming (with earlier versions) and the journal of each person
//   POST /bond {undo: true}            -> back to the previous version of "kim się staję"
//   POST /bond {forget: {person, at, text}} -> crosses one moment out of the journal
//   POST /bond {reflect: true}         -> rewrite "kim się staję" now instead of on Sunday
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { forgetMoment, loadBond, loadSelf, people, undoBecoming } from "../lib/bond.mts";
import { mind } from "../lib/env.mts";
import { reflect } from "../lib/mind.mts";
import { blobStore } from "../lib/store.mts";

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const store = blobStore();
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { undo?: boolean; reflect?: boolean; forget?: { person?: string; at?: string; text?: string } };
    if (body.undo) await undoBecoming(store);
    else if (body.reflect) console.log(`Reflection (by hand): ${await reflect(mind(), new Date())}`);
    else if (body.forget && /^[a-ząćęłńóśźż]{1,24}$/.test(body.forget.person ?? "")) await forgetMoment(store, body.forget.person!, String(body.forget.at), String(body.forget.text));
    else return Response.json({ error: "nie wiem, co zrobić" }, { status: 400 });
  }
  const journals: Record<string, unknown> = {};
  for (const person of await people(store)) journals[person] = (await loadBond(store, person)).moments.slice().reverse();
  return Response.json({ self: await loadSelf(store), journals });
};

export const config: Config = { path: "/bond", method: ["GET", "POST"] };
