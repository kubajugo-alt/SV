// GET /agenda -> what he should say now (timers and reminders come due) and the running timers.
import type { Config } from "@netlify/functions";
import { guard } from "../lib/auth.mts";
import { blobStore } from "../lib/store.mts";
import { agenda } from "../lib/tools.mts";

export default async (req: Request) => guard(req) ?? Response.json(await agenda(blobStore(), new Date()));

export const config: Config = { path: "/agenda", method: "GET" };
