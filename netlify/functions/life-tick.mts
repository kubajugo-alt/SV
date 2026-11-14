// A few times a day, with nobody talking to him, he lives a little: his book, the window, his mood,
// now and then news from Lisbon (lib/life.mts). On Netlify's schedule; no address of its own.
import type { Config } from "@netlify/functions";
import { mind } from "../lib/env.mts";
import { live } from "../lib/mind.mts";

export default async () => {
  try { console.log(`Life: ${await live(mind(), new Date())}`); }
  catch (err) { console.log(`Life failed: ${(err as Error).message}`); }
};

// 7:50, 10:50, 13:50, 16:50, 19:50 and 22:50 UTC: morning to late evening in Poland, and one at night.
export const config: Config = { schedule: "50 1,7,10,13,16,19,22 * * *" };
