// Music from YouTube (and YouTube Music): when he says "muzyka: <title> yt:<video|list>:<id>", a player
// opens on a card at the top right, the cover goes on the room's television, and the music is turned
// down while he talks or listens. "muzyka: stop" ends it. With the Mac's browser signed in to YouTube
// (Premium: no adverts) it plays as the household's account.
import { store, mode } from './store.js';
import { tv } from './avatar.js';

const LOUD = 70, QUIET = 12;            // volume, and while he talks or listens
let api = null, player = null, card = null, volume = LOUD, seen = new Set();

function loadApi() {
  if (api) return api;
  api = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return api;
}

function cover(id) {
  const img = new Image();
  img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  tv.music = img;
  tv.musicOn = performance.now();
}

function stop() {
  player?.destroy?.();
  player = null;
  card?.remove();
  card = null;
  tv.music = null;
  document.body.classList.remove('music-on');
}

async function play(title, kind, id) {
  stop();
  card = document.createElement('section');
  card.id = 'music';
  card.className = 'note music';
  card.innerHTML = '<div class="note-head"><span class="mark">♪</span><span class="label">GRA MUZYKA</span><button class="when" title="wyłącz">✕</button></div>' +
    '<div class="note-body"><div class="player"><div></div></div><p class="title"></p></div>';
  card.querySelector('.title').textContent = title;
  card.querySelector('button').onclick = stop;
  document.body.append(card);
  document.body.classList.add('music-on');
  if (kind === 'video') cover(id);
  const YT = await loadApi();
  if (!card) return;
  player = new YT.Player(card.querySelector('.player > div'), {
    width: '100%', height: '100%',
    ...(kind === 'video' ? { videoId: id } : {}),
    playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, ...(kind === 'list' ? { listType: 'playlist', list: id } : {}) },
    events: {
      onReady: (e) => { e.target.setVolume(volume); e.target.playVideo(); },
      onStateChange: (e) => {
        const now = e.target.getVideoData?.();
        if (now?.video_id) { cover(now.video_id); if (kind === 'list' && now.title) card.querySelector('.title').textContent = `${title} · ${now.title}`; }
        if (e.data === YT.PlayerState.ENDED && kind === 'video') stop();
      },
    },
  });
}

/** Called with the actions of each answer: plays or stops what he asked for. */
function follow(actions) {
  for (const a of actions || []) {
    if (seen.has(a.text)) continue;
    seen.add(a.text);
    if (!a.ok) continue;
    const m = /^muzyka:\s*(.*?)\s*(?:yt:(video|list):([\w-]+))?$/i.exec(a.text);
    if (!m) continue;
    if (!m[3]) { if (/^stop$/i.test(m[1])) stop(); continue; }
    play(m[1], m[2], m[3]);
  }
  if (seen.size > 200) seen = new Set([...seen].slice(-100));
}

export function startMusic() {
  store.subscribe((s) => follow(s.actions));
  setInterval(() => {                    // quieter while he talks or listens, back up slowly after
    const m = mode();
    const want = m === 'speaking' || m === 'listening' || m === 'thinking' ? QUIET : LOUD;
    volume += Math.sign(want - volume) * Math.min(Math.abs(want - volume), want < volume ? 20 : 4);
    player?.setVolume?.(volume);
  }, 200);
}
