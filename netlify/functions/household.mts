// GET /household -> {text}: what he is told about the people.  PUT /household {text} replaces it.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { blobStore } from "../lib/store.mts";

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const store = blobStore();
  if (req.method === "GET") return Response.json({ text: (await store.get<string>("household")) ?? "" });
  let text = "";
  try { text = String((await req.json()).text ?? ""); } catch { return Response.json({ error: "expected JSON" }, { status: 400 }); }
  if (text.length > 12000) return Response.json({ error: "at most 12000 characters" }, { status: 400 });
  await store.set("household", text);
  return new Response(null, { status: 204 });
};

export const config: Config = { path: "/household", method: ["GET", "PUT"] };
