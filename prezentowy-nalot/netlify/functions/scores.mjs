// Online scoreboard for Świąteczna Przygoda Kaczorów: GET /api/scores lists the top 25, POST upserts a player's best total.
import { getStore } from "@netlify/blobs";

const MAX_SCORE = 250000; // 12 parts; the shoot 'em ups score highest, this leaves a wide margin
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
const top = (board) => Object.entries(board).map(([id, e]) => ({ id, ...e })).sort((a, b) => b.score - a.score || a.ts - b.ts);

export default async (req) => {
  const store = getStore({ name: "pn-scores", consistency: "strong" });
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
  const parts = Math.max(0, Math.min(12, Math.round(Number(b.parts) || 0)));
  const stars = Math.max(0, Math.min(60, Math.round(Number(b.stars) || 0)));
  if (id.length < 8 || !name || !Number.isFinite(score) || score < 0 || score > MAX_SCORE) return json({ error: "invalid" }, 400);
  const prev = board[id];
  board[id] = { name, score: Math.max(score, prev?.score || 0), parts: Math.max(parts, prev?.parts || 0), stars: Math.max(stars, prev?.stars || 0), ts: prev && prev.score >= score ? prev.ts : Date.now() };
  await store.setJSON("board", board);
  const list = top(board);
  return json({ ok: true, rank: list.findIndex((e) => e.id === id) + 1, total: list.length });
};

export const config = { path: "/api/scores" };
