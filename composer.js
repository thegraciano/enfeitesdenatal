// Motor de composição: decide QUAIS assets usar e ONDE colocá-los.
// Todas as coordenadas são normalizadas (0..1) em relação ao lado do quadrado 5 × 5 cm.
import { makeRng } from './rng.js?v=20251113';

export const GEO = { cx: 0.5, cy: 0.585, R: 0.38 };
const D2R = Math.PI / 180;

export const THEMES = {
  vermelho: { name: 'Vermelho clássico', glass: ['#ff6b5e', '#d1121c', '#4d0006'], bow: ['red', 'gold'], ball: ['red', 'gold'], accent: ['gold'] },
  vinho:    { name: 'Vinho e dourado', glass: ['#d4546a', '#7c0f27', '#24030c'], bow: ['gold', 'red'], ball: ['gold', 'red'], accent: ['gold'] },
  verde:    { name: 'Verde pinheiro', glass: ['#69d996', '#0e7a3b', '#02230f'], bow: ['red', 'gold'], ball: ['red', 'gold'], accent: ['gold'] },
  azul:     { name: 'Azul inverno', glass: ['#8fc4ff', '#1b4fb3', '#041338'], bow: ['gold'], ball: ['silver', 'blue', 'gold'], accent: ['silver', 'white'] },
  dourado:  { name: 'Dourado luxo', glass: ['#ffe7a3', '#c2861a', '#3d2400'], bow: ['gold', 'red'], ball: ['gold', 'red'], accent: ['gold'] },
  prata:    { name: 'Prata e cristal', glass: ['#ffffff', '#9fb0c6', '#2c3443'], bow: ['red', 'gold'], ball: ['silver', 'blue', 'red'], accent: ['silver', 'white'] },
};

export const TEMPLATES = {
  classico: 'Clássico (laço + neve)',
  canto: 'Arranjo de canto',
  base: 'Arranjo na base',
  guirlanda: 'Guirlanda',
  dourado: 'Fita dourada',
  presentes: 'Presentes',
};

// Ponto de pega do laço (fração da altura onde está o nó)
const KNOT = { 'wm-red-satin-bow': 0.2, 'oc-237995': 0.42, 'oc-236680': 0.45, 'oc-174861': 0.35, 'oc-310694': 0.42, 'oc-172639': 0.4 };

// ---------- geometria ----------
function rimPoint(thetaDeg, rf = 1) {
  return [GEO.cx + GEO.R * rf * Math.cos(thetaDeg * D2R), GEO.cy + GEO.R * rf * Math.sin(thetaDeg * D2R)];
}
export function itemSamples(it) {
  // pontos de amostragem (elipse inscrita + centro) do item já posicionado
  const h = it.w * it.asset.aspect, w = it.w;
  const [px, py] = it.pivot || [0.5, 0.5];
  const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
  const pts = [];
  const lx0 = (0.5 - px) * w, ly0 = (0.5 - py) * h;
  const add = (lx, ly) => { if (it.flip) lx = -lx; pts.push([it.x + lx * c - ly * s, it.y + lx * s + ly * c]); };
  add(lx0, ly0);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    add(lx0 + Math.cos(a) * w * 0.43, ly0 + Math.sin(a) * h * 0.43);
    if (k % 2 === 0) add(lx0 + Math.cos(a) * w * 0.22, ly0 + Math.sin(a) * h * 0.22);
  }
  return pts;
}
function inEllipse([x, y], e) {
  const dx = (x - e.x) / e.rx, dy = (y - e.y) / e.ry;
  return dx * dx + dy * dy < 1;
}
function conflicts(it, face) { return itemSamples(it).some((p) => inEllipse(p, face)); }
function outOfBounds(it, m = 0.004) { return itemSamples(it).some(([x, y]) => x < m || y < m || x > 1 - m || y > 1 - m); }

// Ajusta o item até que ele não cubra o rosto e caiba no quadrado; se não for possível, descarta.
function resolve(it, zones) {
  for (let t = 0; t < 26; t++) {
    const c = it.protect !== false && zones.find((z) => conflicts(it, z));
    const o = outOfBounds(it);
    if (!c && !o) return it;
    if (c) {
      const vx = it.x - c.x, vy = it.y - c.y, n = Math.hypot(vx, vy) || 1;
      it.x += (vx / n) * 0.014; it.y += (vy / n) * 0.014; it.w *= 0.95;
    }
    if (o) {
      const vx = 0.5 - it.x, vy = 0.5 - it.y, n = Math.hypot(vx, vy) || 1;
      it.x += (vx / n) * 0.008; it.y += (vy / n) * 0.008; it.w *= 0.965;
    }
    if (it.w < (it.minW || 0.03)) return null;
  }
  return null;
}

