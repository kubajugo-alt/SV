// ALAN's portrait: a man in his mid-thirties, short dark hair, light beard.
// Drawn procedurally on a 2D canvas in greyscale (value = phosphor brightness);
// avatar.js uploads it as a texture and gives it the CRT treatment.
// The head and body are painted once; eyes, brows and mouth are redrawn each frame.

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

function headPath(g) {
  g.beginPath();
  g.moveTo(CX, 92);
  g.bezierCurveTo(332, 92, 380, 150, 380, 235);
  g.bezierCurveTo(380, 300, 372, 362, 344, 412);
  g.bezierCurveTo(322, 452, 290, 476, CX, 476);
  g.bezierCurveTo(222, 476, 190, 452, 168, 412);
  g.bezierCurveTo(140, 362, 132, 300, 132, 235);
  g.bezierCurveTo(132, 150, 180, 92, CX, 92);
  g.closePath();
}

function paintBody() {
  const [c, g] = layer();
  // shoulders + crew-neck shirt
  g.fillStyle = grey(0.22);
  g.beginPath();
  g.moveTo(0, H);
  g.bezierCurveTo(20, 545, 110, 525, 185, 508);
  g.lineTo(327, 508);
  g.bezierCurveTo(402, 525, 492, 545, W, H);
  g.closePath();
  g.fill();
  // neck
  const neck = g.createLinearGradient(0, 430, 0, 540);
  neck.addColorStop(0, grey(0.28));
  neck.addColorStop(0.45, grey(0.5));
  neck.addColorStop(1, grey(0.6));
  g.fillStyle = neck;
  g.beginPath();
  g.moveTo(186, 400);
  g.lineTo(186, 505);
  g.quadraticCurveTo(CX, 548, 326, 505);
  g.lineTo(326, 400);
  g.closePath();
  g.fill();
  // collar
  g.strokeStyle = grey(0.36);
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(182, 506);
  g.quadraticCurveTo(CX, 556, 330, 506);
  g.stroke();
  return c;
}

