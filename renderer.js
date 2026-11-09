// Renderização em canvas: fotografia + vidro da bola + assets posicionados.
import { GEO, THEMES } from './composer.js';

export function photoTransform(st) {
  const { w, h } = st; const { cx, cy, R } = GEO;
  let k0, fx, fy, tx = cx, ty = cy - 0.012;
  if (st.face) {
    const b = st.face.box;
    // com gorro, o rosto fica um pouco menor e mais baixo para o gorro caber dentro do vidro
    k0 = (st.hat ? 0.205 : 0.245) / b.h; fx = b.x + b.w / 2; fy = b.y + b.h * 0.5;
    if (st.hat) ty = cy + 0.06;
  } else {
    k0 = (2 * R) / Math.min(w, h); fx = w / 2; fy = h / 2; ty = cy + 0.02;
  }
  let k = k0 * (st.view.zoom || 1);
  const cover = (2 * R) / Math.min(w, h);
  if (!st.useCutout) k = Math.max(k, cover * 1.001);
  let ox = tx - fx * k + (st.view.dx || 0), oy = ty - fy * k + (st.view.dy || 0);
  if (!st.useCutout) { // a foto precisa cobrir a bola inteira
    ox = Math.min(ox, cx - R); ox = Math.max(ox, cx + R - w * k);
    oy = Math.min(oy, cy - R); oy = Math.max(oy, cy + R - h * k);
  }
  return { k, ox, oy };
}

export function faceZones(st) {
  const { k, ox, oy } = photoTransform(st);
  let box;
  if (st.face) {
    const b = st.face.box; box = { x: ox + b.x * k, y: oy + b.y * k, w: b.w * k, h: b.h * k };
  } else {
    box = { x: GEO.cx - 0.13, y: GEO.cy - 0.18, w: 0.26, h: 0.3 };
  }
  const ellipse = { x: box.x + box.w / 2, y: box.y + box.h * 0.42, rx: box.w * 0.68, ry: box.h * 0.82 };
  const eyeY = st.face && st.face.eyes ? oy + k * (st.face.eyes[0][1] + st.face.eyes[1][1]) / 2 : box.y + box.h * 0.35;
  return { box, ellipse, eyeY, detected: !!st.face };
}

