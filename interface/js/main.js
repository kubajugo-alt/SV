import defaults from './config.js';
import { isDark } from './store.js';
import { configureVoice } from './speech.js';
import { startChat } from './chat.js';
import { startMic } from './mic.js';
import { startAvatar } from './avatar.js';
import { startUI, boot } from './ui.js';
import { startDemo } from './feeds/demo.js';
import { startHA } from './feeds/ha.js';

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

configureVoice(config);
if (config.boot) await boot(config);

startUI(config);
startMic(config, startChat(config));
startAvatar(document.getElementById('entity'), () => isDark(config));
(config.feed === 'ha' ? startHA : startDemo)(config);
