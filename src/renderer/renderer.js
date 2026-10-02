'use strict';
/* global window, document, Image, performance */
// 펫 재생 (Codex 스프라이트시트 / GIF 에서 가져온 애니메이션) + 클릭 통과 판정 + 드래그 + 말풍선

const api = window.pet;
const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const bubbleEl = document.getElementById('bubble');
const badgeEl = document.getElementById('badge');
const chipEl = document.getElementById('chip');

const COLUMNS = 8;
const HEADROOM = 18;    // GIF 펫이 점프·흔들림 효과로 위로 움직일 여유 (CSS px)
const state = {
  kind: 'codex',        // 'codex' | 'custom'
  sheet: null,
  atlas: null,          // codex: { rows, version, cellW, cellH }
  custom: null,         // custom: { name: { img, frameWidth, frameHeight, frames, columns, durations } }
  anims: null,          // codex 행/프레임 표 (oneshot 이름 검증에도 사용)
  petW: 96,
  petH: 104,
  base: 'idle',         // 세션 상태에 따른 기본 애니메이션 (반복)
  once: null,           // { anim, loopsLeft } 한 번(또는 n번) 재생 후 base 로 복귀
  queue: [],            // 미리보기 순서
  drag: null,           // { anim, moved, startX, startY }
  look: null,           // v2 시선 셀
  frame: 0,
  frameStart: 0,
  frameLen: 0,
  timer: null,
  hit: false,
  bubbleTimer: null,
};

// ---- 아틀라스 ---------------------------------------------------------------
function detectAtlas(width, height, declared) {
  const v1 = (208 * 9) / (192 * 8);
  const v2 = (208 * 11) / (192 * 8);
  const ratio = height / width;
  const rows = Math.abs(ratio - v2) < Math.abs(ratio - v1) ? 11 : 9;
  const version = rows === 11 ? 2 : 1;
  return { rows, version, cellW: width / COLUMNS, cellH: height / rows, mismatch: declared != null && declared !== version };
}

function currentAnim() {
  if (state.drag && state.drag.moved) return state.drag.anim;
  if (state.once) return state.once.anim;
  return state.base;
}

function animDef(name) {
  return (state.anims && (state.anims[name] || state.anims.idle)) || { row: 0, durations: [1000], frames: 1 };
}

// ---- GIF 펫: 상태별 애니메이션이 없으면 기본 애니메이션 + 효과로 상태 표현 ------------------
const CHIP = { running: '⌨️', 'running-right': '', 'running-left': '', waiting: '❓', review: '✅', failed: '⚠️', waving: '👋', jumping: '' };
const SPEED = { running: 1.5, 'running-right': 1.6, 'running-left': 1.6, waiting: 0.8, failed: 1, review: 1, waving: 1.2, jumping: 1.3 };

function resolveCustom(name) {
  const A = state.custom;
  if (A[name]) return { a: A[name], mirror: false, fallback: false };
  if (name === 'running-left' && A['running-right']) return { a: A['running-right'], mirror: true, fallback: false };
  if ((name === 'running-left' || name === 'running-right') && A.running) return { a: A.running, mirror: name === 'running-left', fallback: false };
  if (name === 'idle') return { a: A.idle || A.default, mirror: false, fallback: false };
  return { a: A.default, mirror: name === 'running-left', fallback: true };
}

function frameCount(name) {
  return state.kind === 'custom' ? resolveCustom(name).a.frames : animDef(name).frames;
}

function frameDuration(name, i) {
  if (state.kind === 'custom') {
    const r = resolveCustom(name);
    const d = r.a.durations[i % r.a.frames] || 100;
    return r.fallback ? d / (SPEED[name] || 1) : d;
  }
  const a = animDef(name);
  return a.durations[Math.min(i, a.durations.length - 1)] || 150;
}

function hasEffect(name) {
  return state.kind === 'custom' && name !== 'idle' && resolveCustom(name).fallback;
}

