// ALAN's face as a line drawing: a man in his mid-thirties, short hair, light
// stubble — outlines only, like a vector display. Drawn on a 2D canvas in
// greyscale (value = phosphor brightness); avatar.js uploads it as a texture
// and adds the glow. Head and body are painted once; eyes, brows and mouth
// are redrawn each frame.

export const W = 512;
export const H = 600;
const CX = 256;

const grey = (v, a = 1) => {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${c},${c},${c},${a})`;
};

function layer() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')];
}

// Deterministic noise so the stubble is identical on every load.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const LINE = 4.5;

function pen(g, v = 1, width = LINE) {
  g.strokeStyle = grey(v);
  g.fillStyle = grey(v);
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

function paintBody() {
  const [c, g] = layer();
  pen(g, 0.7);
  g.beginPath();                       // neck
  g.moveTo(196, 448); g.lineTo(196, 506);
  g.moveTo(316, 448); g.lineTo(316, 506);
  g.moveTo(196, 506);                  // collar
  g.quadraticCurveTo(CX, 548, 316, 506);
  g.moveTo(196, 506);                  // shoulders
  g.bezierCurveTo(120, 522, 40, 540, 14, H);
  g.moveTo(316, 506);
  g.bezierCurveTo(392, 522, 472, 540, 498, H);
  g.stroke();
  return c;
}

function paintHead() {
  const [c, g] = layer();
  const rand = rng(7);
  pen(g);

  // jaw, from temple to temple
  g.beginPath();
  g.moveTo(132, 240);
  g.bezierCurveTo(132, 300, 140, 362, 168, 412);
  g.bezierCurveTo(190, 452, 222, 476, CX, 476);
  g.bezierCurveTo(290, 476, 322, 452, 344, 412);
  g.bezierCurveTo(372, 362, 380, 300, 380, 240);
  g.stroke();

  // ears
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(CX + s * 125, 258);
    g.bezierCurveTo(CX + s * 150, 240, CX + s * 152, 318, CX + s * 122, 326);
    g.stroke();
  }

  // hair: short, a little height on top, receding slightly at the temples
  g.beginPath();
  g.moveTo(132, 240);
  g.bezierCurveTo(116, 120, 172, 58, CX, 54);
  g.bezierCurveTo(340, 58, 396, 120, 380, 240);
  g.bezierCurveTo(374, 200, 354, 162, 330, 140);
  g.bezierCurveTo(300, 153, 276, 150, CX, 146);
  g.bezierCurveTo(232, 150, 208, 153, 182, 140);
  g.bezierCurveTo(158, 162, 138, 200, 132, 240);
  g.stroke();
  pen(g, 0.55, 3);
  for (const x of [204, 236, 268, 300]) {       // a few swept strands
    g.beginPath();
    g.moveTo(x, 132);
    g.bezierCurveTo(x + 4, 112, x + 14, 92, x + 30, 78);
    g.stroke();
  }

  // nose
  pen(g);
  g.beginPath();
  g.moveTo(CX + 6, 284);
  g.quadraticCurveTo(CX + 14, 326, CX + 24, 342);
  g.quadraticCurveTo(CX + 22, 356, CX, 354);
  g.stroke();

  // light beard: stubble ticks along the jaw, chin and upper lip
  pen(g, 0.6, 2.6);
  for (let i = 0; i < 520; i++) {
    const x = 140 + rand() * 232;
    const y = 300 + rand() * 172;
    const dx = Math.abs(x - CX);
    const edge = y < 412 ? 124 - (y - 240) * 0.12 - Math.max(0, y - 362) * 0.5 : 88 - (y - 412) * 1.3; // inside the jaw line
    if (dx > edge - 7) continue;
    const moustache = y > 364 && y < 384 && dx < 54;
    const cheekLimit = y < 384 ? 70 + (384 - y) * 0.7 : 0;   // bare cheeks above the beard line
    if (dx < cheekLimit && !moustache) continue;
    if (y > 384 && y < 426 && dx < 48) continue;             // lips
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 2, y + 3.5);
    g.stroke();
  }
  return c;
}

function eye(g, s, p) {
  const cx = CX + s * 58;
  const cy = 268;
  const open = Math.max(0.02, p.lid);
  const shape = () => {
    g.beginPath();
    g.moveTo(cx - 27, cy + 2);
    g.quadraticCurveTo(cx - s * 3, cy - 30 * open, cx + 27, cy + 2);
    g.quadraticCurveTo(cx, cy + 2 + 17 * open, cx - 27, cy + 2);
    g.closePath();
  };
  pen(g);
  g.save();
  shape();
  g.clip();
  g.beginPath();                                   // pupil, hidden by the lids as they close
  g.arc(cx + p.gazeX * 10, cy - 3 + p.gazeY * 6, 8, 0, Math.PI * 2);
  g.fill();
  g.restore();
  shape();
  g.stroke();
}

function brow(g, s, p) {
  const raise = s > 0 ? p.browR : p.browL;
  pen(g, 1, 7);
  g.beginPath();
  g.moveTo(CX + s * 27, 238 - raise + p.furrow * 9);
  g.quadraticCurveTo(CX + s * 62, 217 - raise * 1.3, CX + s * 98, 236 - raise * 0.6 - p.furrow * 3);
  g.stroke();
}

function mouth(g, p) {
  const y = 402;
  const w = 44 + p.smile * 7 - p.open * 5;
  const cy = y - p.smile * 8;          // corners lift with a smile, drop with a frown
  const gap = p.open * 30;
  pen(g);
  g.beginPath();
  g.moveTo(CX - w, cy);
  g.quadraticCurveTo(CX, y + 4 + p.smile * 8 + gap * 1.9, CX + w, cy);   // lower lip
  if (gap > 1.5) g.quadraticCurveTo(CX, y + 2 - gap * 0.25, CX - w, cy);  // upper lip once it opens
  g.stroke();
}

/**
 * @returns {{canvas: HTMLCanvasElement, draw: (pose: object) => void}}
 * pose: lid 0..1.2, gazeX/gazeY -1..1, browL/browR px, furrow 0..1,
 *       open 0..1, smile -1..1, tilt rad, bob px
 */
export function createFace() {
  const [canvas, g] = layer();
  const body = paintBody();
  const head = paintHead();
  return {
    canvas,
    draw(p) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.drawImage(body, 0, 0);
      g.translate(CX, 470 + p.bob);
      g.rotate(p.tilt);
      g.translate(-CX, -470);
      g.drawImage(head, 0, 0);
      for (const s of [-1, 1]) { eye(g, s, p); brow(g, s, p); }
      mouth(g, p);
    },
  };
}
