// Online scoreboard for Kaczor do sauny!: GET /api/scores lists the top 25, POST upserts a player's best total.
import { getStore } from "@netlify/blobs";

const MAX_SCORE = 60000; // 10 levels × (1000 + whisks + golden ladle + boss) × 1.5 leaves a wide margin below this
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
const top = (board) => Object.entries(board).map(([id, e]) => ({ id, ...e })).sort((a, b) => b.score - a.score || a.ts - b.ts);

export default async (req) => {
  const store = getStore({ name: "kaczor-scores", consistency: "strong" });
  const board = (await store.get("board", { type: "json" })) || {};
  if (req.method === "GET") {
    const list = top(board);
    const me = new URL(req.url).searchParams.get("id");
    const rank = me ? list.findIndex((e) => e.id === me) + 1 : 0;
    return json({ top: list.slice(0, 25).map(({ id, ...e }) => ({ ...e, me: id === me })), rank, total: list.length });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const id = String(b.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const name = clean(b.name);
  const score = Math.round(Number(b.score));
  const levels = Math.max(0, Math.min(10, Math.round(Number(b.levels) || 0)));
  const stars = Math.max(0, Math.min(30, Math.round(Number(b.stars) || 0)));
  if (id.length < 8 || !name || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) return json({ error: "invalid" }, 400);
  const prev = board[id];
  board[id] = { name, score: Math.max(score, prev?.score || 0), levels: Math.max(levels, prev?.levels || 0), stars: Math.max(stars, prev?.stars || 0), ts: prev && prev.score >= score ? prev.ts : Date.now() };
  await store.setJSON("board", board);
  const list = top(board);
  return json({ ok: true, rank: list.findIndex((e) => e.id === id) + 1, total: list.length, top: list.slice(0, 25).map(({ id: k, ...e }) => ({ ...e, me: k === id })) });
};

export const config = { path: "/api/scores" };
