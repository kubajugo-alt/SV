// ALAN's presence: a cloud of nodes joined by lines, from which a man's face
// emerges. At rest the face is loosely scattered into the cloud; when he
// listens or speaks the nodes gather into it. The jaw follows the live audio
// level, the lids blink, signals ripple across the links while he thinks.
// Node and link data come from face-mesh.js (see tools/build_face_mesh.py);
// all motion is computed in the vertex shader, so the buffers never change.

import { store, signal, mode } from './store.js';
import { NODES, LINKS, FEATURES, STRIDE } from './face-mesh.js';

const VERT = `
attribute vec3 aPos;
attribute vec3 aRand;
attribute vec3 aAnim;     // jaw weight, lid offset, kind (0 face, 1 head and shoulders, 2 cloud)
uniform mat3 uRot;
uniform vec2 uCentre;
uniform float uScale, uAspect, uTime, uScatter, uOpen, uBlink, uLevel, uBright, uThink, uPoint;
uniform vec2 uNudge;      // sub-pixel offset, to draw a line several times for weight
varying float vGlow;

void main() {
  float kind = aAnim.z;
  vec3 p = aPos;
  p.y -= aAnim.x * uOpen * 0.17 + aAnim.y * uBlink;       // jaw drops, lids close
  p.z -= aAnim.x * uOpen * 0.05;

  // Every node drifts a little; scattered ones are pushed off their place.
  vec3 drift = vec3(sin(uTime * (0.31 + aRand.x * 0.4) + aRand.y * 6.28),
                    cos(uTime * (0.27 + aRand.y * 0.4) + aRand.z * 6.28),
                    sin(uTime * (0.23 + aRand.z * 0.4) + aRand.x * 6.28));
  float loose = uScatter * (kind < 0.5 ? 1.0 : 1.5);
  p += (aRand - 0.5) * 1.6 * loose + drift * (0.010 + loose * 0.10 + step(1.5, kind) * 0.05);

  p = uRot * p;
  float persp = 1.0 / (1.0 - p.z * 0.16);
  vec2 s = p.xy * persp * uScale;
  gl_Position = vec4(uCentre.x + s.x / uAspect + uNudge.x, uCentre.y + s.y + uNudge.y, 0.0, 1.0);
  gl_PointSize = uPoint * persp * (kind < 0.5 ? 1.0 : kind < 1.5 ? 0.8 : 0.7) * (0.7 + aRand.x * 0.6);

  float depth = clamp(0.62 + p.z * 0.55, 0.12, 1.25);               // nearer is brighter
  float part = kind < 0.5 ? 1.0 : kind < 1.5 ? 0.42 : 0.30;         // the face leads, the cloud recedes
  float wave = 0.5 + 0.5 * sin(length(aPos.xy - vec2(-0.3, 0.5)) * 7.0 - uTime * 5.0);
  float twinkle = 0.85 + 0.15 * sin(uTime * (1.0 + aRand.z * 2.0) + aRand.x * 6.28);
  vGlow = depth * part * uBright * twinkle * (1.0 + uLevel * 0.9 * step(kind, 0.5)) * mix(1.0, 0.45 + wave, uThink);
}`;

const FRAG = `
precision mediump float;
uniform vec3 uColour;
uniform float uIsPoint, uLine;
varying float vGlow;

void main() {
  float a = uLine;
  if (uIsPoint > 0.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    a = smoothstep(1.0, 0.0, d);
    a = a * a + smoothstep(0.35, 0.0, d) * 0.9;     // soft halo with a hot core
  }
  gl_FragColor = vec4(uColour * vGlow * a, 1.0);
}`;

// What each state does to the face. Angles in radians.
const POSE = {
  idle:      { scatter: 0.13, bright: 0.62, line: 0.22, think: 0, yaw: 0,     pitch: 0 },
  listening: { scatter: 0.02, bright: 1.00, line: 0.30, think: 0, yaw: 0,     pitch: 0.05 },
  thinking:  { scatter: 0.05, bright: 0.85, line: 0.28, think: 1, yaw: -0.30, pitch: -0.13 },
  speaking:  { scatter: 0.01, bright: 1.00, line: 0.30, think: 0, yaw: 0,     pitch: 0 },
  alert:     { scatter: 0.00, bright: 1.15, line: 0.45, think: 0, yaw: 0,     pitch: 0 },
};
const CALM = [1.0, 0.80, 0.52];    // warm light, like the lamps in the flat
const ALARM = [1.0, 0.22, 0.16];

