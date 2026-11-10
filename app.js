import { AssetLibrary, CATEGORIES } from './assets.js?v=20251114';
import { compose, THEMES, TEMPLATES, buildDesigns } from './composer.js?v=20251114';
import { render, faceZones, textLayout } from './renderer.js?v=20251114';
import { canvasToPngWithDpi, makeZip, download, a4Sheets, a4Pdf } from './export.js?v=20251114';
import { loadVision, detectFace, cutoutPerson } from './vision.js?v=20251114';
import { randomSeed, makeRng } from './rng.js?v=20251114';

const $ = (s, r = document) => r.querySelector(s);
const lib = new AssetLibrary();
const photos = [];
const MAX_SIDE = 2400;
let designs = [];       // todos os designs (modelo + laço/guirlanda), sem depender de "Nova composição"
let designOrder = [];   // ordem de distribuição para fotos novas (alterna modelos)
const orderRng = makeRng(randomSeed());
function rebuildDesigns() {
  designs = buildDesigns(lib);
  const groups = {};
  for (const d of designs) (groups[d.template] ||= []).push(d);
  const lists = orderRng.shuffle(Object.keys(groups)).map((k) => orderRng.shuffle([...groups[k]]));
  designOrder = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) designOrder.push(l[i].key);
  for (const p of photos) if (!designs.some((d) => d.key === p.design)) setDesign(p, designOrder[0]);
}
const designOf = (st) => designs.find((d) => d.key === st.design) || designs[0];
function setDesign(st, key) { st.design = key; st.template = (designs.find((d) => d.key === key) || designs[0])?.template || 'classico'; }
let visionState = 'idle';

