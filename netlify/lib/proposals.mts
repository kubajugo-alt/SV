// The changes to himself that he asked the programmer for: pull requests from branches
// named alan/..., read from GitHub, and merged when the household approves one.

export type GitHub = { token: string; repo: string };
export type Proposal = { number: number; title: string; body: string; url: string; state: "building" | "ready" | "failing" };

type Pull = { number: number; title: string; body: string | null; html_url: string; draft: boolean; state: string; node_id: string;
  head: { ref: string; sha: string; repo: { full_name: string } | null } };

const api = (gh: GitHub, fetcher: typeof fetch) => (path: string, init: RequestInit = {}) =>
  fetcher(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "alan-home", ...(init.body ? { "Content-Type": "application/json" } : {}) } });

/** His own proposals only: from a branch alan/... of this repository, never from a fork. */
const his = (gh: GitHub, pull: Pull) => pull.head.ref.startsWith("alan/") && pull.head.repo?.full_name.toLowerCase() === gh.repo.toLowerCase();

/** Whether the tests of that commit have passed: nothing is approved before they have. */
async function checks(call: ReturnType<typeof api>, gh: GitHub, sha: string): Promise<Proposal["state"]> {
  const res = await call(`/repos/${gh.repo}/actions/runs?head_sha=${sha}&per_page=20`);
  if (!res.ok) throw new Error(`GitHub odpowiedział ${res.status}`);
  const runs = ((await res.json()).workflow_runs ?? []) as { status: string; conclusion: string | null }[];
  if (!runs.length || runs.some((r) => r.status !== "completed")) return "building";
  return runs.every((r) => r.conclusion === "success" || r.conclusion === "skipped") ? "ready" : "failing";
}

export async function listProposals(gh: GitHub, fetcher: typeof fetch = fetch): Promise<Proposal[]> {
  const call = api(gh, fetcher);
  const res = await call(`/repos/${gh.repo}/pulls?state=open&per_page=50`);
  if (!res.ok) throw new Error(`GitHub odpowiedział ${res.status}`);
  const pulls = ((await res.json()) as Pull[]).filter((p) => his(gh, p)).slice(0, 10);
  return Promise.all(pulls.map(async (p) => ({ number: p.number, title: p.title, body: (p.body ?? "").slice(0, 3000), url: p.html_url, state: await checks(call, gh, p.head.sha) })));
}

/** Merge one of his proposals, exactly the commit whose tests passed. */
export async function approveProposal(gh: GitHub, number: number, fetcher: typeof fetch = fetch): Promise<string> {
  const call = api(gh, fetcher);
  const res = await call(`/repos/${gh.repo}/pulls/${number}`);
  if (res.status === 404) throw new Error("nie ma takiej propozycji");
  if (!res.ok) throw new Error(`GitHub odpowiedział ${res.status}`);
  const pull = (await res.json()) as Pull;
  if (pull.state !== "open" || !his(gh, pull)) throw new Error("to nie jest otwarta propozycja Alana");
  const state = await checks(call, gh, pull.head.sha);
  if (state !== "ready") throw new Error(state === "failing" ? "testy tej propozycji nie przechodzą" : "testy tej propozycji jeszcze trwają");
  if (pull.draft) {                                   // a draft cannot be merged; only GraphQL can mark it ready
    const ready = await call("/graphql", { method: "POST", body: JSON.stringify({
      query: "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }", variables: { id: pull.node_id } }) });
    if (!ready.ok || (await ready.json()).errors) throw new Error("nie udało się oznaczyć propozycji jako gotowej");
  }
  const merged = await call(`/repos/${gh.repo}/pulls/${number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha: pull.head.sha }) });
  if (!merged.ok) throw new Error(merged.status === 409 ? "propozycja zmieniła się w międzyczasie; odśwież listę" : `GitHub nie scalił propozycji (${merged.status})`);
  return pull.title;
}