// ---------- composição ----------
export function compose({ lib, seed, template, theme, face, usage, hat, textZone }) {
  const zones = [face, textZone].filter(Boolean);
  const rng = makeRng(seed);
  const T = THEMES[theme] || THEMES.vermelho;
  usage = usage || new Map();
  const items = [];

  const pick = (cat, tones, excludeIds = []) => {
    let c = lib.byCat(cat).filter((a) => !excludeIds.includes(a.id));
    if (tones && tones.length) { const f = c.filter((a) => tones.includes(a.tone)); if (f.length) c = f; }
    if (!c.length) return null;
    // prioriza assets menos usados no lote → variação entre fotografias
    const weights = c.map((a) => 1 / (1 + 2.5 * (usage.get(a.id) || 0)));
    let r = rng.next() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < c.length; i++) { r -= weights[i]; if (r <= 0) { usage.set(c[i].id, (usage.get(c[i].id) || 0) + 1); return c[i]; } }
    return c[c.length - 1];
  };

  const place = (asset, opts) => {
    if (!asset) return null;
    const it = { asset, layer: 'front', rot: 0, flip: false, alpha: 1, ...opts };
    const ok = resolve(it, zones);
    if (ok) items.push(ok);
    return ok;
  };

  // ramo de pinheiro saindo de um ponto (pivot na base do ramo), direção phi (graus)
  const pine = (base, phi, len, layer = 'back') => {
    const a = pick('pine'); if (!a) return;
    const dir = a.dir ?? -90;
    const vertical = Math.abs(Math.sin(dir * D2R)) > 0.7;
    const w = vertical ? len / a.aspect : len;
    let rot = (phi - dir) * D2R;
    place(a, { x: base[0], y: base[1], w, rot, pivot: a.pivot || [0.5, 1], layer, minW: 0.08 });
  };

  const tangentOffset = (theta, along, out = 0) => {
    const t = (theta + 90) * D2R, n = theta * D2R;
    return [Math.cos(t) * along + Math.cos(n) * out, Math.sin(t) * along + Math.sin(n) * out];
  };

  const top = () => {
    const ballTop = GEO.cy - GEO.R;
    const cap = pick('cap');
    let ringY = ballTop - 0.07;
    if (cap) {
      const w = 0.135, h = w * cap.aspect;
      const capItem = { asset: cap, x: 0.5, y: ballTop + 0.028 - h / 2, w, layer: 'front', protect: false };
      items.push(capItem);
      ringY = capItem.y - h * 0.25;
    }
    const bow = pick('bow', rng.chance(0.7) ? [T.bow[0]] : T.bow, ['wm-red-satin-bow']); // sem laço de cauda torta
    if (bow) {
      const knot = KNOT[bow.id] ?? 0.42;
      let w = rng.range(0.5, 0.6);
      if (bow.aspect > 1.1) w = rng.range(0.34, 0.4); // laços com caudas longas
      const h = w * bow.aspect;
      place(bow, { x: 0.5 + rng.range(-0.01, 0.01), y: ringY + (0.5 - knot) * h, w, rot: 0, flip: rng.chance(0.5), layer: 'front', minW: 0.25 });
    }
    return ringY;
  };

  const stars = (n, thetas, size = [0.05, 0.08]) => {
    for (let i = 0; i < n; i++) {
      const th = rng.pick(thetas) + rng.range(-12, 12);
      const [x, y] = rimPoint(th, rng.range(0.98, 1.08));
      place(pick('star', T.accent), { x, y, w: rng.range(size[0], size[1]), rot: rng.range(-20, 20) * D2R, minW: 0.03 });
    }
  };

  const cluster = (theta, kind) => {
    const P = rimPoint(theta, 1.0);
    const add = (dx, dy) => [P[0] + dx, P[1] + dy];
    // ramos atrás da bola, espalhados ao longo da borda
    pine(add(...tangentOffset(theta, 0, -0.02)), theta + 68 + rng.range(-8, 8), rng.range(0.24, 0.3));
    pine(add(...tangentOffset(theta, 0, -0.02)), theta - 68 + rng.range(-8, 8), rng.range(0.24, 0.3));
    if (kind === 'gifts') {
      const g1 = pick('gift'); const g2 = pick('gift', null, g1 ? [g1.id] : []);
      place(g1, { ...xy(add(...tangentOffset(theta, -0.07, 0.02))), w: rng.range(0.15, 0.18), rot: rng.range(-10, 10) * D2R });
      place(g2, { ...xy(add(...tangentOffset(theta, 0.07, 0.04))), w: rng.range(0.12, 0.14), rot: rng.range(-12, 12) * D2R });
      if (rng.chance(0.5)) place(pick('ball', T.ball), { ...xy(add(...tangentOffset(theta, 0.0, 0.08))), w: rng.range(0.09, 0.11) });
    } else {
      const b1 = pick('ball', T.ball); const b2 = pick('ball', T.ball, b1 ? [b1.id] : []);
      place(b1, { ...xy(add(...tangentOffset(theta, -0.075, 0.03))), w: rng.range(0.14, 0.17), rot: rng.range(-15, 15) * D2R });
      place(b2, { ...xy(add(...tangentOffset(theta, 0.085, 0.045))), w: rng.range(0.1, 0.12), rot: rng.range(-15, 15) * D2R });
      if (rng.chance(0.55)) place(pick('bell'), { ...xy(add(...tangentOffset(theta, 0.02, 0.08))), w: rng.range(0.12, 0.14), rot: rng.range(-15, 15) * D2R });
      else if (rng.chance(0.6)) place(pick('pinecone'), { ...xy(add(...tangentOffset(theta, 0.03, 0.08))), w: rng.range(0.11, 0.13), rot: rng.range(0, 360) * D2R });
    }
    // flor ou azevinho na frente, cobrindo as bases dos ramos
    if (rng.chance(0.5)) place(pick('flower'), { ...xy(add(...tangentOffset(theta, 0, 0.0))), w: rng.range(0.18, 0.21), rot: rng.range(-15, 15) * D2R });
    else place(pick('leaves'), { ...xy(add(...tangentOffset(theta, 0, 0.0))), w: rng.range(0.17, 0.2), rot: rng.range(-25, 25) * D2R, flip: rng.chance(0.5) });
    place(pick('star', T.accent), { ...xy(add(...tangentOffset(theta, rng.pick([-1, 1]) * 0.12, 0.05))), w: rng.range(0.055, 0.075), rot: rng.range(-20, 20) * D2R });
  };
  const xy = ([x, y]) => ({ x, y });

  const accent = (theta) => {
    const P = rimPoint(theta, 1.02);
    place(pick('leaves'), { x: P[0], y: P[1], w: rng.range(0.12, 0.14), rot: (theta + 90 + rng.range(-20, 20)) * D2R, flip: rng.chance(0.5) });
    const S2 = rimPoint(theta + rng.pick([-14, 14]), 1.1);
    place(pick('star', T.accent), { x: S2[0], y: S2[1], w: rng.range(0.045, 0.06), rot: rng.range(-20, 20) * D2R });
  };

  // ----- modelos -----
  const mirror = rng.chance(0.5);
  const side = (deg) => (mirror ? 180 - deg : deg);
  switch (template) {
    case 'canto':
      top(); cluster(side(132), 'balls'); accent(side(-40)); break;
    case 'presentes':
      top(); cluster(side(48), 'gifts'); accent(side(-140));
      { const B = rimPoint(side(140), 1.02); place(pick('bell'), { x: B[0], y: B[1], w: 0.13, rot: rng.range(-10, 10) * D2R }); } break;
    case 'base': {
      top();
      const P = rimPoint(90, 1.03);
      pine([P[0] - 0.03, P[1] - 0.02], 180 + rng.range(8, 22), rng.range(0.28, 0.34));
      pine([P[0] + 0.03, P[1] - 0.02], 0 - rng.range(8, 22), rng.range(0.28, 0.34));
      const b1 = pick('ball', T.ball), b2 = pick('ball', T.ball, b1 ? [b1.id] : []);
      const L = rimPoint(118, 1.02), Rr = rimPoint(62, 1.02);
      place(b1, { x: L[0], y: L[1], w: rng.range(0.12, 0.14) });
      place(b2, { x: Rr[0], y: Rr[1], w: rng.range(0.12, 0.14) });
      if (rng.chance(0.6)) place(pick('flower'), { x: P[0], y: P[1] - 0.005, w: rng.range(0.15, 0.17) });
      else place(pick('leaves'), { x: P[0], y: P[1] - 0.005, w: rng.range(0.15, 0.17), flip: rng.chance(0.5) });
      stars(2, [-150, -30], [0.05, 0.07]);
      break;
    }
    case 'guirlanda': {
      const wr = pick('wreath');
      if (wr && wr.hasBow) {
        const [rx, ry, rr] = wr.ring; const w = (GEO.R * 1.04) / rr; const h = w * wr.aspect;
        items.push({ asset: wr, x: GEO.cx + (0.5 - rx) * w, y: GEO.cy + (0.5 - ry) * h, w, layer: 'front', protect: false });
      } else {
        top();
        if (wr) { const rr = wr.ring ? wr.ring[2] : 0.47; items.push({ asset: wr, x: GEO.cx, y: GEO.cy, w: (GEO.R * 1.06) / rr, rot: rng.range(0, 360) * D2R, layer: 'front', protect: false }); }
      }
      const B = rimPoint(90, 1.0);
      place(pick('bell'), { x: B[0] + 0.04, y: B[1] - 0.02, w: rng.range(0.13, 0.15), rot: rng.range(-10, 10) * D2R });
      place(pick('leaves'), { x: B[0] - 0.05, y: B[1] - 0.01, w: 0.14, flip: rng.chance(0.5) });
      stars(2, [side(150), side(30)], [0.05, 0.07]);
      break;
    }
    case 'dourado': {
      // arranjo dourado: tons metálicos em todos os elementos
      top();
      // fita dourada na horizontal, centralizada logo abaixo da bolinha
      { const rb = pick('ribbon', ['gold']);
        if (rb) { const w = rng.range(0.47, 0.5), h = w * rb.aspect;
          items.push({ asset: rb, x: 0.5, y: Math.min(1 - h / 2 - 0.004, GEO.cy + GEO.R - 0.01), w, flip: rng.chance(0.5), layer: 'front', protect: false }); } }
      cluster(side(12), 'balls'); accent(side(-140));
      { const B = rimPoint(side(168), 1.02); place(pick('bell'), { x: B[0], y: B[1], w: 0.12, rot: rng.range(-10, 10) * D2R }); }
      stars(2, [side(-40), side(-150)], [0.05, 0.07]);
      break;
    }
    default: { // clássico
      top();
      const s = rng.pick([-1, 1]);
      const P = [0.5 + s * 0.13, GEO.cy - GEO.R + 0.005];
      place(pick('leaves'), { x: P[0], y: P[1], w: 0.15, rot: s * 25 * D2R, flip: s < 0, layer: 'back' });
      stars(rng.int(2, 3), [-160, -20, 160, 20], [0.045, 0.07]);
    }
  }

  // ----- elementos internos (dentro do vidro) -----
  const inner = [];
  const flakes = lib.byCat('snowflake').filter((a) => (theme === 'dourado' ? true : a.tone !== 'gold'));
  const nF = rng.int(8, 13);
  const innerFace = { x: face.x, y: face.y, rx: face.rx * 1.15, ry: face.ry * 1.12 };
  for (let i = 0, tries = 0; i < nF && tries < 200; tries++) {
    const ang = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.range(0.15, 0.86)) * GEO.R;
    const it = { asset: rng.pick(flakes), x: GEO.cx + Math.cos(ang) * rr, y: GEO.cy + Math.sin(ang) * rr, w: rng.range(0.035, 0.1), rot: rng.range(0, 60) * D2R, alpha: rng.range(0.55, 0.92), kind: 'flake' };
    if (!it.asset || conflicts(it, innerFace) || (textZone && conflicts(it, textZone))) continue;
    if (Math.hypot(it.x - GEO.cx, it.y - GEO.cy) + it.w / 2 > GEO.R * 0.97) continue;
    inner.push(it); i++;
  }
  const sp = lib.byCat('sparkle');
  const nS = rng.int(4, 7);
  for (let i = 0, tries = 0; i < nS && tries < 100 && sp.length; tries++) {
    const ang = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.range(0.2, 0.8)) * GEO.R;
    const it = { asset: rng.pick(sp), x: GEO.cx + Math.cos(ang) * rr, y: GEO.cy + Math.sin(ang) * rr, w: rng.range(0.035, 0.065), rot: 0, alpha: 1, kind: 'sparkle', tint: T.accent[0] === 'gold' ? '#ffd76a' : '#ffffff' };
    if (conflicts(it, innerFace) || (textZone && conflicts(it, textZone))) continue;
    inner.push(it); i++;
  }

  // ----- gorro (opcional, apenas com rosto detectado) -----
  let hatItem = null;
  if (hat && hat.box) {
    const a = pick('hat');
    if (a) {
      // aba do gorro na linha do cabelo, acima dos olhos; o rosto nunca é coberto
      const b = hat.box; let w = b.w * 1.95; let h = w * a.aspect;
      const bottom = Math.min(b.y + b.h * 0.02, hat.eyeY - b.h * 0.3);
      const topLimit = GEO.cy - GEO.R + 0.015;
      if (bottom - h * 0.94 < topLimit) { h = (bottom - topLimit) / 0.94; w = h / a.aspect; }
      if (w > b.w * 1.4) hatItem = { asset: a, x: b.x + b.w * 0.5 + w * 0.08, y: bottom - h / 2 + h * 0.06, w, rot: -5 * D2R, layer: 'hat' };
    }
  }

  return { seed, template, theme, items, inner, hat: hatItem, captionFit: template === 'guirlanda' ? 0.6 : 0.86 };
}
