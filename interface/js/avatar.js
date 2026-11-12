// ALAN's presence: a head made of tens of thousands of points of light.
// The points cover the surface of a full head and are lit like a sculpture,
// a sparse network of links lies over them, particles stream off the back of
// the head into a surrounding cloud, and the jaw follows the live audio level.
// The data comes from data/head.*.bin (see tools/build_head_cloud.py); all
// motion and lighting are computed in the vertex shader, so buffers never change.

import { store, signal, mode } from './store.js';

const POS = 4000;        // position units per model unit, as written by the build script
const STRIDE = 9;        // int16 values per point

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aAnim;     // jaw weight, glow (iris), kind (0 surface, 1 network node, 2 cloud)
attribute vec3 aRand;
uniform mat3 uRot;
uniform vec2 uCentre;
uniform float uScale, uAspect, uTime, uScatter, uTrail, uOpen, uLevel, uBright, uThink, uPoint;
varying float vGlow;
varying float vSoft;

void main() {
  float kind = aAnim.z;
  float cloud = step(1.5, kind);
  vec3 p = aPos;
  p.y -= aAnim.x * uOpen * 0.115;                 // the jaw drops with his voice
  p.z += aAnim.x * uOpen * 0.015;

  // The back of the head comes apart: its points stream away and fade.
  float back = (1.0 - cloud) * smoothstep(0.30, -0.95, aPos.z + (aRand.x - 0.5) * 0.7);
  float loose = clamp(uScatter * (0.4 + aRand.y) + back * uTrail, 0.0, 1.0);
  float along = fract(aRand.z + uTime * (0.015 + aRand.x * 0.02));          // each one travels down the stream
  vec3 flow = vec3(0.25 * sin(aRand.y * 6.28), 0.18 + 0.5 * (aRand.x - 0.5), -1.0);
  p += flow * loose * along * 3.2 + (aRand - 0.5) * loose * (0.25 + along * 1.6);
  p += vec3(sin(uTime * (0.3 + aRand.x * 0.4) + aRand.y * 6.28),
            cos(uTime * (0.26 + aRand.y * 0.4) + aRand.z * 6.28),
            sin(uTime * (0.22 + aRand.z * 0.4) + aRand.x * 6.28)) * (0.004 + loose * 0.05 + cloud * 0.10);

  p = uRot * p;
  vec3 n = uRot * aNormal;
  float persp = 1.0 / (1.0 - p.z * 0.11);
  vec2 s = p.xy * persp * uScale;
  gl_Position = vec4(uCentre.x + s.x / uAspect, uCentre.y + s.y, 0.0, 1.0);

  // Lit from the front right, with a rim where the surface turns away.
  float facing = smoothstep(-0.25, 0.20, n.z);
  float diffuse = pow(max(dot(n, normalize(vec3(0.78, 0.34, 0.52))), 0.0), 2.2);
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0) * facing;
  float fill = pow(max(dot(n, normalize(vec3(-0.45, -0.25, 0.86))), 0.0), 1.6);     // a soft second light, so lips and chin read
  float light = 0.03 + 1.00 * diffuse + 0.30 * fill + 0.55 * rim * max(n.x + 0.30, 0.0);
  light *= smoothstep(-2.05, -0.85, aPos.y);                                // shoulders fade out downwards
  light = mix(light * facing, 0.35 * (1.0 - along), loose);                 // streaming points glow on their own, then fade
  light = mix(light, 0.22 + 0.25 * aRand.x, cloud);
  light *= 1.0 - 0.6 * step(aAnim.y, -0.5);                                 // eyeballs sit back in their sockets
  light += max(aAnim.y, 0.0) * 0.22 * facing;                               // irises catch a little light
  light *= 1.0 + step(0.5, kind) * (1.0 - cloud) * 0.9;                     // network nodes stand out

  float wave = 0.5 + 0.5 * sin(length(aPos.xy - vec2(-0.4, 0.6)) * 6.0 - uTime * 5.0);
  float twinkle = 0.88 + 0.12 * sin(uTime * (1.0 + aRand.z * 2.0) + aRand.x * 6.28);
  vGlow = light * uBright * twinkle * (1.0 + uLevel * 0.5 * (1.0 - cloud)) * mix(1.0, 0.55 + 0.9 * wave, uThink);

  // Out-of-focus points grow soft and faint, like bokeh.
  float blur = (cloud + loose * along) * abs(p.z - 0.3) * 0.55 + cloud * 0.25;
  float size = uPoint * persp * (0.75 + aRand.x * 0.5) * (1.0 + step(0.5, kind) * (1.0 - cloud) * 0.9);
  gl_PointSize = size * (1.0 + blur * 7.0);
  vSoft = blur;
  vGlow /= 1.0 + blur * blur * 26.0;
}`;

const FRAG = `
precision mediump float;
uniform vec3 uColour;
uniform float uIsPoint, uLine;
varying float vGlow;
varying float vSoft;

