// Puts ALAN's face on the tube. face.js draws the portrait in greyscale; this
// animates its pose from the current state and renders it through one fragment
// shader that makes it look like digitised video on an amber monitor:
// chunky pixels, ordered dither, bloom, edge aberration, barrel distortion.

import { store, signal, mode } from './store.js';
import { createFace, W, H } from './face.js';

const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uRect;   // face rectangle: x, y, w, h in screen uv (y up)
uniform float uTime;
uniform float uGain;
uniform float uAlert;

const vec2 GRID = vec2(160., 187.);   // digitiser resolution across the portrait

float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer4(vec2 a) { return bayer2(.5 * a) * .25 + bayer2(a); }

float raw(vec2 f) {
  vec2 inside = step(vec2(0.), f) * step(f, vec2(1.));
  return texture2D(uTex, f).r * inside.x * inside.y;
}

float face(vec2 uv) {
  vec2 f = (uv - uRect.xy) / uRect.zw;
  vec2 cell = floor(f * GRID);
  float v = raw((cell + .5) / GRID);
  v = floor(v * 5. + bayer4(cell)) / 5.;                 // six brightness levels, dithered
  float halo = 0.;                                        // phosphor bloom
  for (int k = 0; k < 6; k++) {
    float a = float(k) * 1.0472;
    halo += raw(f + vec2(cos(a), sin(a)) * 0.022);
  }
  return (v + halo * 0.035) * smoothstep(0., 0.14, f.y);   // shoulders fade out at the bottom
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  uv += c * dot(c, c) * 0.10;                             // barrel distortion

  float ab = 0.0008 + 0.004 * length(c);                  // chromatic aberration grows to the edges
  vec3 i = vec3(face(uv - vec2(ab, 0.)), face(uv), face(uv + vec2(ab, 0.)));
  i *= 1. + 0.10 * smoothstep(0.06, 0., abs(uv.y - fract(uTime * 0.07)));  // slow hum bar

  vec3 tint = mix(vec3(1.0, 0.69, 0.10), vec3(1.0, 0.25, 0.18), uAlert);
  vec3 col = i * tint * uGain + pow(i.g * uGain, 3.) * 0.10;  // highlights run white-hot
  col = min(col, 1.);
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

// Resting pose per state. Brows in px, everything else unitless.
const POSE = {
  idle:      { lid: 0.80, smile: 0.45, browL: 0, browR: 0, furrow: 0, tilt: 0,     gain: 0.72 },
  listening: { lid: 1.00, smile: 0.25, browL: 6, browR: 6, furrow: 0, tilt: 0.035, gain: 1.00 },
  thinking:  { lid: 0.70, smile: -0.1, browL: -2, browR: 9, furrow: 0.2, tilt: -0.03, gain: 0.85 },
  speaking:  { lid: 0.90, smile: 0.35, browL: 2, browR: 2, furrow: 0, tilt: 0,     gain: 1.00 },
  alert:     { lid: 1.15, smile: -0.7, browL: 0, browR: 0, furrow: 1, tilt: 0,     gain: 1.00 },
};

export function startAvatar(canvas, isDark) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return; // text UI still works without the face

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
  const u = Object.fromEntries(['uRes', 'uRect', 'uTime', 'uGain', 'uAlert'].map((n) => [n, gl.getUniformLocation(prog, n)]));

  const face = createFace();
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);

  const resize = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();

  const pose = { ...POSE.idle, open: 0, gazeX: 0, gazeY: 0, bob: 0 };
  let alert = 0;
  let look = [0, 0];
  let nextLook = 0;
  let nextBlink = 2000;
  const BLINK_MS = 170;
  let running = false;

  const frame = (now) => {
    if (isDark()) {             // studio mode: one black frame, then stop the loop
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      running = false;
      return;
    }
    const m = mode(store.get(), now);
    const target = POSE[m] || POSE.idle;
    for (const k in target) pose[k] += (target[k] - pose[k]) * 0.1;
    alert += ((m === 'alert' ? 1 : 0) - alert) * 0.1;
    if (m === 'listening') signal.level *= 0.94; // room level decays unless refreshed

    // Mouth follows the speech envelope; brows and head move a little with it.
    const lvl = m === 'speaking' ? signal.level : m === 'alert' ? 0.3 : 0;
    pose.open += (Math.min(1, lvl * 1.15) - pose.open) * 0.45;
    const talk = m === 'speaking' ? pose.open : 0;
    const breathe = Math.sin(now / 1900);

    // Blink every few seconds; stare during an alert.
    if (now > nextBlink + BLINK_MS) nextBlink = now + 2500 + Math.random() * 4500;
    const b = (now - nextBlink) / BLINK_MS;
    const blink = m !== 'alert' && b > 0 && b < 1 ? 1 - Math.abs(2 * b - 1) : 0;

    // Idle: occasional glances. Thinking: eyes drift up and aside.
    if (m === 'thinking') {
      look = [-0.7 + 0.25 * Math.sin(now / 600), -0.8];
    } else if (m !== 'idle') {
      look = [0, 0];
    } else if (now > nextLook) {
      look = Math.random() < 0.5 ? [0, 0] : [(Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.6];
      nextLook = now + 2000 + Math.random() * 5000;
    }
    pose.gazeX += (look[0] - pose.gazeX) * 0.14;
    pose.gazeY += (look[1] - pose.gazeY) * 0.14;

    face.draw({
      ...pose,
      lid: pose.lid * (1 - blink),
      browL: pose.browL + talk * 4,
      browR: pose.browR + talk * 4,
      tilt: pose.tilt + 0.012 * Math.sin(now / 2700) + talk * 0.02 * Math.sin(now / 400),
      bob: breathe * 1.5 + talk * 2,
    });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face.canvas);

    // Portrait fills the band between the title bar and the transcript.
    const h = 0.58;
    const w = h * (W / H) * (canvas.height / canvas.width);
    gl.uniform4f(u.uRect, 0.5 - w / 2, 0.375, w, h);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uGain, pose.gain * (m === 'idle' ? 0.94 + 0.06 * breathe : 1));
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
