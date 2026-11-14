// Where ALAN keeps what he knows in the cloud: Netlify Blobs, one small JSON
// document per kind of thing. A household of two talks to him one at a time,
// so a document is read, changed and written back without locking.
//   talk/<person>            notes + the recent turns he is given verbatim
//   log/<person>/<YYYY-MM>   every turn, for searching old conversations
//   own                      reminders, lists, remembered facts, notes, place
//   household                what he is told about the people (private text)
import type { Call, PendingCall } from "./phone.mts";
import type { PlaceNote } from "./places.mts";
import type { OwnEvent } from "./owncal.mts";
import { getStore } from "@netlify/blobs";

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete?(key: string): Promise<void>;
}

export function blobStore(): Store {
  const store = getStore({ name: "alan", consistency: "strong" });
  return {
    get: (key) => store.get(key, { type: "json" }),
    set: async (key, value) => { await store.setJSON(key, value); },
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
    delete: async (key) => { await store.delete(key); },
  };
}

/** For tests and local runs. */
export function memoryStore(seed: Record<string, unknown> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    get: async (key) => (data.has(key) ? JSON.parse(data.get(key)!) : null),
    set: async (key, value) => { data.set(key, JSON.stringify(value)); },
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    delete: async (key) => { data.delete(key); },
  };
}

/** An order the household likes: what, from where, and the page (Glovo, Uber Eats...) where it is ordered. */
export type Tune = { name: string; id: string; kind: "video" | "list"; who: string; at: string; used?: string };
export type Favourite = { name: string; place: string; what: string; url: string; who: string; at: string; used?: string };

export type Turn = { role: "user" | "assistant"; text: string; at: string };
export type Talk = { notes: string; turns: Turn[] };
export type Reminder = { id: number; person: string; kind: "timer" | "reminder"; due: string; text: string; done: boolean };
export type Own = {
  seq: number;
  reminders: Reminder[];
  lists: Record<string, string[]>;
  facts: Record<string, string[]>;
  jottings: Record<string, { text: string; at: string }[]>;
  place: { name: string; where: string; lat: number; lon: number; tz: string; who?: string } | null;   // who: the one who is there (the others are at home)
  calls: Call[];                       // phone calls he made, newest last
  pendingCall: PendingCall | null;     // a call he proposed and waits to have confirmed
  placeNotes: PlaceNote[];             // what the household said about places
  favourites: Favourite[];
  music: Tune[];                       // playlists and songs the household asked him to remember, by name             // food the household orders again and again, with the link to order it
  events: OwnEvent[];                  // his own calendar
};

/** Where this person is: the saved place if it is theirs (or nobody's), else home (null). */
export const placeOf = (own: Own, person: string) => (own.place && (!own.place.who || own.place.who === person) ? own.place : null);
export const emptyOwn = (): Own => ({ seq: 0, reminders: [], lists: {}, facts: {}, jottings: {}, place: null, calls: [], pendingCall: null, placeNotes: [], events: [], favourites: [], music: [] });
export const loadOwn = async (store: Store): Promise<Own> => ({ ...emptyOwn(), ...((await store.get<Own>("own")) ?? {}) });
export const loadTalk = async (store: Store, person: string): Promise<Talk> => (await store.get<Talk>(`talk/${person}`)) ?? { notes: "", turns: [] };
