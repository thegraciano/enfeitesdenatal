// Biblioteca de assets: pacote incluído (assets/manifest.json) + assets importados pelo usuário (IndexedDB)
const DB_NAME = 'xmas-ornament-assets';
const LS_DISABLED = 'xo-disabled-assets';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('assets', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('assets').objectStore('assets').getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
  });
}
async function idbPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put(rec);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbDel(id) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

export const CATEGORIES = {
  bow: 'Laços', pine: 'Ramos de pinheiro', wreath: 'Guirlandas', star: 'Estrelas', snowflake: 'Flocos de neve',
  gift: 'Presentes', bell: 'Sinos', ball: 'Bolas natalinas', leaves: 'Folhas (azevinho, visco)', flower: 'Flores de Natal',
  ribbon: 'Fitas decorativas', sparkle: 'Brilhos e cristais', pinecone: 'Pinhas', cap: 'Tampa metálica da bola', hat: 'Gorro',
};

export class AssetLibrary {
  constructor() {
    this.assets = [];
    this.disabled = new Set(JSON.parse(localStorage.getItem(LS_DISABLED) || '[]'));
  }
  async init(manifestUrl = 'manifest.json') {
    const m = await (await fetch(manifestUrl)).json();
    for (const a of m.assets) this.assets.push({ ...a, src: a.file, builtin: true });
    try {
      for (const rec of await idbAll()) this.assets.push(this._fromRecord(rec));
    } catch (e) { console.warn('IndexedDB indisponível', e); }
    await Promise.all(this.assets.map((a) => this._load(a)));
  }
  _fromRecord(rec) {
    return { ...rec, src: URL.createObjectURL(rec.blob), builtin: false };
  }
  _load(a) {
    return new Promise((res) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => { a.img = im; a.aspect = (im.naturalHeight || 1) / (im.naturalWidth || 1); res(); };
      im.onerror = () => { a.broken = true; res(); };
      im.src = a.src;
    });
  }
  async importFiles(files, { category, source, license, tone, author }) {
    const added = [];
    for (const f of files) {
      if (!/image\/(png|svg\+xml|webp)/.test(f.type)) continue;
      const rec = {
        id: 'user-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        title: f.name.replace(/\.[^.]+$/, ''), category, source, license, tone: tone || 'natural', author: author || '',
        url: '', blob: f, file: f.name,
      };
      await idbPut(rec);
      const a = this._fromRecord(rec); await this._load(a);
      if (!a.broken) { this.assets.push(a); added.push(a); }
    }
    return added;
  }
  async remove(id) {
    const i = this.assets.findIndex((a) => a.id === id);
    if (i >= 0 && !this.assets[i].builtin) { await idbDel(id); this.assets.splice(i, 1); }
  }
  setEnabled(id, on) {
    on ? this.disabled.delete(id) : this.disabled.add(id);
    localStorage.setItem(LS_DISABLED, JSON.stringify([...this.disabled]));
  }
  isEnabled(id) { return !this.disabled.has(id); }
  byCat(cat) { return this.assets.filter((a) => a.category === cat && a.img && !a.broken && !this.disabled.has(a.id)); }
  get(id) { return this.assets.find((a) => a.id === id); }
}
