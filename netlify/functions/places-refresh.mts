// Once a week: download the list of places afresh. Runs on Netlify's schedule; it has no address of its own.
import type { Config } from "@netlify/functions";
import { loadPlaces } from "../lib/places.mts";
import { blobStore } from "../lib/store.mts";

export default async () => {
  const places = await loadPlaces(blobStore(), new Date(), fetch, true);
  console.log(`Places: ${places?.rows.length ?? 0}, from ${places?.at ?? "never"}`);
};

export const config: Config = { schedule: "@weekly" };