void main() {
  float a = uLine;
  if (uIsPoint > 0.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float hard = smoothstep(1.0, 0.25, d);
    float soft = smoothstep(1.0, 0.75, d) * 0.6;                           // a flat disc when out of focus
    a = mix(hard, soft, clamp(vSoft * 3.0, 0.0, 1.0));
  }
  float g = vGlow * a;
  gl_FragColor = vec4(mix(uColour, vec3(1.0), clamp(g - 0.55, 0.0, 1.0) * 0.8) * g, 1.0);   // the brightest run white
}`;

// What each state does to him. Angles in radians; yaw turns his head to the viewer's right.
const POSE = {
  idle:      { scatter: 0.10, trail: 1.00, bright: 0.70, line: 0.30, think: 0, yaw: 0.50, pitch: 0.00 },
  listening: { scatter: 0.00, trail: 0.55, bright: 1.00, line: 0.42, think: 0, yaw: 0.12, pitch: 0.04 },
  thinking:  { scatter: 0.02, trail: 0.85, bright: 0.90, line: 0.42, think: 1, yaw: 0.62, pitch: -0.12 },
  speaking:  { scatter: 0.00, trail: 0.55, bright: 1.00, line: 0.42, think: 0, yaw: 0.20, pitch: 0.00 },
  alert:     { scatter: 0.00, trail: 0.20, bright: 1.15, line: 0.50, think: 0, yaw: 0.00, pitch: 0.00 },
};
const CALM = [0.33, 0.78, 1.0];    // cyan light
const ALARM = [1.0, 0.22, 0.16];

// Deterministic per-point random numbers, so he looks the same on every load.
function randoms(count) {
  const out = new Float32Array(count * 3);
  let s = 1964;
  for (let i = 0; i < out.length; i++) out[i] = ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return out;
}

export async function startAvatar(canvas, isDark) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) return; // text UI still works without the face

  let raw, links;
  try {
    const [a, b] = await Promise.all(['data/head.points.bin', 'data/head.links.bin'].map((url) => fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} for ${url}`);
      return r.arrayBuffer();
    })));
    raw = new Int16Array(a);
    links = new Uint16Array(b);
  } catch (err) {
    console.error('ALAN has no face:', err.message);
    return;
  }
  const count = raw.length / STRIDE;

  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  ['aPos', 'aNormal', 'aAnim', 'aRand'].forEach((name, i) => gl.bindAttribLocation(prog, i, name));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const u = {};
  for (const name of ['uRot', 'uCentre', 'uScale', 'uAspect', 'uTime', 'uScatter', 'uTrail', 'uOpen', 'uLevel',
    'uBright', 'uThink', 'uPoint', 'uColour', 'uIsPoint', 'uLine']) u[name] = gl.getUniformLocation(prog, name);

  // Unpack to floats: positions in model units, normals and weights to 0..1, kind as is.
  const data = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += STRIDE) {
    for (let k = 0; k < 3; k++) data[i + k] = raw[i + k] / POS;
    for (let k = 3; k < 8; k++) data[i + k] = raw[i + k] / 32767;
    data[i + 8] = raw[i + 8];
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 3, gl.FLOAT, false, STRIDE * 4, i * 12);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, randoms(count), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, links, gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);    // light adds up where points and lines overlap

  const resize = () => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();

  const pose = { ...POSE.idle, open: 0, alert: 0 };
  let running = false;

  const frame = (now) => {
    if (isDark()) {             // studio mode: one black frame, then stop the loop
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      running = false;
      return;
    }
    const m = mode(store.get(), now);
    const target = POSE[m] || POSE.idle;
    for (const k in target) pose[k] += (target[k] - pose[k]) * 0.05;
    pose.alert += ((m === 'alert' ? 1 : 0) - pose.alert) * 0.1;
    if (m === 'listening') signal.level *= 0.94; // room level decays unless refreshed
    pose.open += ((m === 'speaking' ? Math.min(1, signal.level * 1.2) : 0) - pose.open) * 0.4;

    // A slow, small sway keeps him alive.
    const t = now / 1000;
    const yaw = pose.yaw + 0.10 * Math.sin(t * 0.31) + 0.03 * Math.sin(t * 0.83);
    const pitch = pose.pitch + 0.04 * Math.sin(t * 0.43) + pose.open * 0.02;
    const roll = 0.02 * Math.sin(t * 0.27);
    const [cy, sy, cx, sx, cz, sz] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
    // column-major: Rz * Rx * Ry
    gl.uniformMatrix3fv(u.uRot, false, [
      cz * cy + sz * sx * sy, sz * cx, -cz * sy + sz * sx * cy,
      -sz * cy + cz * sx * sy, cz * cx, sz * sy + cz * sx * cy,
      cx * sy, -sx, cx * cy,
    ]);

    const aspect = canvas.width / canvas.height;
    const fit = Math.min(1, aspect * 0.95);                 // shrink on a narrow, upright screen
    gl.uniform2f(u.uCentre, 0, 0.36 + (1 - fit) * 0.20);
    gl.uniform1f(u.uScale, 0.37 * fit);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uScatter, pose.scatter);
    gl.uniform1f(u.uTrail, pose.trail);
    gl.uniform1f(u.uOpen, pose.open);
    gl.uniform1f(u.uLevel, signal.level);
    gl.uniform1f(u.uBright, pose.bright * (m === 'alert' ? 0.75 + 0.25 * Math.sin(t * 6.28) : 1));
    gl.uniform1f(u.uThink, pose.think);
    gl.uniform1f(u.uPoint, canvas.height * 0.0034 * fit);
    gl.uniform3f(u.uColour, ...CALM.map((c, i) => c + (ALARM[i] - c) * pose.alert));

    gl.clearColor(0.004 + 0.09 * pose.alert, 0.008, 0.016, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u.uIsPoint, 0);
    gl.uniform1f(u.uLine, pose.line);
    gl.drawElements(gl.LINES, links.length, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(u.uIsPoint, 1);
    gl.drawArrays(gl.POINTS, 0, count);
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
