'use strict';
/* global window, ImageDecoder, OffscreenCanvas, createImageBitmap, Blob */
// 숨은 창에서 실행: 움직이는 이미지(GIF/APNG/WebP) → 프레임 분해 → 배경 제거 → 여백 자르기 → 프레임 시트 PNG

const MAX_FRAMES = 64;
const MAX_SIDE = 512;
const COLUMNS = 8;

async function decodeFrames(bytes, mime) {
  const frames = [];
  if (typeof ImageDecoder === 'function' && (await ImageDecoder.isTypeSupported(mime))) {
    const dec = new ImageDecoder({ data: bytes, type: mime });
    await dec.tracks.ready;
    const count = Math.max(1, dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1);
    for (let i = 0; i < count; i += 1) {
      const { image } = await dec.decode({ frameIndex: i });
      const w = image.displayWidth;
      const h = image.displayHeight;
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      let ms = image.duration ? image.duration / 1000 : 100; // 마이크로초 → ms
      if (!(ms >= 20)) ms = 100; // 브라우저와 같게: 너무 짧은 프레임은 100ms
      frames.push({ data: ctx.getImageData(0, 0, w, h), ms: Math.round(ms) });
      image.close();
    }
    dec.close();
  } else {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, bmp.width, bmp.height), ms: 1000 });
  }
  return frames;
}

/** 프레임이 너무 많으면 고르게 골라내고 그 사이 시간을 합친다 */
function limitFrames(frames) {
  if (frames.length <= MAX_FRAMES) return frames;
  const out = [];
  const step = frames.length / MAX_FRAMES;
  for (let k = 0; k < MAX_FRAMES; k += 1) {
    const from = Math.floor(k * step);
    const to = Math.floor((k + 1) * step);
    let ms = 0;
    for (let i = from; i < to; i += 1) ms += frames[i].ms;
    out.push({ data: frames[from].data, ms });
  }
  return out;
}

const close = (d, i, c, tol) =>
  Math.abs(d[i] - c[0]) <= tol && Math.abs(d[i + 1] - c[1]) <= tol && Math.abs(d[i + 2] - c[2]) <= tol;

/** 테두리가 한 가지 색으로 꽉 차 있으면 그 색을 배경으로 본다 */
function detectBackground(img) {
  const { width: w, height: h, data } = img;
  const counts = new Map();
  let total = 0;
  let opaque = 0;
  const visit = (x, y) => {
    const i = (y * w + x) * 4;
    total += 1;
    if (data[i + 3] < 200) return;
    opaque += 1;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const e = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    counts.set(key, e);
  };
  for (let x = 0; x < w; x += 1) { visit(x, 0); visit(x, h - 1); }
  for (let y = 1; y < h - 1; y += 1) { visit(0, y); visit(w - 1, y); }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best) return { opaqueRatio: 0, matchRatio: 0, color: null };
  return {
    opaqueRatio: opaque / total,
    matchRatio: best.n / Math.max(1, opaque),
    color: [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round),
  };
}

/** 테두리에서 이어진 배경색 영역만 투명하게 (캐릭터 안의 같은 색은 남김) */
function floodRemove(img, color, tol = 32) {
  const { width: w, height: h, data } = img;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (data[i + 3] === 0 || close(data, i, color, tol)) stack.push(p);
  };
  for (let x = 0; x < w; x += 1) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 1) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
}

function contentBox(frames) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (const { data: img } of frames) {
    const { width: w, height: h, data } = img;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) return null;
  const { width: w, height: h } = frames[0].data;
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function run({ bytes, mime, removeBg = 'auto' }) {
  let frames;
  try {
    frames = limitFrames(await decodeFrames(bytes, mime));
  } catch (e) {
    throw new Error(`이미지를 읽을 수 없어요. 손상됐거나 지원하지 않는 형식일 수 있어요 (${(e && e.message) || e})`);
  }
  if (!frames.length) throw new Error('이미지에 프레임이 없어요');
  const srcW = frames[0].data.width;
  const srcH = frames[0].data.height;

  let removed = false;
  if (removeBg !== 'off') {
    const bg = detectBackground(frames[0].data);
    const should = removeBg === 'on' ? !!bg.color : bg.opaqueRatio > 0.9 && bg.matchRatio > 0.75;
    if (should) {
      for (const f of frames) floodRemove(f.data, bg.color);
      removed = true;
    }
  }

  const box = contentBox(frames);
  if (!box) throw new Error('이미지에 보이는 부분이 없어요 (전부 투명)');
  const scale = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
  const fw = Math.max(1, Math.round(box.w * scale));
  const fh = Math.max(1, Math.round(box.h * scale));
  const columns = Math.min(frames.length, COLUMNS);
  const rows = Math.ceil(frames.length / columns);

  const sheet = new OffscreenCanvas(columns * fw, rows * fh);
  const sctx = sheet.getContext('2d');
  sctx.imageSmoothingEnabled = scale < 1;
  sctx.imageSmoothingQuality = 'high';
  const tmp = new OffscreenCanvas(srcW, srcH);
  const tctx = tmp.getContext('2d');
  frames.forEach((f, i) => {
    tctx.clearRect(0, 0, srcW, srcH);
    tctx.putImageData(f.data, 0, 0);
    sctx.drawImage(tmp, box.x, box.y, box.w, box.h, (i % columns) * fw, Math.floor(i / columns) * fh, fw, fh);
  });
  const blob = await sheet.convertToBlob({ type: 'image/png' });
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    frames: frames.length,
    durations: frames.map((f) => f.ms),
    frameWidth: fw,
    frameHeight: fh,
    columns,
    removedBackground: removed,
    source: { width: srcW, height: srcH },
  };
}

window.importer.job()
  .then((job) => run(job))
  .then((r) => window.importer.done({ ok: true, ...r }))
  .catch((e) => window.importer.done({ ok: false, error: String((e && e.message) || e) }));