export function startAvatar(canvas, isDark) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) return; // text UI still works without the face

  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  ['aPos', 'aRand', 'aAnim'].forEach((name, i) => gl.bindAttribLocation(prog, i, name));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const u = {};
  for (const name of ['uRot', 'uCentre', 'uScale', 'uAspect', 'uTime', 'uScatter', 'uOpen', 'uBlink', 'uLevel',
    'uBright', 'uThink', 'uPoint', 'uColour', 'uIsPoint', 'uLine', 'uNudge']) u[name] = gl.getUniformLocation(prog, name);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, NODES, gl.STATIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 3, gl.FLOAT, false, STRIDE * 4, i * 12);
  }
  const mesh = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, LINKS, gl.STATIC_DRAW);
  const features = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, features);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FEATURES, gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);    // light adds up where nodes and lines overlap

  let ratio = 1;
  const resize = () => {
    ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();

  const pose = { ...POSE.idle, open: 0, alert: 0 };
  let nextBlink = 2500;
  const BLINK_MS = 190;
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
    for (const k in target) pose[k] += (target[k] - pose[k]) * 0.06;
    pose.alert += ((m === 'alert' ? 1 : 0) - pose.alert) * 0.1;
    if (m === 'listening') signal.level *= 0.94; // room level decays unless refreshed
    pose.open += ((m === 'speaking' ? Math.min(1, signal.level * 1.2) : 0) - pose.open) * 0.4;

    if (now > nextBlink + BLINK_MS) nextBlink = now + 2600 + Math.random() * 4200;
    const b = (now - nextBlink) / BLINK_MS;
    const blink = m !== 'alert' && b > 0 && b < 1 ? 1 - Math.abs(2 * b - 1) : 0;

    // A slow, small sway keeps him alive; thinking turns the head up and aside.
    const t = now / 1000;
    const yaw = pose.yaw + 0.13 * Math.sin(t * 0.31) + 0.04 * Math.sin(t * 0.83);
    const pitch = pose.pitch + 0.05 * Math.sin(t * 0.43) + pose.open * 0.03;
    const roll = 0.025 * Math.sin(t * 0.27);
    const [cy, sy, cx, sx, cz, sz] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
    // column-major: Rz * Rx * Ry
    gl.uniformMatrix3fv(u.uRot, false, [
      cz * cy + sz * sx * sy, sz * cx, -cz * sy + sz * sx * cy,
      -sz * cy + cz * sx * sy, cz * cx, sz * sy + cz * sx * cy,
      cx * sy, -sx, cx * cy,
    ]);

    const aspect = canvas.width / canvas.height;
    const fit = Math.min(1, aspect * 0.95);                 // shrink on a narrow, upright screen
    gl.uniform2f(u.uCentre, 0, 0.34 + (1 - fit) * 0.22);
    gl.uniform1f(u.uScale, 0.43 * fit);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uScatter, pose.scatter);
    gl.uniform1f(u.uOpen, pose.open);
    gl.uniform1f(u.uBlink, blink);
    gl.uniform1f(u.uLevel, signal.level);
    gl.uniform1f(u.uBright, pose.bright * (m === 'alert' ? 0.75 + 0.25 * Math.sin(t * 6.28) : 1));
    gl.uniform1f(u.uThink, pose.think);
    gl.uniform1f(u.uPoint, canvas.height * 0.0062 * fit);
    gl.uniform3f(u.uColour, ...CALM.map((c, i) => c + (ALARM[i] - c) * pose.alert));

    gl.clearColor(0.016 + 0.10 * pose.alert, 0.020, 0.027, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u.uIsPoint, 0);
    gl.uniform2f(u.uNudge, 0, 0);
    gl.uniform1f(u.uLine, pose.line);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh);
    gl.drawElements(gl.LINES, LINKS.length, gl.UNSIGNED_SHORT, 0);
    // Outline, eyes, brows, nose and lips: brighter, and drawn three times a
    // fraction of a pixel apart, since WebGL lines are one pixel wide.
    gl.uniform1f(u.uLine, Math.min(1, pose.line * 2.2));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, features);
    for (const [dx, dy] of [[0, 0], [0.7, 0.4], [-0.4, 0.7]]) {
      gl.uniform2f(u.uNudge, (dx * 2) / canvas.width, (dy * 2) / canvas.height);
      gl.drawElements(gl.LINES, FEATURES.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.uniform2f(u.uNudge, 0, 0);
    gl.uniform1f(u.uIsPoint, 1);
    gl.drawArrays(gl.POINTS, 0, NODES.length / STRIDE);
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