/** 효과: 위아래 흔들림/점프/떨림 (단위: CSS px) */
function effectOffset(name, now) {
  const progress = () => {
    const n = frameCount(name);
    const within = Math.min(1, (now - state.frameStart) / Math.max(1, state.frameLen));
    return (state.frame + within) / n;
  };
  switch (name) {
    case 'running': return { x: 0, y: -Math.abs(Math.sin(now / 110)) * 3 };
    case 'running-right':
    case 'running-left': return { x: 0, y: -Math.abs(Math.sin(now / 90)) * 4 };
    case 'waiting': return { x: 0, y: Math.sin(now / 380) * 2 };
    case 'review': return { x: 0, y: -Math.abs(Math.sin(now / 220)) * 3 };
    case 'waving': return { x: 0, y: -Math.abs(Math.sin(now / 140)) * 5 };
    case 'jumping': return { x: 0, y: -Math.sin(progress() * Math.PI) * 16 };
    case 'failed': return { x: Math.sin(now / 28) * 2.5, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

function drawCustom() {
  const name = currentAnim();
  const { a, mirror, fallback } = resolveCustom(name);
  const dpr = window.devicePixelRatio || 1;
  const col = state.frame % a.frames;
  const sx = (col % a.columns) * a.frameWidth;
  const sy = Math.floor(col / a.columns) * a.frameHeight;
  // 펫 상자(petW x petH) 안에 비율 유지해서 맞추고 아래쪽 정렬
  const f = Math.min(state.petW / a.frameWidth, state.petH / a.frameHeight);
  const dw = a.frameWidth * f;
  const dh = a.frameHeight * f;
  const off = fallback ? effectOffset(name, performance.now()) : { x: 0, y: 0 };
  const dx = (state.petW - dw) / 2 + off.x;
  const dy = HEADROOM + state.petH - dh + off.y;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = f * dpr < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = fallback && name === 'failed' ? 'grayscale(0.7) brightness(0.95)' : 'none';
  if (mirror) {
    ctx.setTransform(-dpr, 0, 0, dpr, (dx + dw) * dpr, 0);
    ctx.drawImage(a.img, sx, sy, a.frameWidth, a.frameHeight, 0, dy, dw, dh);
  } else {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(a.img, sx, sy, a.frameWidth, a.frameHeight, dx, dy, dw, dh);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';

  const chip = fallback ? CHIP[name] || '' : '';
  if (chipEl.textContent !== chip) chipEl.textContent = chip;
  chipEl.hidden = !chip;
}

function drawCodex() {
  if (!state.sheet || !state.atlas) return;
  const name = currentAnim();
  let row;
  let col;
  if (state.look && state.atlas.version === 2 && name === 'idle' && !state.once && !state.drag) {
    row = state.look.row;
    col = state.look.col;
  } else {
    const a = animDef(name);
    row = a.row;
    col = Math.min(state.frame, a.frames - 1);
  }
  const { cellW, cellH } = state.atlas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 축소할 땐 부드럽게, 확대할 땐 픽셀 그대로
  ctx.imageSmoothingEnabled = canvas.width < cellW;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.sheet, col * cellW, row * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
}

function draw() {
  if (state.kind === 'custom') {
    if (state.custom) drawCustom();
  } else {
    drawCodex();
  }
}

function schedule() {
  clearTimeout(state.timer);
  const name = currentAnim();
  state.frameStart = performance.now();
  state.frameLen = frameDuration(name, state.frame);
  draw();
  if (hasEffect(name)) state.timer = setTimeout(effectTick, 33);
  else state.timer = setTimeout(step, state.frameLen);
}

/** 효과가 있는 동안엔 프레임 사이에도 30fps 로 다시 그림 */
function effectTick() {
  const elapsed = performance.now() - state.frameStart;
  if (elapsed >= state.frameLen) {
    step();
    return;
  }
  draw();
  state.timer = setTimeout(effectTick, Math.min(33, state.frameLen - elapsed));
}

function step() {
  const n = frameCount(currentAnim());
  state.frame += 1;
  if (state.frame >= n) {
    state.frame = 0;
    if (state.once && !(state.drag && state.drag.moved)) {
      state.once.loopsLeft -= 1;
      if (state.once.loopsLeft <= 0) {
        state.once = null;
        if (state.queue.length) state.once = { anim: state.queue.shift(), loopsLeft: 2 };
      }
    }
  }
  schedule();
}

function restart() {
  state.frame = 0;
  schedule();
}

function setBase(anim) {
  if (!anim || anim === state.base) return;
  state.base = anim;
  if (!state.once && !(state.drag && state.drag.moved)) restart();
}

function playOnce(anim, loops = 1) {
  if (!state.anims || !state.anims[anim]) return;
  state.once = { anim, loopsLeft: Math.max(1, loops) };
  restart();
}

// ---- 크기 -----------------------------------------------------------------
function applySize({ petW, petH }) {
  state.petW = petW;
  state.petH = petH;
  const dpr = window.devicePixelRatio || 1;
  const extra = state.kind === 'custom' ? HEADROOM : 0;
  canvas.style.width = `${petW}px`;
  canvas.style.height = `${petH + extra}px`;
  canvas.width = Math.round(petW * dpr);
  canvas.height = Math.round((petH + extra) * dpr);
  bubbleEl.style.bottom = `${petH + 6}px`;
  chipEl.style.bottom = `${Math.round(petH * 0.78)}px`;
  draw();
}

// ---- 말풍선 / 배지 -----------------------------------------------------------
function showBubble({ text, ms = 3000 }) {
  if (!text) return;
  bubbleEl.textContent = text;
  bubbleEl.classList.add('show');
  clearTimeout(state.bubbleTimer);
  state.bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), ms);
}

function setBadge(n) {
  if (n && n > 1) {
    badgeEl.textContent = String(n);
    badgeEl.hidden = false;
  } else {
    badgeEl.hidden = true;
  }
}

// ---- 클릭 통과 판정 (투명한 곳은 아래 창으로 클릭이 넘어감) --------------------------
function isHit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (!badgeEl.hidden) {
    const b = badgeEl.getBoundingClientRect();
    if (clientX >= b.left && clientX <= b.right && clientY >= b.top && clientY <= b.bottom) return true;
  }
  if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) return false;
  const sx = Math.floor(((clientX - r.left) / r.width) * canvas.width);
  const sy = Math.floor(((clientY - r.top) / r.height) * canvas.height);
  try {
    // 주변 3x3 중 하나라도 불투명하면 맞은 것으로 (가장자리 클릭 편의)
    const x0 = Math.max(0, sx - 1);
    const y0 = Math.max(0, sy - 1);
    const data = ctx.getImageData(x0, y0, 3, 3).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 24) return true;
  } catch {
    return true;
  }
  return false;
}

