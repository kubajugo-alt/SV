// Phone calls on the household's behalf: an ElevenLabs agent with his voice rings a number
// (through a Twilio number or verified caller ID imported into ElevenLabs) and does one errand.
// A call is placed only after the person confirmed it in a later turn than the one that proposed it.

export type Phone = { key: string; agent: string; number: string };
export type Call = { id: string; at: string; person: string; name: string; number: string; task: string; told: boolean };
export type PendingCall = { at: string; person: string; name: string; number: string; task: string };

export const CALLS_A_DAY = 6;

/** A Polish landline or mobile number as +48 and nine digits; nothing premium-rate, short or foreign. */
export function polishNumber(given: unknown): string | null {
  let digits = String(given ?? "").replace(/[\s().-]/g, "");
  if (digits.startsWith("+48")) digits = digits.slice(3);
  else if (digits.startsWith("0048")) digits = digits.slice(4);
  if (!/^\d{9}$/.test(digits)) return null;
  if (/^(0|70|80|30|40)/.test(digits)) return null;            // premium-rate, shared-cost and special services
  return "+48" + digits;
}

const headers = (phone: Phone) => ({ "xi-api-key": phone.key, "Content-Type": "application/json" });

/** Ring the number; resolves with the conversation's id once ElevenLabs has started the call. */
export async function placeCall(phone: Phone, call: PendingCall, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: headers(phone),
    body: JSON.stringify({
      agent_id: phone.agent, agent_phone_number_id: phone.number, to_number: call.number,
      conversation_initiation_client_data: { dynamic_variables: { task: call.task, callee: call.name, household: call.person.charAt(0).toUpperCase() + call.person.slice(1) } },
    }),
  });
  if (!res.ok) throw new Error(`centrala odpowiedziała ${res.status}`);
  const out = await res.json();
  if (!out.success || !out.conversation_id) throw new Error(String(out.message || "połączenie nie zostało rozpoczęte").slice(0, 200));
  return out.conversation_id;
}

/** How a call went: null while it is still on, otherwise a sentence. */
export async function callOutcome(phone: Phone, id: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`, { headers: headers(phone) });
  if (!res.ok) throw new Error(`centrala odpowiedziała ${res.status}`);
  const talk = await res.json();
  if (talk.status === "failed") return "połączenie się nie udało, nikt nie odebrał albo linia była zajęta";
  if (talk.status !== "done") return null;
  const summary = String(talk.analysis?.transcript_summary ?? "").trim();
  const heard = ((talk.transcript ?? []) as { role: string; message?: string }[]).filter((t) => t.role === "user" && t.message).map((t) => t.message).join(" ").slice(0, 600);
  if (!heard) return "nikt się nie odezwał";
  const verdict = talk.analysis?.call_successful === "failure" ? "Nie udało się załatwić sprawy. " : "";
  return verdict + (summary || `Rozmówca powiedział: ${heard}`);
}
