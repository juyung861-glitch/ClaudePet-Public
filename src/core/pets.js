'use strict';
// 펫 패키지 탐색: Codex 펫 형식(pet.json + spritesheet) 그대로 읽는다.
const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

const IMAGE_EXT = new Set(['.webp', '.png', '.gif', '.jpg', '.jpeg']);
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** 탐색 순서 = 우선순위 (같은 id 가 여러 곳에 있으면 앞쪽이 이김) */
function petRoots(config = {}) {
  const roots = [
    { dir: paths.claudePets, source: 'claude' },
    ...(config.extraPetDirs || []).map((d) => ({ dir: path.resolve(String(d)), source: 'extra' })),
    { dir: paths.codexPets, source: 'codex' },
    { dir: paths.builtinPets, source: 'built-in' },
  ];
  const seen = new Set();
  return roots.filter((r) => {
    const key = path.resolve(r.dir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** pet.json 을 읽고 검증한다. 문제가 있으면 { error } */
function readPet(folder, source) {
  const manifestPath = path.join(folder, 'pet.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return { error: `pet.json 을 읽을 수 없음: ${e.message}`, folder };
  }
  if (!manifest || typeof manifest !== 'object') return { error: 'pet.json 형식 오류', folder };

  const folderName = path.basename(folder);
  const id = typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : folderName;

  // 경로는 같은 폴더 안의 상대 경로만 허용 (../ 나 절대경로, URL 차단)
  const safeFile = (rel) => {
    if (typeof rel !== 'string' || !rel.trim()) return null;
    rel = rel.trim();
    if (/^[a-z]+:/i.test(rel) || path.isAbsolute(rel)) return null;
    const abs = path.resolve(folder, rel);
    const relCheck = path.relative(folder, abs);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return null;
    if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) return null;
    try {
      return fs.statSync(abs).isFile() ? abs : null;
    } catch {
      return null;
    }
  };

  const base = {
    id,
    folderName,
    displayName: typeof manifest.displayName === 'string' && manifest.displayName.trim() ? manifest.displayName.trim() : id,
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 300) : '',
    folder,
    source,
  };

  // ClaudePet 확장 형식: GIF 등에서 가져온 자유 크기 애니메이션 (claudePet.animations)
  const custom = readCustomAnimations(manifest.claudePet, safeFile);
  if (custom) return { ...base, kind: 'custom', animations: custom };

  // Codex 펫 형식: spritesheetPath (없으면 spritesheet.webp / .png)
  let sheet = null;
  for (const rel of [manifest.spritesheetPath, 'spritesheet.webp', 'spritesheet.png']) {
    sheet = safeFile(rel);
    if (sheet) break;
  }
  if (!sheet) return { error: '스프라이트시트 파일이 없음', folder, id };

  const version = Number(manifest.spriteVersionNumber) === 2 ? 2 : (manifest.spriteVersionNumber == null ? null : 1);
  return {
    ...base,
    kind: 'codex',
    declaredVersion: version,
    spritesheet: sheet,
    mime: MIME[path.extname(sheet).toLowerCase()] || 'image/webp',
  };
}

const CUSTOM_STATES = ['default', 'idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];

function readCustomAnimations(ext, safeFile) {
  if (!ext || typeof ext !== 'object' || !ext.animations || typeof ext.animations !== 'object') return null;
  const out = {};
  for (const name of CUSTOM_STATES) {
    const a = ext.animations[name];
    if (!a || typeof a !== 'object') continue;
    const sheet = safeFile(a.sheet);
    const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
    const frameWidth = int(a.frameWidth, 1, 2048);
    const frameHeight = int(a.frameHeight, 1, 2048);
    const frames = int(a.frames, 1, 256);
    const columns = int(a.columns, 1, 64) || (frames ? Math.min(frames, 8) : null);
    if (!sheet || !frameWidth || !frameHeight || !frames || !columns) continue;
    let durations = Array.isArray(a.durations) ? a.durations.map(Number) : [];
    durations = Array.from({ length: frames }, (_, i) => {
      const d = durations[i];
      return Number.isFinite(d) && d >= 20 && d <= 60000 ? d : 100;
    });
    out[name] = {
      sheet, mime: MIME[path.extname(sheet).toLowerCase()] || 'image/png',
      frameWidth, frameHeight, frames, columns, durations,
    };
  }
  if (!out.default) {
    // default 가 없으면 idle, 그것도 없으면 아무거나 하나를 기본으로
    const first = out.idle || Object.values(out)[0];
    if (!first) return null;
    out.default = first;
  }
  return out;
}

function listPets(config = {}) {
  const pets = [];
  const problems = [];
  const byId = new Map();
  for (const root of petRoots(config)) {
    let entries = [];
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const folder = path.join(root.dir, ent.name);
      if (!fs.existsSync(path.join(folder, 'pet.json'))) continue;
      const pet = readPet(folder, root.source);
      if (pet.error) { problems.push(pet); continue; }
      const key = pet.id.toLowerCase();
      if (byId.has(key)) continue;
      byId.set(key, pet);
      // 폴더 이름으로도 찾을 수 있게
      if (!byId.has(pet.folderName.toLowerCase())) byId.set(pet.folderName.toLowerCase(), pet);
      pets.push(pet);
    }
  }
  return { pets, problems, byId };
}

function findPet(id, config = {}) {
  const { pets, byId } = listPets(config);
  const wanted = String(id || '').toLowerCase();
  return byId.get(wanted) || pets.find((p) => p.displayName.toLowerCase() === wanted) || null;
}

/** 설정된 펫, 없으면 기본 펫, 그것도 없으면 첫 번째 펫 */
function resolvePet(config = {}) {
  const { pets, byId } = listPets(config);
  return byId.get(String(config.petId || '').toLowerCase()) || byId.get('mochi') || pets[0] || null;
}

function fileDataUrl(file, mime) {
  const buf = fs.readFileSync(file);
  if (buf.length > 32 * 1024 * 1024) throw new Error('이미지가 너무 큼 (32MB 초과)');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function loadSpriteDataUrl(pet) {
  return fileDataUrl(pet.spritesheet, pet.mime);
}

/** custom 펫: 애니메이션별 dataUrl 포함 사본 (같은 파일은 한 번만 읽음) */
function loadCustomAnimations(pet) {
  const cache = new Map();
  const out = {};
  for (const [name, a] of Object.entries(pet.animations)) {
    if (!cache.has(a.sheet)) cache.set(a.sheet, fileDataUrl(a.sheet, a.mime));
    const { sheet, mime, ...rest } = a;
    out[name] = { ...rest, dataUrl: cache.get(a.sheet) };
  }
  return out;
}

module.exports = { petRoots, readPet, listPets, findPet, resolvePet, loadSpriteDataUrl, loadCustomAnimations, CUSTOM_STATES };
