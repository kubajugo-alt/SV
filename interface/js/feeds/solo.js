// ALAN on a laptop: no flat behind him, so nothing is fed in. He idles until spoken to.

import { store } from '../store.js';

export function startSolo() {
  store.set({ link: 'solo', rooms: {}, presence: {} });
}