function setHit(hit) {
  if (hit === state.hit) return;
  state.hit = hit;
  api.setIgnore(!hit);
}

document.addEventListener('mousemove', (e) => {
  if (state.drag) return;
  setHit(isHit(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => { if (!state.drag) setHit(false); });

// ---- 드래그 / 클릭 / 메뉴 -------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  state.drag = { anim: 'running-right', moved: false, startX: e.screenX, startY: e.screenY, lastX: e.screenX };
  api.dragStart();
});

canvas.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.screenX - d.startX, e.screenY - d.startY) > 4) {
    d.moved = true;
    canvas.classList.add('dragging');
    restart();
  }
  if (d.moved) {
    const dx = e.screenX - d.lastX;
    if (Math.abs(dx) >= 2) {
      const next = dx > 0 ? 'running-right' : 'running-left';
      if (next !== d.anim) {
        d.anim = next;
        restart();
      }
    }
    d.lastX = e.screenX;
    api.dragMove();
  }
});

function endDrag(e) {
  const d = state.drag;
  if (!d) return;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
  state.drag = null;
  canvas.classList.remove('dragging');
  api.dragEnd();
  if (d.moved) {
    playOnce('jumping');
  } else if (e.type === 'pointerup') {
    api.click();
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => api.dblclick());
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isHit(e.clientX, e.clientY)) api.menu();
});

// ---- 메인 프로세스에서 오는 메시지 ------------------------------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

let loadSeq = 0;
api.onLoad(async (p) => {
  const seq = ++loadSeq;
  clearTimeout(state.timer);
  state.anims = p.anims;
  try {
    if (p.kind === 'custom') {
      const cache = new Map();
      const custom = {};
      for (const [name, a] of Object.entries(p.animations)) {
        if (!cache.has(a.dataUrl)) cache.set(a.dataUrl, loadImage(a.dataUrl));
        custom[name] = { ...a, img: await cache.get(a.dataUrl) };
      }
      if (seq !== loadSeq) return;
      state.kind = 'custom';
      state.custom = custom;
      state.sheet = null;
      state.atlas = null;
      api.atlas({ version: 1, mismatch: false });
    } else {
      const img = await loadImage(p.dataUrl);
      if (seq !== loadSeq) return;
      state.kind = 'codex';
      state.custom = null;
      state.sheet = img;
      state.atlas = detectAtlas(img.naturalWidth, img.naturalHeight, p.declaredVersion);
      chipEl.hidden = true;
      api.atlas({ version: state.atlas.version, mismatch: state.atlas.mismatch });
    }
  } catch {
    showBubble({ text: '펫 이미지를 읽을 수 없어요', ms: 6000 });
    return;
  }
  applySize(p);
  state.frame = 0;
  schedule();
});
api.onDisplay((d) => {
  setBase(d.anim);
  setBadge(d.badge);
});
api.onOneshot((o) => playOnce(o.anim, o.loops));
api.onSequence((names) => {
  if (!Array.isArray(names) || !names.length) return;
  state.queue = names.slice(1);
  playOnce(names[0], 2);
});
api.onBubble(showBubble);
api.onScale(applySize);
api.onLook((cell) => {
  state.look = cell;
  if (currentAnim() === 'idle' && !state.once && !state.drag) draw();
});

api.ready();
