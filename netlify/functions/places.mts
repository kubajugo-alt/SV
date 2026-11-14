// GET /places -> {count, at}: how many places he knows and from when.  GET /places?refresh=1 downloads the list afresh.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { loadPlaces } from "../lib/places.mts";
import { blobStore } from "../lib/store.mts";

export default async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const places = await loadPlaces(blobStore(), new Date(), fetch, new URL(req.url).searchParams.get("refresh") === "1");
  return Response.json({ count: places?.rows.length ?? 0, at: places?.at ?? null });
};

export const config: Config = { path: "/places", method: "GET" };
