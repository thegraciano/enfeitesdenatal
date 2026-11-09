// Uso: node tools/build-manifest.mjs
// Adiciona ao assets/manifest.json qualquer PNG/SVG/WEBP colocado em assets/<categoria>/ que ainda não esteja listado,
// e regenera CREDITS.md. Prefixe os arquivos com a fonte para preencher os créditos automaticamente, ex.:
//   assets/bow/freepik-laco-vermelho-cetim.png   assets/star/flaticon-estrela-dourada.svg
// Opcional: assets/<categoria>/sources.json  →  { "arquivo.png": { "author": "...", "license": "...", "url": "...", "tone": "red" } }
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const A = path.join(ROOT, 'assets');
const CATS = ['bow','pine','wreath','star','snowflake','gift','bell','ball','leaves','flower','ribbon','sparkle','pinecone','cap','hat'];
const SOURCES = { freepik: 'Freepik', flaticon: 'Flaticon', svgrepo: 'SVG Repo', icons8: 'Icons8', pixabay: 'Pixabay', openmoji: 'OpenMoji', openclipart: 'Openclipart', oc: 'Openclipart', wm: 'Wikimedia Commons' };
const LICENSES = { Freepik: 'Licença Freepik (atribuição ou Premium)', Flaticon: 'Licença Flaticon (atribuição ou Premium)', 'SVG Repo': 'Conforme indicado no SVG Repo', Icons8: 'Licença Icons8 (atribuição ou pago)', Pixabay: 'Pixabay Content License', OpenMoji: 'CC BY-SA 4.0', Openclipart: 'CC0 1.0' };

const mPath = path.join(A, 'manifest.json');
const manifest = fs.existsSync(mPath) ? JSON.parse(fs.readFileSync(mPath, 'utf8')) : { version: 1, assets: [] };
const known = new Set(manifest.assets.map((a) => a.file));
manifest.assets = manifest.assets.filter((a) => fs.existsSync(path.join(ROOT, a.file)));
let added = 0;
for (const cat of CATS) {
  const dir = path.join(A, cat); if (!fs.existsSync(dir)) continue;
  const side = fs.existsSync(path.join(dir, 'sources.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')) : {};
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(png|svg|webp)$/i.test(f)) continue;
    const rel = `assets/${cat}/${f}`; if (known.has(rel)) continue;
    const prefix = f.split(/[-_]/)[0].toLowerCase(); const source = SOURCES[prefix] || 'Outra';
    const extra = side[f] || {};
    manifest.assets.push({ id: `${cat}-${f.replace(/\.[^.]+$/, '')}`, title: f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), category: cat, file: rel,
      source, author: extra.author || '', license: extra.license || LICENSES[source] || 'Verificar', url: extra.url || '', tone: extra.tone || 'natural', ...extra });
    added++;
  }
}
fs.writeFileSync(mPath, JSON.stringify(manifest, null, 1));
const rows = manifest.assets.map((a) => `| ${a.category} | ${a.title} | ${a.author || '—'} | ${a.url ? `[${a.source}](${a.url})` : a.source} | ${a.license} |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), `# Créditos dos assets gráficos\n\nTodos os elementos decorativos vêm de bibliotecas públicas de assets. Nenhum foi desenhado ou gerado por IA.\n\n| Categoria | Elemento | Autor | Fonte | Licença |\n|---|---|---|---|---|\n${rows}\n\nDetecção de rosto e recorte de fundo: [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (Apache 2.0), carregado via CDN.\n`);
console.log(`manifest: ${manifest.assets.length} assets (${added} novos). CREDITS.md atualizado.`);
