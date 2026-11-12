// Defaults. Override on the kiosk machine in config.local.js (git-ignored) —
// see config.local.example.js. URL params win over both: ?feed=demo&boot=0

export default {
  feed: 'demo', // 'demo' | 'ha'
  boot: true,   // play the boot sequence on load
  chime: true,  // needs Chromium --autoplay-policy=no-user-gesture-required

  // Local text-to-speech endpoint (serve.py). The page voices every line it is
  // given through the TV and moves the mouth to that audio. '' keeps it silent.
  tts: 'tts?text=', // relative, so it also works behind a path prefix

  // Typed conversation with the local model (serve.py /chat). '' hides the prompt.
  chat: 'chat',
  // Hold Space and speak (serve.py /stt). '' turns the microphone off.
  // Kiosk: add Chromium --use-fake-ui-for-media-stream to skip the permission prompt.
  stt: 'stt',
  // Live state of the flat for the panel (serve.py /home, needs --ha-url). '' = feed only.
  home: 'home',
  // Timers and reminders: countdown on screen, spoken when due (serve.py /agenda).
  agenda: 'agenda',
  person: 'kuba', // who is at the keyboard or microphone; each person has their own memory

  ha: {
    url: 'ws://homeassistant.local:8123/api/websocket',
    token: '', // long-lived access token of a dedicated, non-admin kiosk user
  },

  // Custom HA event carrying speech + live levels. Contract: interface/README.md
  event: 'alan_avatar',

  // flat_state values during which the page goes black and stops rendering.
  darkModes: ['studio'],

  entities: {
    alan: 'input_select.alan_state', // idle | listening | thinking | speaking
    flat: 'input_select.flat_state', // normal | away | guest | work | studio ...
    rooms: {
      salon: { temp: 'sensor.salon_temperature', hum: 'sensor.salon_humidity' },
      sypialnia: { temp: 'sensor.sypialnia_temperature', hum: 'sensor.sypialnia_humidity' },
      kuchnia: { temp: 'sensor.kuchnia_temperature', hum: 'sensor.kuchnia_humidity' },
      przedpokoj: { temp: 'sensor.przedpokoj_temperature' },
      lazienka: { temp: 'sensor.lazienka_temperature', hum: 'sensor.lazienka_humidity' },
    },
    presence: { kuba: 'person.kuba', hubert: 'person.hubert' },
    co2: 'sensor.salon_co2',
    outdoor: 'sensor.outdoor_temperature',
    battery: 'sensor.ecoflow_battery',
    // Safety sensors are read directly, so an alert never waits on the LLM.
    alerts: {
      'binary_sensor.kuchnia_smoke': { kind: 'smoke', room: 'kuchnia' },
      'binary_sensor.przedpokoj_smoke': { kind: 'smoke', room: 'przedpokoj' },
      'binary_sensor.kuchnia_co': { kind: 'co', room: 'kuchnia' },
      'binary_sensor.kuchnia_leak': { kind: 'water', room: 'kuchnia' },
      'binary_sensor.lazienka_leak': { kind: 'water', room: 'lazienka' },
      'binary_sensor.pralka_leak': { kind: 'water', room: 'lazienka' },
    },
  },
};
