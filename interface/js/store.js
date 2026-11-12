// Single source of truth for the page. Feeds write, avatar + UI read.

const state = {
  alan: 'idle',      // idle | listening | thinking | speaking — as reported by the feed
  flat: 'normal',    // flat_state
  alerts: {},        // id -> { kind, room } for every safety sensor currently tripped
  text: '',          // what ALAN is saying / last said
  utterance: 0,      // bumped by every say(), so repeated lines still retype
  speakingUntil: 0,  // performance.now() deadline of the local speech envelope
  preparing: false,  // a line's audio is being synthesised — shown as thinking
  timers: [],        // running timers: [{ label, endsAt (ms) }]
  actions: [],       // what ALAN did in the last exchange: [{ ok, text }]
  rooms: {},         // room -> { temp, hum, light?: { on, pct }, heating? }
  presence: {},      // person -> bool
  co2: null,
  outdoor: null,
  battery: null,
  link: 'demo',      // solo | demo | connecting | online | offline
  person: 'kuba',    // who he is talking with; each person has their own memory
  handsfree: false,  // listening for his name instead of waiting for Space
  initiative: true,  // whether he may speak first
  busy: false,       // an exchange with the model is under way
};

const listeners = new Set();

export const store = {
  get: () => state,
  set(patch) {
    Object.assign(state, patch);
    listeners.forEach((fn) => fn(state));
  },
  subscribe(fn) {
    listeners.add(fn);
    fn(state);
  },
};

// 60 Hz audio level lives outside the store so it never triggers UI renders.
// `mouth` is the current Rhubarb shape (A-H, X) while a line with cues plays, else null.
export const signal = { level: 0, mouth: null };

/** Studio discipline: black screen, no rendering — unless something is on fire. */
export function isDark(config, s = state) {
  return config.darkModes.includes(s.flat) && !Object.keys(s.alerts).length;
}

/** What the screen should show right now: alert > local speech > preparing a line > feed state. */
export function mode(s = state, now = performance.now()) {
  if (Object.keys(s.alerts).length) return 'alert';
  if (now < s.speakingUntil) return 'speaking';
  if (s.preparing) return 'thinking';
  return s.alan === 'speaking' ? 'idle' : s.alan;
}
