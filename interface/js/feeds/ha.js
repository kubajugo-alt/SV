// Home Assistant feed: HA's native WebSocket API (spec §33 "one state feed").
// Reads entity states for the panel + alerts, and the custom `alan_avatar`
// event for speech and live levels. Read-only: the kiosk never calls services.

import { store } from '../store.js';
import { say, level } from '../speech.js';

const float = (s) => {
  const v = parseFloat(s?.state);
  return Number.isFinite(v) ? v : null;
};

/** entity_id -> function applying that entity's state object to the store. */
function buildHandlers(e) {
  const h = {};
  h[e.alan] = (s) => store.set({ alan: s.state });
  h[e.flat] = (s) => store.set({ flat: s.state });
  for (const [room, ids] of Object.entries(e.rooms)) {
    for (const [field, id] of Object.entries(ids)) {
      h[id] = (s) => {
        const rooms = store.get().rooms;
        store.set({ rooms: { ...rooms, [room]: { ...rooms[room], [field]: float(s) } } });
      };
    }
  }
  for (const [person, id] of Object.entries(e.presence)) {
    h[id] = (s) => store.set({ presence: { ...store.get().presence, [person]: s.state === 'home' } });
  }
  for (const field of ['co2', 'outdoor', 'battery']) {
    if (e[field]) h[e[field]] = (s) => store.set({ [field]: float(s) });
  }
  for (const [id, alert] of Object.entries(e.alerts)) {
    h[id] = (s) => {
      const alerts = { ...store.get().alerts };
      if (s.state === 'on') alerts[id] = alert; else delete alerts[id];
      store.set({ alerts });
    };
  }
  return h;
}

export function startHA(config) {
  const handlers = buildHandlers(config.entities);
  const apply = (s) => s && handlers[s.entity_id]?.(s);
  let retry = 1000;

  const connect = () => {
    store.set({ link: 'connecting' });
    const ws = new WebSocket(config.ha.url);
    const send = (msg) => ws.send(JSON.stringify(msg));
    let ping = 0;

    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === 'auth_required') {
        send({ type: 'auth', access_token: config.ha.token });
      } else if (msg.type === 'auth_ok') {
        retry = 1000;
        store.set({ link: 'online', alerts: {} }); // alerts are rebuilt from get_states
        send({ id: 1, type: 'get_states' });
        send({ id: 2, type: 'subscribe_events', event_type: 'state_changed' });
        send({ id: 3, type: 'subscribe_events', event_type: config.event });
        ping = setInterval(() => send({ id: Date.now(), type: 'ping' }), 30000);
      } else if (msg.type === 'auth_invalid') {
        console.error('HA rejected the token:', msg.message);
        retry = 60000;
      } else if (msg.id === 1 && msg.type === 'result') {
        (msg.result || []).forEach(apply);
      } else if (msg.type === 'event' && msg.event.event_type === 'state_changed') {
        apply(msg.event.data.new_state);
      } else if (msg.type === 'event' && msg.event.event_type === config.event) {
        const d = msg.event.data || {};
        if (d.text != null || d.audio || d.envelope) say(d);
        else if (d.level != null) level(d.level);
      }
    };

    ws.onclose = () => {
      clearInterval(ping);
      store.set({ link: 'offline' });
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
    ws.onerror = () => ws.close();
  };

  connect();
}