function paintHead() {
  const [c, g] = layer();
  const rand = rng(7);

  // ears
  for (const s of [-1, 1]) {
    g.fillStyle = grey(0.5);
    g.beginPath();
    g.ellipse(CX + s * 127, 288, 15, 34, s * 0.12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = grey(0.3);
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(CX + s * 129, 288, 6, 20, s * 0.12, 0, Math.PI * 2);
    g.stroke();
  }

  // skin, lit from the upper left
  const skin = g.createRadialGradient(232, 250, 30, CX, 290, 235);
  skin.addColorStop(0, grey(0.9));
  skin.addColorStop(0.55, grey(0.76));
  skin.addColorStop(1, grey(0.5));
  g.fillStyle = skin;
  headPath(g);
  g.fill();

  g.save();
  headPath(g);
  g.clip();

  // soft modelling: eye sockets, cheek hollows, side of the nose, under the lip
  g.filter = 'blur(9px)';
  g.fillStyle = grey(0.3, 0.3);
  for (const s of [-1, 1]) {
    g.beginPath(); g.ellipse(CX + s * 58, 262, 40, 20, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(CX + s * 104, 345, 22, 48, s * 0.25, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.ellipse(CX + 20, 315, 9, 34, -0.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = grey(1, 0.3);
  g.beginPath(); g.ellipse(CX - 4, 318, 8, 34, 0, 0, Math.PI * 2); g.fill();          // nose bridge
  g.beginPath(); g.ellipse(CX - 30, 180, 55, 22, 0, 0, Math.PI * 2); g.fill();        // forehead
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(CX + s * 78, 318, 22, 14, 0, 0, Math.PI * 2); g.fill(); } // cheekbones

  // beard: jaw, chin and moustache, kept light so it reads as a few days' growth
  g.filter = 'blur(5px)';
  g.fillStyle = grey(0.1, 0.34);
  g.beginPath();
  g.moveTo(126, 280);
  g.lineTo(126, 500); g.lineTo(386, 500); g.lineTo(386, 280);
  g.lineTo(366, 284);
  g.bezierCurveTo(362, 330, 346, 366, 314, 380);     // right cheek line
  g.bezierCurveTo(300, 366, 282, 360, CX, 361);       // moustache top
  g.bezierCurveTo(230, 360, 212, 366, 198, 380);
  g.bezierCurveTo(166, 366, 150, 330, 146, 284);
  g.closePath();
  g.fill();
  // denser at the chin and moustache
  g.fillStyle = grey(0.06, 0.26);
  g.beginPath(); g.ellipse(CX, 446, 52, 30, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(CX, 376, 50, 11, 0, 0, Math.PI * 2); g.fill();
  g.filter = 'none';

  // stubble grain
  for (let i = 0; i < 1700; i++) {
    const x = 132 + rand() * 248;
    const y = 285 + rand() * 195;
    const dx = Math.abs(x - CX);
    const cheekLimit = y < 380 ? 62 + (380 - y) * 0.75 : 0;  // bare cheeks above the beard line
    const moustache = y > 362 && y < 388 && dx < 56;
    if (dx < cheekLimit && !moustache) continue;
    if (y > 388 && y < 420 && dx < 40) continue;              // lips
    g.fillStyle = grey(0.05, 0.2 + rand() * 0.3);
    g.fillRect(x, y, 1.6, 1.6 + rand() * 1.6);
  }

  // smile lines
  g.strokeStyle = grey(0.3, 0.45);
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(CX + s * 36, 340);
    g.quadraticCurveTo(CX + s * 62, 362, CX + s * 62, 392);
    g.stroke();
  }

  // nose
  g.strokeStyle = grey(0.32, 0.8);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(CX - 26, 338);
  g.quadraticCurveTo(CX - 30, 352, CX - 14, 352);
  g.quadraticCurveTo(CX, 362, CX + 14, 352);
  g.quadraticCurveTo(CX + 30, 352, CX + 26, 338);
  g.stroke();
  g.fillStyle = grey(0.12, 0.8);
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(CX + s * 13, 349, 6, 3, s * 0.3, 0, Math.PI * 2); g.fill(); }
  g.restore();

  // hair: short, dark, a little height on top, receding slightly at the temples
  g.fillStyle = grey(0.17);
  g.beginPath();
  g.moveTo(136, 292);
  g.bezierCurveTo(118, 240, 112, 120, 190, 72);
  g.bezierCurveTo(230, 48, 300, 48, 334, 74);
  g.bezierCurveTo(400, 124, 394, 240, 376, 292);
  g.bezierCurveTo(372, 250, 368, 215, 356, 190);       // right sideburn, inner edge
  g.bezierCurveTo(350, 168, 344, 150, 330, 138);       // right temple
  g.bezierCurveTo(300, 152, 276, 150, CX, 146);        // hairline
  g.bezierCurveTo(232, 150, 208, 152, 182, 138);
  g.bezierCurveTo(168, 150, 162, 168, 156, 190);
  g.bezierCurveTo(144, 215, 140, 250, 136, 292);
  g.closePath();
  g.fill();
  // strands catching the light
  g.save();
  g.clip();
  g.filter = 'blur(10px)';
  g.fillStyle = grey(0.42, 0.55);               // sheen across the top, swept to one side
  g.beginPath(); g.ellipse(236, 92, 70, 16, -0.12, 0, Math.PI * 2); g.fill();
  g.filter = 'blur(1px)';
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const x = 176 + i * 14 + rand() * 6;
    g.strokeStyle = grey(i % 2 ? 0.34 : 0.05, 0.5);
    g.beginPath();
    g.moveTo(x, 146);
    g.bezierCurveTo(x + 4, 120, x + 16, 95, x + 34, 66 + rand() * 12);
    g.stroke();
  }
  g.restore();
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
  g.save();
  shape();
  g.fillStyle = grey(0.95);
  g.fill();
  g.clip();
  const ix = cx + p.gazeX * 9;
  const iy = cy - 3 + p.gazeY * 6;
  g.fillStyle = grey(0.26); g.beginPath(); g.arc(ix, iy, 11.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = grey(0.02); g.beginPath(); g.arc(ix, iy, 5.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = grey(1); g.beginPath(); g.arc(ix - 4, iy - 4, 2.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = grey(0, 0.25); g.fillRect(cx - 30, cy - 30, 60, 30 - 13 * open); // shadow under the lid
  g.restore();

  g.lineCap = 'round';
  g.strokeStyle = grey(0.06);                       // lash line
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(cx - 28, cy + 2);
  g.quadraticCurveTo(cx - s * 3, cy - 30 * open, cx + 28, cy + 2);
  g.stroke();
  g.strokeStyle = grey(0.3, 0.6);                   // lid crease + lower lid
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - 24, cy - 8);
  g.quadraticCurveTo(cx - s * 3, cy - 30 * open - 9, cx + 24, cy - 8);
  g.moveTo(cx - 20, cy + 9 + 4 * open);
  g.quadraticCurveTo(cx, cy + 14 + 6 * open, cx + 20, cy + 9 + 4 * open);
  g.stroke();
}

function brow(g, s, p) {
  const raise = s > 0 ? p.browR : p.browL;
  g.strokeStyle = grey(0.08);
  g.lineCap = 'round';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(CX + s * 27, 240 - raise + p.furrow * 9);
  g.quadraticCurveTo(CX + s * 62, 219 - raise * 1.3, CX + s * 98, 238 - raise * 0.6 - p.furrow * 3);
  g.stroke();
}

function mouth(g, p) {
  const y = 398;
  const w = 46 + p.smile * 7 - p.open * 5;
  const cy = y - p.smile * 7;          // corners lift with a smile, drop with a frown
  const gap = p.open * 30;
  const interior = () => {
    g.beginPath();
    g.moveTo(CX - w, cy);
    g.quadraticCurveTo(CX, y + 1 - gap * 0.15, CX + w, cy);
    g.quadraticCurveTo(CX, y + 5 + gap * 1.9 + p.smile * 6, CX - w, cy);
    g.closePath();
  };
  // lower lip
  g.fillStyle = grey(0.62, 0.9);
  g.beginPath();
  g.moveTo(CX - w + 8, cy + 3);
  g.quadraticCurveTo(CX, y + 6 + gap * 1.9 + p.smile * 6, CX + w - 8, cy + 3);
  g.quadraticCurveTo(CX, y + 26 + gap * 1.9 + p.smile * 4, CX - w + 8, cy + 3);
  g.fill();

  g.save();
  interior();
  g.fillStyle = grey(0.03);
  g.fill();
  g.clip();
  g.fillStyle = grey(0.93);            // upper teeth show as the mouth opens
  g.fillRect(CX - w, y - 12, w * 2, 12 + Math.min(gap * 0.4, 9) + p.smile * 3);
  g.restore();

  g.strokeStyle = grey(0.1);           // upper lip edge
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(CX - w, cy);
  g.quadraticCurveTo(CX, y + 1 - gap * 0.15, CX + w, cy);
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
