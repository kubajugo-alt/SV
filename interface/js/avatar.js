// ALAN's face: one full-screen fragment shader. Two phosphor eyes and an
// oscilloscope-trace mouth, drawn as vector shapes whose form is a blend of
// the four states, driven by the live audio level. All work is on the GPU; nothing here touches Ollama's CPU.

import { store, signal, mode } from './store.js';

const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform vec4 uMix;    // idle, listening, thinking, speaking
uniform float uAlert;
uniform float uBlink; // 0 open .. 1 shut
uniform vec2 uGaze;   // eye offset, in screen heights

const float EYE_Y = 0.28;    // face coords: origin at screen centre, y up, 1.0 = screen height
const float EYE_X = 0.17;
const float MOUTH_Y = 0.06;
const float MOUTH_W = 0.25;  // half width

float sdRound(vec2 p, vec2 b) {
  float r = min(b.x, b.y);
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}

// Two solid phosphor pills. Height carries the expression: half-lidded when
// idle, wide when listening, narrowed when thinking, round when alarmed.
float eyes(vec2 p) {
  float open = 0.050 * uMix.x + 0.078 * uMix.y + 0.034 * uMix.z + 0.062 * uMix.w;
  open = mix(open, 0.068, uAlert);
  float h = max(open * (1. - uBlink), 0.004);
  float w = mix(0.034, 0.068, uAlert);
  vec2 q = vec2(abs(p.x - uGaze.x) - EYE_X, p.y - EYE_Y - uGaze.y);
  float d = sdRound(q, vec2(w, h));
  return smoothstep(0.003, -0.003, d) * 0.9 + 0.004 / (max(d, 0.) + 0.02);
}

// The mouth is an oscilloscope trace: a faint smile at rest, the live speech
// envelope when talking.
float mouth(vec2 p, float t) {
  float x = p.x / (2. * MOUTH_W) + 0.5;
  float xc = clamp(x, 0., 1.);
  float win = pow(sin(3.14159 * xc), 1.3);         // pinned at the corners
  float u = 2. * xc - 1.;
  float smile = 0.024 * u * u - 0.012;
  float idle = smile + 0.004 * sin(xc * 6.283 + t * 0.5) * win;
  float listen = (0.003 + 0.022 * uLevel) * sin(xc * 24. + t * 7.) * win;
  float off = (xc - fract(t * 0.45)) * 6.;         // squared by hand: pow() of a negative base is undefined
  float think = 0.03 * sin(xc * 18. - t * 10.) * exp(-off * off) * win;
  float speak = smile * 0.4 + uLevel * win * (0.10 * sin(xc * 9. + t * 9.)
                                            + 0.045 * sin(xc * 21. - t * 14.)
                                            + 0.025 * sin(xc * 43. + t * 23.));
  float y = idle * uMix.x + listen * uMix.y + think * uMix.z + speak * uMix.w;
  float over = max(max(-x, x - 1.), 0.) * 2. * MOUTH_W;   // rounded ends past the corners
  float d = length(vec2(over, p.y - MOUTH_Y - y));
  return (0.0016 / (d + 0.0008) + 0.010 / (d * 6. + 0.05)) * (1. - uAlert); // no mouth under the alert text
}

float face(vec2 uv, float t) {
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.);
  return eyes(p) + mouth(p, t);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  uv += c * dot(c, c) * 0.10;                 // barrel distortion

  float breathe = 0.5 + 0.5 * sin(uTime * 0.7);
  float gain = (0.34 + 0.18 * breathe) * uMix.x + 1.0 * uMix.y + 0.65 * uMix.z
             + (0.75 + 0.4 * uLevel) * uMix.w;
  gain = mix(gain, 0.8, uAlert);

  float ab = 0.004 * length(c) * 2.;          // chromatic aberration grows to the edges
  vec3 i = vec3(face(uv - vec2(ab, 0.), uTime), face(uv, uTime), face(uv + vec2(ab, 0.), uTime));

  vec3 tint = mix(vec3(1.0, 0.69, 0.10), vec3(1.0, 0.25, 0.18), uAlert);
  vec3 col = i * tint * gain + pow(i.g * gain, 3.) * 0.08;   // white-hot core
  col = min(col, 1.);
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

const ORDER = ['idle', 'listening', 'thinking', 'speaking'];

export function startAvatar(canvas, isDark) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return; // text UI still works without the trace

  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uRes', 'uTime', 'uLevel', 'uMix', 'uAlert', 'uBlink', 'uGaze'].map((n) => [n, gl.getUniformLocation(prog, n)]));

  const resize = () => {
    canvas.width = canvas.clientWidth;   // 1:1 CSS pixels is plenty for a glow
    canvas.height = canvas.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();

  const mix = [1, 0, 0, 0];
  let alert = 0;
  let lvl = 0;
  let running = false;
  const gaze = [0, 0];
  let look = [0, 0];
  let nextLook = 0;
  let nextBlink = 2000;
  const BLINK_MS = 170;

  const frame = (now) => {
    if (isDark()) {             // studio mode: one black frame, then stop the loop
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      running = false;
      return;
    }
    const m = mode(store.get(), now);
    ORDER.forEach((name, i) => { mix[i] += ((m === name ? 1 : 0) - mix[i]) * 0.08; });
    alert += ((m === 'alert' ? 1 : 0) - alert) * 0.1;
    lvl += (signal.level - lvl) * 0.35;
    if (m === 'listening') signal.level *= 0.94; // room level decays unless refreshed

    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uLevel, lvl);
    gl.uniform4fv(u.uMix, mix);
    gl.uniform1f(u.uAlert, alert);

    // Blink every few seconds; stare during an alert.
    if (now > nextBlink + BLINK_MS) nextBlink = now + 2500 + Math.random() * 4500;
    const b = (now - nextBlink) / BLINK_MS;
    gl.uniform1f(u.uBlink, m !== 'alert' && b > 0 && b < 1 ? 1 - Math.abs(2 * b - 1) : 0);

    // Idle: occasional small glances. Thinking: eyes drift up and aside.
    if (m === 'thinking') {
      look = [-0.03 + 0.015 * Math.sin(now / 600), 0.02];
    } else if (m !== 'idle') {
      look = [0, 0];
    } else if (now > nextLook) {
      look = Math.random() < 0.5 ? [0, 0] : [(Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.02];
      nextLook = now + 2000 + Math.random() * 5000;
    }
    gaze[0] += (look[0] - gaze[0]) * 0.12;
    gaze[1] += (look[1] - gaze[1]) * 0.12;
    gl.uniform2fv(u.uGaze, gaze);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };

  // Restart the loop whenever the store changes and we are no longer dark.
  store.subscribe(() => {
    if (!running && !isDark()) {
      running = true;
      requestAnimationFrame(frame);
    }
  });
}
