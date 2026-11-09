// Detecção de rosto e segmentação de pessoa (MediaPipe Tasks Vision, Apache-2.0).
// Usado apenas para ENQUADRAR o rosto, protegê-lo das decorações e recortar o fundo.
// A fotografia original não é alterada nem regenerada.
const VER = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

let ready = null;
export function loadVision() {
  if (ready) return ready;
  ready = (async () => {
    const v = await import(/* @vite-ignore */ `${BASE}/vision_bundle.mjs`);
    const fs = await v.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const face = await v.FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 });
    const seg = await v.ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
    return { face, seg };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

export function detectFace(vis, canvas) {
  const r = vis.face.detect(canvas);
  if (!r.detections || !r.detections.length) return null;
  const d = r.detections.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0];
  const bb = d.boundingBox; const W = canvas.width, H = canvas.height;
  const kp = d.keypoints || [];
  const eyes = kp.length >= 2 ? [[kp[0].x * W, kp[0].y * H], [kp[1].x * W, kp[1].y * H]] : null;
  return { box: { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height }, eyes, score: d.categories?.[0]?.score };
}

// Recorta a pessoa: máscara de confiança do fundo → canal alfa com borda suave
export function cutoutPerson(vis, canvas) {
  const res = vis.seg.segment(canvas);
  const m = res.confidenceMasks[0];
  const mw = m.width, mh = m.height; const bg = m.getAsFloat32Array();
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
  const mx = mc.getContext('2d'); const id = mx.createImageData(mw, mh);
  for (let i = 0; i < bg.length; i++) {
    let a = 1 - bg[i];
    a = Math.min(1, Math.max(0, (a - 0.2) / 0.6)); a = a * a * (3 - 2 * a);
    id.data[i * 4 + 3] = Math.round(a * 255);
  }
  mx.putImageData(id, 0, 0);
  res.close && res.close();
  const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
  const ox = out.getContext('2d'); ox.imageSmoothingQuality = 'high';
  ox.drawImage(canvas, 0, 0);
  ox.globalCompositeOperation = 'destination-in';
  ox.filter = `blur(${Math.max(0.6, canvas.width / 1400)}px)`;
  ox.drawImage(mc, 0, 0, out.width, out.height);
  return out;
}
