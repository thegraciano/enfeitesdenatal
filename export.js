// PNG com DPI embutido (pHYs), ZIP sem dependências e folha A4 para impressão.
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf, crc = 0xffffffff) { for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 255] ^ (crc >>> 8); return crc; }

export async function canvasToPngWithDpi(canvas, dpi) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21); const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, (crc32(chunk.subarray(4, 17)) ^ 0xffffffff) >>> 0);
  // remove pHYs existente e insere logo após o IHDR (8 + 25 bytes)
  const parts = [src.subarray(0, 33), chunk]; let p = 33;
  while (p < src.length) {
    const len = new DataView(src.buffer, src.byteOffset + p).getUint32(0);
    const type = String.fromCharCode(...src.subarray(p + 4, p + 8));
    if (type !== 'pHYs') parts.push(src.subarray(p, p + 12 + len));
    p += 12 + len;
  }
  return new Blob(parts, { type: 'image/png' });
}

export async function makeZip(files) { // files: [{name, blob}]
  const enc = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()); const name = enc.encode(f.name);
    const crc = (crc32(data) ^ 0xffffffff) >>> 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// Folha A4 (21 × 29,7 cm) com bolinhas de 5 × 5 cm, fundo transparente
export function a4Sheets(canvases, dpi) {
  const px = (cm) => Math.round((cm / 2.54) * dpi);
  const W = px(21), H = px(29.7), cell = px(5), cols = 3, rows = 5;
  const gx = (W - cols * cell) / (cols + 1), gy = (H - rows * cell) / (rows + 1);
  const sheets = [];
  for (let i = 0; i < canvases.length; i += cols * rows) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    canvases.slice(i, i + cols * rows).forEach((cv, j) => {
      const col = j % cols, row = Math.floor(j / cols);
      x.drawImage(cv, Math.round(gx + col * (cell + gx)), Math.round(gy + row * (cell + gy)), cell, cell);
    });
    sheets.push(c);
  }
  return sheets;
}

// PDF A4 sem dependências: cada folha vira uma página com a imagem em JPEG (fundo branco)
export async function a4Pdf(sheets) {
  const enc = new TextEncoder(); const parts = []; const offsets = []; let len = 0;
  const push = (d) => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const imgs = [];
  for (const s of sheets) {
    const c = document.createElement('canvas'); c.width = s.width; c.height = s.height; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(s, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    imgs.push({ w: c.width, h: c.height, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const W = 595.28, H = 841.89, n = imgs.length; // pontos (A4)
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = imgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  imgs.forEach((im, i) => {
    const p = 3 + i * 3, ct = p + 1, io = p + 2;
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${ct} 0 R >>`));
    const cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(ct, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(io, () => { push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`); push(im.data); push('\nendstream'); });
  });
  const total = 3 + n * 3; const xref = len;
  let t = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) t += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(t + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}
