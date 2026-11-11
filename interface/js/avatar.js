// The phosphor entity: one full-screen fragment shader (spec §33, Tier 1).
// An oscilloscope trace whose shape is a blend of the four states, driven by
// the live audio level. All work is on the GPU; nothing here touches Ollama's CPU.

import { store, signal, mode } from './store.js';

const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform vec4 uMix;    // idle, listening, thinking, speaking
uniform float uAlert;

float hash(float n) { return fract(sin(n) * 43758.5453); }

float trace(float x, float t) {
  float win = pow(sin(3.14159 * clamp(x, 0., 1.)), 1.3);  // pinned at both ends
  float idle = 0.018 * sin(x * 6.283 + t * 0.5) * (0.6 + 0.4 * sin(t * 0.7));
  float listen = (0.012 + 0.05 * uLevel) * sin(x * 46. + t * 7.)
               + 0.006 * (hash(floor(x * 240.) + floor(t * 30.)) - 0.5);
  float sweep = fract(t * 0.45);
  float off = (x - sweep) * 7.;   // squared by hand: pow() of a negative base is undefined
  float think = 0.07 * sin(x * 30. - t * 10.) * exp(-off * off);
  float speak = uLevel * (0.20 * sin(x * 17. + t * 9.)
                        + 0.09 * sin(x * 39. - t * 14.)
                        + 0.05 * sin(x * 83. + t * 23.));
  float alarm = 0.03 * (fract(x * 6. - t * 2.) - 0.5);
  float y = idle * uMix.x + listen * uMix.y + think * uMix.z + speak * uMix.w;
  return mix(y, alarm, uAlert) * win;
}

float beam(vec2 uv, float t) {
  float d = abs(uv.y - 0.56 - trace(uv.x, t));
  float core = 0.0016 / (d + 0.0008);        // hot line
  float bloom = 0.012 / (d * 6. + 0.05);     // phosphor halo
  return core + bloom;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  uv += c * dot(c, c) * 0.10;                 // barrel distortion

  float breathe = 0.5 + 0.5 * sin(uTime * 0.7);
  float gain = (0.30 + 0.20 * breathe) * uMix.x + 1.0 * uMix.y + 0.65 * uMix.z
             + (0.75 + 0.5 * uLevel) * uMix.w;
  gain = mix(gain, 0.35, uAlert);

  float ab = 0.004 * length(c) * 2.;          // chromatic aberration grows to the edges
  vec3 i = vec3(beam(uv - vec2(ab, 0.), uTime), beam(uv, uTime), beam(uv + vec2(ab, 0.), uTime));

  vec3 tint = mix(vec3(1.0, 0.69, 0.10), vec3(1.0, 0.25, 0.18), uAlert);
  vec3 col = i * tint * gain + pow(i.g * gain, 3.) * 0.08;   // white-hot core
  col *= step(0., uv.x) * step(uv.x, 1.);
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
  const u = Object.fromEntries(['uRes', 'uTime', 'uLevel', 'uMix', 'uAlert'].map((n) => [n, gl.getUniformLocation(prog, n)]));

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