// ---------- texto fixo e obrigatório ----------
export const CAPTION = ['Feliz Natal', 'SCFV Espaço Amigo'];
export function textLayout(st) {
  const z = faceZones(st);
  const chin = z.box.y + z.box.h * 1.02;
  const y1 = Math.max(GEO.cy + 0.2, Math.min(GEO.cy + 0.25, chin + 0.075));
  const y2 = y1 + 0.068;
  return { y1, y2, zone: { x: 0.5, y: (y1 + y2) / 2, rx: 0.3, ry: 0.078 } };
}
const chord = (y) => 2 * Math.sqrt(Math.max(0, GEO.R * GEO.R - (y - GEO.cy) ** 2));
function drawCaption(ctx, S, st, fitK = 0.86) {
  const t = st.text || { color: '#ffffff', opacity: 1 };
  const { y1, y2 } = textLayout(st);
  ctx.save();
  ctx.globalAlpha = Math.max(0.3, Math.min(1, t.opacity));
  ctx.fillStyle = t.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = S * 0.009; ctx.shadowOffsetY = S * 0.002;
  const fit = (txt, size, font, maxW) => { ctx.font = font(size); const w = ctx.measureText(txt).width; if (w > maxW) ctx.font = font(size * maxW / w); };
  fit(CAPTION[0], S * 0.105, (z) => `${z}px "Great Vibes", "Brush Script MT", cursive`, chord(y1) * S * fitK);
  ctx.fillText(CAPTION[0], 0.5 * S, y1 * S);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(S * 0.0016).toFixed(1)}px`;
  fit(CAPTION[1], S * 0.04, (z) => `700 ${z}px Montserrat, Arial, sans-serif`, chord(y2) * S * (fitK - 0.02));
  ctx.fillText(CAPTION[1], 0.5 * S, y2 * S);
  ctx.restore();
}

const tintCache = new Map();
function tinted(img, color) {
  const key = img.src + color;
  if (tintCache.has(key)) return tintCache.get(key);
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-over'; x.globalAlpha = 0.6; x.drawImage(img, 0, 0);
  tintCache.set(key, c); return c;
}

function drawItem(ctx, S, it) {
  const a = it.asset; if (!a || !a.img) return;
  const w = it.w * S, h = w * a.aspect; const [px, py] = it.pivot || [0.5, 0.5];
  ctx.save();
  ctx.translate(it.x * S, it.y * S); ctx.rotate(it.rot || 0); if (it.flip) ctx.scale(-1, 1);
  ctx.globalAlpha = it.alpha ?? 1;
  if (it.kind === 'sparkle') { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(tinted(a.img, it.tint || '#fff'), -px * w, -py * h, w, h); }
  else ctx.drawImage(a.img, -px * w, -py * h, w, h);
  ctx.restore();
}

// sombra suave de contato para assets da frente (dá profundidade, sem sair do PNG transparente)
function drawShadowed(ctx, S, it) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = S * 0.012; ctx.shadowOffsetY = S * 0.004;
  drawItem(ctx, S, it);
  ctx.restore();
}

export function render(canvas, st, comp, { shadows = true } = {}) {
  const S = canvas.width; const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, S, S);
  const T = THEMES[comp.theme] || THEMES.vermelho;
  const cx = GEO.cx * S, cy = GEO.cy * S, R = GEO.R * S;

  for (const it of comp.items) if (it.layer === 'back') shadows ? drawShadowed(ctx, S, it) : drawItem(ctx, S, it);

  // ---- interior da bola ----
  const L = document.createElement('canvas'); L.width = L.height = S;
  const lc = L.getContext('2d'); lc.imageSmoothingQuality = 'high';
  lc.save(); lc.beginPath(); lc.arc(cx, cy, R, 0, Math.PI * 2); lc.closePath(); lc.clip();
  const { k, ox, oy } = photoTransform(st);
  if (st.useCutout && st.cutout) {
    const g = lc.createRadialGradient(cx - R * 0.15, cy - R * 0.1, R * 0.05, cx, cy, R);
    g.addColorStop(0, T.glass[0]); g.addColorStop(0.55, T.glass[1]); g.addColorStop(1, T.glass[2]);
    lc.fillStyle = g; lc.fillRect(0, 0, S, S);
    for (const it of comp.inner) drawItem(lc, S, it);
    // pessoa recortada, com dissolução suave na parte inferior (como no exemplo)
    const P = document.createElement('canvas'); P.width = P.height = S; const pc = P.getContext('2d'); pc.imageSmoothingQuality = 'high';
    pc.drawImage(st.cutout, ox * S, oy * S, st.w * k * S, st.h * k * S);
    const pb = Math.min(cy + R, (oy + st.h * k) * S);
    const fg = pc.createLinearGradient(0, Math.min(cy + R * 0.5, pb - R * 0.35), 0, pb);
    fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,0.92)');
    pc.globalCompositeOperation = 'destination-out'; pc.fillStyle = fg; pc.fillRect(0, 0, S, S);
    // suaviza as bordas laterais da foto quando ficam dentro do vidro
    const pl = ox * S, pr = (ox + st.w * k) * S, fw = S * 0.035;
    if (pl > cx - R) { const gl = pc.createLinearGradient(pl, 0, pl + fw, 0); gl.addColorStop(0, 'rgba(0,0,0,1)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); pc.fillStyle = gl; pc.fillRect(pl, 0, fw, S); }
    if (pr < cx + R) { const gr = pc.createLinearGradient(pr - fw, 0, pr, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); pc.fillStyle = gr; pc.fillRect(pr - fw, 0, fw, S); }
    lc.drawImage(P, 0, 0);
  } else {
    lc.drawImage(st.bitmap, ox * S, oy * S, st.w * k * S, st.h * k * S);
    for (const it of comp.inner) drawItem(lc, S, it);
  }
  if (comp.hat) { lc.save(); lc.shadowColor = 'rgba(0,0,0,0.3)'; lc.shadowBlur = S * 0.01; drawItem(lc, S, comp.hat); lc.restore(); }

  // ---- efeito de vidro ----
  let g = lc.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
  g.addColorStop(0, hexA(T.glass[1], 0)); g.addColorStop(0.7, hexA(T.glass[1], 0.28)); g.addColorStop(1, hexA(T.glass[2], 0.78));
  lc.fillStyle = g; lc.fillRect(0, 0, S, S);
  lc.save(); lc.translate(cx - R * 0.42, cy - R * 0.5); lc.rotate(-0.68); lc.scale(1, 0.42);
  g = lc.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.42)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  lc.fillStyle = g; lc.beginPath(); lc.arc(0, 0, R * 0.5, 0, Math.PI * 2); lc.fill(); lc.restore();
  lc.lineCap = 'round';
  lc.strokeStyle = 'rgba(255,255,255,0.55)'; lc.lineWidth = R * 0.022;
  lc.beginPath(); lc.arc(cx, cy, R * 0.9, Math.PI * 1.08, Math.PI * 1.3); lc.stroke();
  lc.strokeStyle = 'rgba(255,255,255,0.22)'; lc.lineWidth = R * 0.03;
  lc.beginPath(); lc.arc(cx, cy, R * 0.92, Math.PI * 0.12, Math.PI * 0.36); lc.stroke();
  lc.restore();
  // aro do vidro
  g = lc.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.5, hexA(T.glass[0], 0.6)); g.addColorStop(1, hexA(T.glass[2], 0.9));
  lc.strokeStyle = g; lc.lineWidth = Math.max(1.5, S * 0.007);
  lc.beginPath(); lc.arc(cx, cy, R - lc.lineWidth / 2, 0, Math.PI * 2); lc.stroke();
  ctx.drawImage(L, 0, 0);

  for (const it of comp.items) if (it.layer === 'front') shadows ? drawShadowed(ctx, S, it) : drawItem(ctx, S, it);
  drawCaption(ctx, S, st, comp.captionFit || 0.86); // sempre presente, por cima de tudo
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
