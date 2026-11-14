import defaults from './config.js';
import { isDark } from './store.js';
import { configureVoice } from './speech.js';
import { startChat } from './chat.js';
import { startMic } from './mic.js';
import { startHome } from './home.js';
import { startAgenda } from './agenda.js';
import { startAvatar } from './avatar.js';
import { startUI, boot } from './ui.js';
import { signIn, startHousehold } from './login.js';
import { startProposals } from './proposals.js';
import { startFeed } from './feed.js';
import { startHelp } from './help.js';
import { startTV } from './tv.js';
import { startDemo } from './feeds/demo.js';
import { startSolo } from './feeds/solo.js';
import { startInitiative } from './initiative.js';
import { store } from './store.js';
import { startHA } from './feeds/ha.js';

await signIn();     // in the cloud: the household's password first
const local = (await import('./config.local.js').catch(() => ({}))).default || {};
const params = new URLSearchParams(location.search);

const config = {
  ...defaults,
  ...local,
  ha: { ...defaults.ha, ...local.ha },
  entities: { ...defaults.entities, ...local.entities },
};
if (params.has('feed')) config.feed = params.get('feed');
if (params.has('boot')) config.boot = params.get('boot') !== '0';
// The Mac mini by the TV opens the page as ?handsfree=1&tv=http://127.0.0.1:8765 (scripts/mac-kiosk.sh).
if (params.has('handsfree')) config.handsfree = params.get('handsfree') !== '0';
if (params.has('tv')) config.tv = params.get('tv');

configureVoice(config);
if (config.boot) await boot(config);

startUI(config);
startMic(config, startChat(config));
startHome(config);
startAgenda(config);
startAvatar(document.getElementById('entity'), () => isDark(config));
({ ha: startHA, demo: startDemo }[config.feed] || startSolo)(config);
startInitiative(config);
startHousehold(config);
startProposals(config);
startFeed(config);
startHelp(config);
startTV(config);

// Keys that work everywhere (not while typing to him): S studio, P person.
store.set({ person: config.person });
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = store.get();
  if (e.code === 'KeyS') store.set({ flat: s.flat === 'studio' ? 'normal' : 'studio' });   // black screen, silence
  if (e.code === 'KeyP') {
    const people = config.people || [config.person];
    store.set({ person: people[(people.indexOf(s.person) + 1) % people.length] });
  }
});
