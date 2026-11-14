// Copy to config.local.js on the kiosk machine. Values here are merged over
// config.js (one level deep, so `ha` and `entities` can be partial).

export default {
  feed: 'ha',
  ha: {
    url: 'ws://192.168.2.20:8123/api/websocket',
    token: 'PASTE_LONG_LIVED_TOKEN',
  },
};