const fillSelect = (sel, obj, val) => { sel.innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${typeof v === 'string' ? v : v.name}</option>`).join(''); if (val) sel.value = val; };
const setStatus = (t) => { $('#status').textContent = t; };
const sizePx = () => Math.round((5 / 2.54) * Number($('#dpi').value));

async function init() {
  fillSelect($('#defTheme'), THEMES, 'vermelho');
  fillSelect($('#impCat'), CATEGORIES);
  try { await Promise.all([document.fonts.load('80px "Great Vibes"'), document.fonts.load('700 40px Montserrat')]); } catch (e) { console.warn('fontes', e); }
  try { await lib.init(); } catch (e) { setStatus('Não foi possível carregar assets/manifest.json. Abra o app por um servidor (GitHub Pages ou "npx serve").'); return; }
  setStatus(`Tudo pronto! ${lib.assets.filter((a) => a.img).length} enfeites carregados. 🎅`);
  rebuildDesigns();
  setupEditor();
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

let current = null;
const THUMB = 240;
const textDefault = { color: '#ffffff', opacity: 1 };
const SWATCHES = { Branco: '#ffffff', Dourado: '#f2c96b', Creme: '#fff1d0', Vermelho: '#c8102e', Verde: '#0f6b3a', Prata: '#d9dee6' };

function recompute(st) {
  const z = faceZones(st);
  st.comp = compose({ lib, seed: st.seed, template: st.template, design: designOf(st), theme: st.theme, face: z.ellipse, usage: usageExcept(st), hat: null, textZone: textLayout(st).zone });
  render(st.thumb, st, st.comp, { shadows: true });
  if (st === current) render($('#mainCanvas'), st, st.comp, { shadows: true });
}

async function addFiles(files) {
  $('#empty').hidden = true;
  for (const f of [...files]) {
    if (!f.type.startsWith('image/')) continue;
    let bitmap;
    try { bitmap = await fileToCanvas(f); } catch (e) { setStatus(`Não foi possível abrir ${f.name}.`); continue; }
    const st = {
      name: f.name.replace(/\.[^.]+$/, ''), bitmap, w: bitmap.width, h: bitmap.height, face: null, cutout: null,
      useCutout: false, hat: false, busy: true, view: { zoom: 1, dx: 0, dy: 0 }, seed: randomSeed(), text: { ...textDefault },
      theme: $('#defTheme').value,
    };
    setDesign(st, designOrder[photos.length % designOrder.length]);
    photos.push(st); buildThumb(st);
    if (!current) select(st);
    analyze(st);
  }
  refreshUi();
}

async function analyze(st) {
  recompute(st);
  const wantCut = $('#defCutout').checked;
  try {
    warmVision();
    const vis = await Promise.race([loadVision(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 45000))]);
    st.face = detectFace(vis, st.bitmap);
    if (wantCut) { st.cutout = cutoutPerson(vis, st.bitmap); st.useCutout = !!st.cutout; st.noPerson = !st.cutout; }
  } catch (e) {
    console.warn('Visão indisponível', e);
    setStatus('Detecção de rosto/recorte indisponível (sem internet?). As artes continuam funcionando com enquadramento manual.');
  }
  st.busy = false;
  recompute(st);
  if (st === current) syncPanel();
}

function buildThumb(st) {
  const fig = document.createElement('button');
  fig.className = 'thumb'; fig.title = st.name;
  st.thumb = document.createElement('canvas'); st.thumb.width = st.thumb.height = THUMB;
  fig.appendChild(st.thumb);
  fig.onclick = () => select(st);
  st.thumbEl = fig;
  $('#strip').appendChild(fig);
}

function select(st) {
  current = st;
  photos.forEach((p) => p.thumbEl.classList.toggle('active', p === st));
  if (st) { if (st.comp) render($('#mainCanvas'), st, st.comp, { shadows: true }); else recompute(st); syncPanel(); st.thumbEl.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
  refreshUi();
}

function syncPanel() {
  const st = current; if (!st) return;
  const nice = st.name && st.name.length <= 22 && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(st.name);
  $('#photoName').textContent = nice ? st.name : `Bolinha ${photos.indexOf(st) + 1}`;
  $('#counter').textContent = `Foto ${photos.indexOf(st) + 1} de ${photos.length}`;
  const di = Math.max(0, designs.findIndex((d) => d.key === st.design));
  $('#designName').textContent = designs[di]?.name || ''; $('#designCount').textContent = `${di + 1} de ${designs.length}`;
  const tk = Object.keys(THEMES), ti = Math.max(0, tk.indexOf(st.theme));
  $('#themeName').textContent = THEMES[tk[ti]].name; $('#themeCount').textContent = `${ti + 1} de ${tk.length}`;
  $('#themeDot').style.background = `radial-gradient(circle at 35% 30%, ${THEMES[tk[ti]].glass[0]}, ${THEMES[tk[ti]].glass[1]} 55%, ${THEMES[tk[ti]].glass[2]})`;
  $('#zoom').value = st.view.zoom;
  $('#cutout').checked = st.useCutout; $('#cutout').disabled = !st.cutout;
  $('#txtColor').value = st.text.color;
  document.querySelectorAll('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === st.text.color.toLowerCase()));
  $('#facewarn').hidden = st.busy || !!st.face;
  $('#cutwarn').hidden = st.busy || !st.noPerson;
  $('#busy').hidden = !st.busy;
}

function refreshUi() {
  const has = photos.length > 0;
  $('#editor').hidden = !has; $('#empty').hidden = has;
  $('#btnAll').disabled = $('#btnA4').disabled = $('#btnPdf').disabled = !has;
  $('#prev').disabled = $('#next').disabled = photos.length < 2;
  if (current) syncPanel();
}

function setupEditor() {
  const cycle = (d) => { if (!current || !designs.length) return; const i = designs.findIndex((x) => x.key === current.design); setDesign(current, designs[(i + d + designs.length) % designs.length].key); recompute(current); syncPanel(); };
  $('#designPrev').onclick = () => cycle(-1); $('#designNext').onclick = () => cycle(1);
  const tcycle = (d) => { if (!current) return; const tk = Object.keys(THEMES); const i = tk.indexOf(current.theme); current.theme = tk[(i + d + tk.length) % tk.length]; recompute(current); syncPanel(); };
  $('#themePrev').onclick = () => tcycle(-1); $('#themeNext').onclick = () => tcycle(1);
  $('#zoom').oninput = (e) => { current.view.zoom = Number(e.target.value); recompute(current); };
  $('#cutout').onchange = (e) => { current.useCutout = e.target.checked && !!current.cutout; recompute(current); };
  $('#swatches').innerHTML = Object.entries(SWATCHES).map(([n, c]) => `<button type="button" title="${n}" data-c="${c}" style="background:${c}"></button>`).join('');
  const setColor = (c) => { current.text.color = c; textDefault.color = c; recompute(current); syncPanel(); };
  $('#swatches').onclick = (e) => { const b = e.target.closest('button'); if (b && current) setColor(b.dataset.c); };
  $('#txtColor').oninput = (e) => current && setColor(e.target.value);
  $('#txtAll').onclick = () => { if (!current) return; for (const p of photos) { p.text = { ...current.text }; recompute(p); } setStatus('Cor das letras aplicada a todas as bolinhas.'); };
  $('#recompose').onclick = () => { current.seed = randomSeed(); recompute(current); };
  $('#dl').onclick = () => guarded('baixar o PNG', async () => { const { blob, name } = await exportOne(current); download(blob, name); });
  $('#del').onclick = () => {
    const i = photos.indexOf(current); photos.splice(i, 1); current.thumbEl.remove();
    current = null; select(photos[Math.min(i, photos.length - 1)] || null);
  };
  const step = (d) => { if (photos.length < 2) return; const i = photos.indexOf(current); select(photos[(i + d + photos.length) % photos.length]); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  document.addEventListener('keydown', (e) => { if (e.target.matches('input,select') || document.querySelector('dialog[open]')) return; if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
  const cv = $('#mainCanvas'); let drag = null;
  cv.addEventListener('pointerdown', (e) => { if (!current) return; drag = { x: e.clientX, y: e.clientY, dx: current.view.dx, dy: current.view.dy }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return; const r = cv.getBoundingClientRect();
    current.view.dx = drag.dx + (e.clientX - drag.x) / r.width; current.view.dy = drag.dy + (e.clientY - drag.y) / r.height;
    render(cv, current, current.comp, { shadows: false });
  });
  const end = () => { if (drag) { drag = null; recompute(current); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => { if (!current) return; e.preventDefault(); current.view.zoom = Math.min(2.2, Math.max(0.6, current.view.zoom * (e.deltaY < 0 ? 1.04 : 0.96))); $('#zoom').value = current.view.zoom; recompute(current); }, { passive: false });
}

const EXPORT_BTNS = ['#btnAll', '#btnA4', '#btnPdf', '#dl'];
let exporting = false;
async function guarded(label, fn) {
  if (exporting) return; exporting = true;
  EXPORT_BTNS.forEach((b) => { $(b).disabled = true; }); document.body.classList.add('exporting');
  try { await fn(); } catch (e) { console.error(e); setStatus(`Erro ao ${label}: ${e.message || e}. Tente uma resolução menor.`); }
  finally { exporting = false; document.body.classList.remove('exporting'); EXPORT_BTNS.forEach((b) => { $(b).disabled = false; }); refreshUi(); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function renderAll(what) {
  const out = [];
  for (const [i, st] of photos.entries()) { setStatus(`${what}… ${i + 1}/${photos.length}`); await tick(); out.push(await renderExport(st)); }
  return out;
}

async function renderExport(st, mirror = false) {
  const c = document.createElement('canvas'); c.width = c.height = sizePx();
  render(c, st, st.comp, { shadows: true, mirror });
  return c;
}
async function exportOne(st) {
  const c = await renderExport(st);
  const blob = await canvasToPngWithDpi(c, Number($('#dpi').value));
  return { blob, name: `${st.name}-bolinha-natal-5x5cm.png`, canvas: c };
}

$('#btnAll').onclick = () => guarded('gerar o ZIP', async () => {
  const files = []; const used = new Set();
  for (const [k, st] of photos.entries()) { setStatus(`Gerando arquivos em alta resolução… ${k + 1}/${photos.length}`); await tick(); const r = await exportOne(st); let n = r.name, i = 2; while (used.has(n)) n = r.name.replace('.png', `-${i++}.png`); used.add(n); files.push({ name: n, blob: r.blob }); }
  download(await makeZip(files), 'bolinhas-de-natal-5x5cm.zip');
  setStatus(`${files.length} arte(s) exportada(s) a ${$('#dpi').value} DPI.`);
});
$('#btnA4').onclick = () => guarded('gerar a folha A4', async () => {
  const dpi = Math.min(600, Number($('#dpi').value));
  const canvases = await renderAll('Montando folha A4');
  const sheets = a4Sheets(canvases, dpi, $('#a4Pairs').checked); const files = [];
  for (let i = 0; i < sheets.length; i++) files.push({ name: `folha-A4-${i + 1}.png`, blob: await canvasToPngWithDpi(sheets[i], dpi) });
  if (files.length === 1) download(files[0].blob, files[0].name); else download(await makeZip(files), 'folhas-A4.zip');
  setStatus(`Folha A4 gerada: ${sheets.length} folha(s). Imprima em "Tamanho real" (100%).`);
});

$('#btnPdf').onclick = () => guarded('gerar o PDF', async () => {
  {
    const dpi = Math.min(600, Math.max(300, Number($('#dpi').value)));
    const canvases = await renderAll('Gerando PDF da folha A4');
    let backs = null;
    if ($('#a4Pairs').checked) { // verso: só os enfeites espelhados; foto e texto normais (a frente não é alterada)
      backs = [];
      for (const [i, st] of photos.entries()) { setStatus(`Gerando versos espelhados… ${i + 1}/${photos.length}`); await tick(); backs.push(await renderExport(st, true)); }
    }
    const sheets = a4Sheets(canvases, dpi, $('#a4Pairs').checked, backs);
    download(await a4Pdf(sheets), 'bolinhas-de-natal-A4.pdf');
    setStatus(`PDF gerado: ${sheets.length} página(s) A4, ${canvases.length} bolinha(s) de 5 × 5 cm${$('#a4Pairs').checked ? ' (original + verso com enfeites espelhados; foto e texto normais)' : ''}. Imprima em "Tamanho real" (100%).`);
  }
});

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
    $('input', f).onchange = (e) => { lib.setEnabled(id, e.target.checked); f.classList.toggle('off', !e.target.checked); rebuildDesigns(); photos.forEach(recompute); syncPanel(); };
    const rm = $('.rm', f); if (rm) rm.onclick = async () => { await lib.remove(id); renderLibrary(); rebuildDesigns(); photos.forEach(recompute); syncPanel(); };
  });
}
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('#btnLibrary').onclick = () => { renderLibrary(); $('#libDialog').showModal(); };
$('#impFiles').onchange = async (e) => {
  const added = await lib.importFiles(e.target.files, { category: $('#impCat').value, source: $('#impSrc').value, license: $('#impLic').value || 'Conforme a licença do site de origem', tone: $('#impTone').value });
  e.target.value = ''; renderLibrary(); rebuildDesigns(); photos.forEach(recompute); syncPanel();
  setStatus(`${added.length} asset(s) importado(s).`);
};
$('#btnCredits').onclick = () => {
  $('#credList').innerHTML = `<p>Todos os elementos decorativos vêm de bibliotecas públicas de assets. Nenhuma decoração é desenhada ou gerada por IA.</p><table><thead><tr><th></th><th>Elemento</th><th>Autor</th><th>Fonte</th><th>Licença</th></tr></thead><tbody>${lib.assets.map((a) => `<tr><td><img src="${a.src}" alt="" /></td><td>${esc(a.title)}</td><td>${esc(a.author)}</td><td>${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">${esc(a.source)}</a>` : esc(a.source)}</td><td>${esc(a.license)}</td></tr>`).join('')}</tbody></table>`;
  $('#credDialog').showModal();
};

// colar imagem com Ctrl+V
document.addEventListener('paste', (e) => {
  const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (imgs.length) { e.preventDefault(); addFiles(imgs); }
});
// evita perder o trabalho ao fechar/atualizar a página sem querer
window.addEventListener('beforeunload', (e) => { if (photos.length) { e.preventDefault(); e.returnValue = ''; } });

window.__xo = { photos, lib, addFiles, exportOne, recompute };
init();
