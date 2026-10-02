'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-test-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, '.claude');
process.env.CODEX_HOME = path.join(tmp, '.codex');
process.env.CLAUDE_PET_HOME = path.join(tmp, 'pet-home');

const { detectAtlas, lookCell, resolveAnimations, loopMs } = require('../src/core/atlas');
const { listPets, findPet, resolvePet, readPet } = require('../src/core/pets');
const { loadConfig, updateConfig } = require('../src/core/config');

function makePet(root, folder, manifest, file = 'spritesheet.webp') {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(manifest));
  if (file) fs.writeFileSync(path.join(dir, file), 'x');
  return dir;
}

test('아틀라스 판정: v1 / v2 / 버전 불일치', () => {
  assert.deepEqual(detectAtlas(1536, 1872, 1), { rows: 9, version: 1, cellW: 192, cellH: 208, mismatch: false });
  const v2 = detectAtlas(1536, 2288, 2);
  assert.equal(v2.rows, 11); assert.equal(v2.cellH, 208);
  assert.equal(detectAtlas(1536, 2288, 1).mismatch, true);
  // 절반 크기 아틀라스도 비율로 판정
  assert.equal(detectAtlas(768, 936, null).cellW, 96);
});

test('시선 셀: 위=0, 오른쪽=4, 아래=8(10행 0열), 데드존, 반경 밖', () => {
  assert.deepEqual(lookCell(0, -100), { row: 9, col: 0 });
  assert.deepEqual(lookCell(100, 0), { row: 9, col: 4 });
  assert.deepEqual(lookCell(0, 100), { row: 10, col: 0 });
  assert.deepEqual(lookCell(-100, 0), { row: 10, col: 4 });
  assert.deepEqual(lookCell(5, 5), { row: 0, col: 6 });
  assert.equal(lookCell(2000, 0), null);
});

test('프레임 시간 덮어쓰기는 길이가 맞을 때만 적용', () => {
  const a = resolveAnimations({ waving: [100, 100, 100, 100], idle: [1, 2] });
  assert.deepEqual(a.waving.durations, [100, 100, 100, 100]);
  assert.equal(a.idle.durations.length, 6);
  assert.equal(loopMs(a, 'waving'), 400);
});

test('펫 탐색: Claude 폴더 > Codex 폴더 > 기본, 안전하지 않은 경로 차단', () => {
  makePet(path.join(tmp, '.codex', 'pets'), 'sample-pet', { id: 'sample-pet', displayName: 'Sample Pet', spritesheetPath: 'spritesheet.webp' });
  makePet(path.join(tmp, '.codex', 'pets'), 'dup', { id: 'mochi', displayName: 'Codex Mochi' });
  makePet(path.join(tmp, '.claude', 'pets'), 'evil', { id: 'evil', spritesheetPath: '../../secret.webp' }, null);
  makePet(path.join(tmp, '.claude', 'pets'), 'v2pet', { id: 'v2pet', spriteVersionNumber: 2 }, 'spritesheet.png');

  const { pets, problems } = listPets(loadConfig());
  const ids = pets.map((p) => p.id);
  assert.ok(ids.includes('sample-pet'));
  assert.ok(ids.includes('mochi'), '기본 펫 포함');
  assert.ok(ids.includes('v2pet'));
  assert.ok(!ids.includes('evil'), '폴더 밖 경로는 거부');
  assert.ok(problems.some((p) => p.folder.endsWith('evil')));
  // 같은 id 면 Codex 쪽이 기본 펫보다 우선
  assert.equal(findPet('mochi').displayName, 'Codex Mochi');
  assert.equal(findPet('sample-pet').source, 'codex');
  assert.equal(findPet('v2pet').declaredVersion, 2);
  assert.equal(findPet('v2pet').mime, 'image/png');
});

test('설정 저장/불러오기 + 없는 펫이면 기본 펫으로 대체', () => {
  updateConfig({ petId: 'nope', scale: 9 });
  const c = loadConfig();
  assert.equal(c.scale, 2, '배율은 0.2~2 로 제한');
  assert.ok(resolvePet(c), '없는 id 여도 펫을 찾음');
  updateConfig({ petId: 'sample-pet' });
  assert.equal(resolvePet(loadConfig()).id, 'sample-pet');
});

test('기본 펫 Mochi 패키지가 규격에 맞음', () => {
  const pet = readPet(path.join(__dirname, '..', 'pets', 'mochi'), 'built-in');
  assert.equal(pet.id, 'mochi');
  assert.ok(pet.spritesheet.endsWith('spritesheet.webp'));
  const buf = fs.readFileSync(pet.spritesheet);
  // WEBP 헤더 + VP8L(무손실) 크기 확인
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  assert.equal(buf.toString('ascii', 12, 16), 'VP8L');
  const b = buf.subarray(21, 25);
  const w = 1 + (((b[1] & 0x3f) << 8) | b[0]);
  const h = 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6));
  assert.deepEqual([w, h], [1536, 1872]);
});

test('GIF 펫(claudePet 확장) manifest: 검증·기본 애니메이션 대체·안전한 경로', () => {
  const root = path.join(tmp, '.claude', 'pets');
  const dir = makePet(root, 'gifpet', {
    id: 'gifpet',
    displayName: 'GIF Pet',
    claudePet: {
      format: 1,
      animations: {
        idle: { sheet: 'idle.png', frameWidth: 100, frameHeight: 120, frames: 6, columns: 6, durations: [180, 180, 'x', 5, 180] },
        running: { sheet: '../escape.png', frameWidth: 10, frameHeight: 10, frames: 1 },
        waiting: { sheet: 'waiting.png', frameWidth: 0, frameHeight: 10, frames: 1 },
      },
    },
  }, 'idle.png');
  fs.writeFileSync(path.join(dir, 'waiting.png'), 'x');
  const pet = findPet('gifpet');
  assert.equal(pet.kind, 'custom');
  assert.ok(pet.animations.default, 'default 가 없으면 idle 로 대체');
  assert.equal(pet.animations.idle.durations.length, 6);
  assert.deepEqual(pet.animations.idle.durations, [180, 180, 100, 100, 180, 100]);
  assert.equal(pet.animations.running, undefined, '폴더 밖 경로 거부');
  assert.equal(pet.animations.waiting, undefined, '크기 0 은 거부');
  assert.equal(findPet('sample-pet').kind, 'codex');
});
