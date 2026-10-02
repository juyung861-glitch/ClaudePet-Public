'use strict';
// Codex 펫 스프라이트시트 규격 (v1: 8x9, v2: 8x11, 셀 192x208)
// 행 순서·프레임 수·프레임 시간은 Codex 앱/커뮤니티 패키지와 동일하게 맞춘다.

const COLUMNS = 8;
const CELL_W = 192;
const CELL_H = 208;

const ANIMATIONS = {
  idle:            { row: 0, durations: [1680, 660, 660, 840, 840, 1920] },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left':  { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving:          { row: 3, durations: [140, 140, 140, 280] },
  jumping:         { row: 4, durations: [140, 140, 140, 140, 280] },
  failed:          { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting:         { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running:         { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review:          { row: 8, durations: [150, 150, 150, 150, 150, 280] },
};

const ANIMATION_NAMES = Object.keys(ANIMATIONS);

// v2: 0행 6열 = 정면(중립) 시선, 9~10행 = 위쪽(0)부터 시계방향 16방향 시선
const LOOK_NEUTRAL = { row: 0, col: 6 };
const LOOK_ROWS = [9, 10];

/** 사용자 설정의 프레임 시간 덮어쓰기를 적용한 애니메이션 표 */
function resolveAnimations(overrides) {
  const out = {};
  for (const [name, def] of Object.entries(ANIMATIONS)) {
    let durations = def.durations.slice();
    const o = overrides && overrides[name];
    if (Array.isArray(o) && o.length === durations.length &&
        o.every((n) => Number.isFinite(n) && n >= 16 && n <= 60000)) {
      durations = o.map(Number);
    }
    out[name] = { row: def.row, durations, frames: durations.length };
  }
  return out;
}

/** 한 바퀴 재생 시간(ms) */
function loopMs(anims, name) {
  const a = anims[name];
  return a ? a.durations.reduce((s, n) => s + n, 0) : 0;
}

/**
 * 이미지 크기로 아틀라스 행 수를 판정한다. (manifest 버전보다 실제 이미지가 우선)
 * 반환: { rows, version, cellW, cellH }
 */
function detectAtlas(width, height, declaredVersion) {
  const ratio = height / width;
  const v1 = (CELL_H * 9) / (CELL_W * COLUMNS);   // 1.21875
  const v2 = (CELL_H * 11) / (CELL_W * COLUMNS);  // 1.4896
  let rows;
  if (Math.abs(ratio - v2) < Math.abs(ratio - v1)) rows = 11;
  else rows = 9;
  if (!width || !height) rows = declaredVersion === 2 ? 11 : 9;
  return {
    rows,
    version: rows === 11 ? 2 : 1,
    cellW: width / COLUMNS,
    cellH: height / rows,
    mismatch: declaredVersion != null && declaredVersion !== (rows === 11 ? 2 : 1),
  };
}

/** 커서 방향 -> v2 시선 셀. dx,dy 는 펫 중심 기준 화면 좌표 차이 */
function lookCell(dx, dy, { deadzone = 48, radius = 600 } = {}) {
  const dist = Math.hypot(dx, dy);
  if (dist > radius) return null;
  if (dist < deadzone) return { ...LOOK_NEUTRAL };
  // 위쪽이 0도, 시계방향
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const idx = Math.round(deg / 22.5) % 16;
  return { row: LOOK_ROWS[Math.floor(idx / 8)], col: idx % 8 };
}

module.exports = {
  COLUMNS, CELL_W, CELL_H, ANIMATIONS, ANIMATION_NAMES,
  LOOK_NEUTRAL, LOOK_ROWS, resolveAnimations, loopMs, detectAtlas, lookCell,
};
