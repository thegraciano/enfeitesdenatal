import { AssetLibrary, CATEGORIES } from './assets.js';
import { compose, THEMES, TEMPLATES } from './composer.js';
import { render, faceZones } from './renderer.js';
import { canvasToPngWithDpi, makeZip, download, a4Sheets } from './export.js';
import { loadVision, detectFace, cutoutPerson } from './vision.js';
import { randomSeed, makeRng } from './rng.js';

const $ = (s, r = document) => r.querySelector(s);
const lib = new AssetLibrary();
const photos = [];
const MAX_SIDE = 2400;
const tplOrder = makeRng(randomSeed()).shuffle(Object.keys(TEMPLATES));
let visionState = 'idle';

const fillSelect = (sel, obj, val) => { sel.innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${typeof v === 'string' ? v : v.name}</option>`).join(''); if (val) sel.value = val; };
const setStatus = (t) => { $('#status').textContent = t; };
const sizePx = () => Math.round((5 / 2.54) * Number($('#dpi').value));

async function init() {
  fillSelect($('#defTheme'), THEMES, 'vermelho');
  fillSelect($('#impCat'), CATEGORIES);
  try { await lib.init(); } catch (e) { setStatus('Não foi possível carregar assets/manifest.json. Abra o app por um servidor (GitHub Pages ou "npx serve").'); return; }
  setStatus(`${lib.assets.filter((a) => a.img).length} assets profissionais carregados.`);
  warmVision();
}

function warmVision() {
  if (visionState !== 'idle') return;
  visionState = 'loading';
  loadVision().then(() => { visionState = 'ready'; }).catch((e) => { console.warn(e); visionState = 'failed'; });
}

async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

function usageExcept(st) {
  const u = new Map();
  for (const p of photos) if (p !== st && p.comp) for (const it of [...p.comp.items, p.comp.hat].filter(Boolean)) u.set(it.asset.id, (u.get(it.asset.id) || 0) + 1);
  return u;
}

function recompute(st) {
  const z = faceZones(st);
  st.comp = compose({ lib, seed: st.seed, template: st.template, theme: st.theme, face: z.ellipse, usage: usageExcept(st), hat: st.hat && z.detected ? { box: z.box, eyeY: z.eyeY } : null });
  render(st.canvas, st, st.comp, { shadows: true });
}

async function addFiles(files) {
  $('#empty').hidden = true;
  for (const f of [...files]) {
    if (!f.type.startsWith('image/')) continue;
    let bitmap;
    try { bitmap = await fileToCanvas(f); } catch (e) { setStatus(`Não foi possível abrir ${f.name}.`); continue; }
    const st = {
      name: f.name.replace(/\.[^.]+$/, ''), bitmap, w: bitmap.width, h: bitmap.height, face: null, cutout: null,
      useCutout: false, hat: false, view: { zoom: 1, dx: 0, dy: 0 }, seed: randomSeed(),
      template: tplOrder[photos.length % tplOrder.length], theme: $('#defTheme').value,
    };
    photos.push(st); buildCard(st);
    analyze(st);
  }
  $('#btnAll').disabled = $('#btnA4').disabled = !photos.length;
}

async function analyze(st) {
  const busy = $('.busy', st.card); busy.hidden = false;
  recompute(st);
  const wantCut = $('#defCutout').checked, wantHat = $('#defHat').checked;
  try {
    warmVision();
    const vis = await Promise.race([loadVision(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 45000))]);
    st.face = detectFace(vis, st.bitmap);
    if (wantCut) { st.cutout = cutoutPerson(vis, st.bitmap); st.useCutout = true; }
    st.hat = wantHat && !!st.face;
  } catch (e) {
    console.warn('Visão indisponível', e);
    setStatus('Detecção de rosto/recorte indisponível (sem internet?). As artes continuam funcionando com enquadramento manual.');
  }
  $('.facewarn', st.card).hidden = !!st.face;
  $('.cutout', st.card).checked = st.useCutout; $('.cutout', st.card).disabled = !st.cutout;
  $('.hat', st.card).checked = st.hat; $('.hat', st.card).disabled = !st.face;
  busy.hidden = true;
  recompute(st);
}

function buildCard(st) {
  const node = $('#cardTpl').content.firstElementChild.cloneNode(true);
  st.card = node; st.canvas = $('canvas', node);
  const tpl = $('.tpl', node), th = $('.theme', node);
  fillSelect(tpl, TEMPLATES, st.template); fillSelect(th, THEMES, st.theme);
  tpl.onchange = () => { st.template = tpl.value; recompute(st); };
  th.onchange = () => { st.theme = th.value; recompute(st); };
  $('.zoom', node).oninput = (e) => { st.view.zoom = Number(e.target.value); recompute(st); };
  $('.cutout', node).onchange = (e) => { st.useCutout = e.target.checked && !!st.cutout; recompute(st); };
  $('.hat', node).onchange = (e) => { st.hat = e.target.checked; recompute(st); };
  $('.recompose', node).onclick = () => { st.seed = randomSeed(); recompute(st); };
  $('.dl', node).onclick = () => exportOne(st).then(({ blob, name }) => download(blob, name));
  $('.del', node).onclick = () => { photos.splice(photos.indexOf(st), 1); node.remove(); $('#empty').hidden = photos.length > 0; $('#btnAll').disabled = $('#btnA4').disabled = !photos.length; };
  // arrastar para reposicionar
  let drag = null;
  st.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, dx: st.view.dx, dy: st.view.dy }; st.canvas.setPointerCapture(e.pointerId); });
  st.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return; const r = st.canvas.getBoundingClientRect();
    st.view.dx = drag.dx + (e.clientX - drag.x) / r.width; st.view.dy = drag.dy + (e.clientY - drag.y) / r.height;
    render(st.canvas, st, st.comp, { shadows: false });
  });
  const end = () => { if (drag) { drag = null; recompute(st); } };
  st.canvas.addEventListener('pointerup', end); st.canvas.addEventListener('pointercancel', end);
  st.canvas.addEventListener('wheel', (e) => { e.preventDefault(); st.view.zoom = Math.min(2.2, Math.max(0.6, st.view.zoom * (e.deltaY < 0 ? 1.04 : 0.96))); $('.zoom', node).value = st.view.zoom; recompute(st); }, { passive: false });
  $('#grid').appendChild(node);
}

async function renderExport(st) {
  const c = document.createElement('canvas'); c.width = c.height = sizePx();
  render(c, st, st.comp, { shadows: true });
  return c;
}
async function exportOne(st) {
  const c = await renderExport(st);
  const blob = await canvasToPngWithDpi(c, Number($('#dpi').value));
  return { blob, name: `${st.name}-bolinha-natal-5x5cm.png`, canvas: c };
}

$('#btnAll').onclick = async () => {
  setStatus('Gerando arquivos em alta resolução…');
  const files = []; const used = new Set();
  for (const st of photos) { const r = await exportOne(st); let n = r.name, i = 2; while (used.has(n)) n = r.name.replace('.png', `-${i++}.png`); used.add(n); files.push({ name: n, blob: r.blob }); }
  download(await makeZip(files), 'bolinhas-de-natal-5x5cm.zip');
  setStatus(`${files.length} arte(s) exportada(s) a ${$('#dpi').value} DPI.`);
};
$('#btnA4').onclick = async () => {
  const dpi = Math.min(600, Number($('#dpi').value));
  const canvases = []; for (const st of photos) canvases.push(await renderExport(st));
  const sheets = a4Sheets(canvases, dpi); const files = [];
  for (let i = 0; i < sheets.length; i++) files.push({ name: `folha-A4-${i + 1}.png`, blob: await canvasToPngWithDpi(sheets[i], dpi) });
  if (files.length === 1) download(files[0].blob, files[0].name); else download(await makeZip(files), 'folhas-A4.zip');
};

// envio de fotos
const drop = $('#drop');
$('#fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

// biblioteca
function renderLibrary() {
  const by = {};
  for (const a of lib.assets) (by[a.category] ||= []).push(a);
  $('#libList').innerHTML = Object.entries(CATEGORIES).filter(([k]) => by[k]).map(([k, label]) => `
    <h3>${label} <small>${by[k].length}</small></h3>
    <div class="libgrid">${by[k].map((a) => `
      <figure class="${lib.isEnabled(a.id) ? '' : 'off'}" data-id="${a.id}" title="${esc(a.title)} — ${esc(a.source)} · ${esc(a.license)}">
        <img src="${a.src}" alt="" loading="lazy" />
        <figcaption>${esc(a.source)}</figcaption>
        <label class="check"><input type="checkbox" ${lib.isEnabled(a.id) ? 'checked' : ''} /> usar</label>
        ${a.builtin ? '' : '<button class="rm ghost">remover</button>'}
      </figure>`).join('')}</div>`).join('');
  $('#libList').querySelectorAll('figure').forEach((f) => {
    const id = f.dataset.id;
    $('input', f).onchange = (e) => { lib.setEnabled(id, e.target.checked); f.classList.toggle('off', !e.target.checked); photos.forEach(recompute); };
    const rm = $('.rm', f); if (rm) rm.onclick = async () => { await lib.remove(id); renderLibrary(); photos.forEach(recompute); };
  });
}
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('#btnLibrary').onclick = () => { renderLibrary(); $('#libDialog').showModal(); };
$('#impFiles').onchange = async (e) => {
  const added = await lib.importFiles(e.target.files, { category: $('#impCat').value, source: $('#impSrc').value, license: $('#impLic').value || 'Conforme a licença do site de origem', tone: $('#impTone').value });
  e.target.value = ''; renderLibrary(); photos.forEach(recompute);
  setStatus(`${added.length} asset(s) importado(s).`);
};
$('#btnCredits').onclick = () => {
  $('#credList').innerHTML = `<p>Todos os elementos decorativos vêm de bibliotecas públicas de assets. Nenhuma decoração é desenhada ou gerada por IA.</p><table><thead><tr><th></th><th>Elemento</th><th>Autor</th><th>Fonte</th><th>Licença</th></tr></thead><tbody>${lib.assets.map((a) => `<tr><td><img src="${a.src}" alt="" /></td><td>${esc(a.title)}</td><td>${esc(a.author)}</td><td>${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">${esc(a.source)}</a>` : esc(a.source)}</td><td>${esc(a.license)}</td></tr>`).join('')}</tbody></table>`;
  $('#credDialog').showModal();
};

window.__xo = { photos, lib, addFiles, exportOne, recompute };
init();
