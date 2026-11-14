// Sundays at 4:20 UTC: he rewrites "kim się staję" from his journal (lib/bond.mts). On Netlify's schedule.
import type { Config } from "@netlify/functions";
import { mind } from "../lib/env.mts";
import { reflect } from "../lib/mind.mts";

export default async () => {
  try { console.log(`Reflection: ${await reflect(mind(), new Date())}`); }
  catch (err) { console.log(`Reflection failed: ${(err as Error).message}`); }
};

export const config: Config = { schedule: "20 4 * * 0" };
