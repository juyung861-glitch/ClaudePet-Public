'use strict';
// codex-pets.net(오픈소스 codex-pet-share) 갤러리에서 펫 받기 + Codex 펫 zip 설치
// 의존성 없이 동작: fetch 함수는 호출하는 쪽이 넘겨줌 (Electron 메인은 시스템 프록시를 따르는 net.fetch 사용)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_GALLERY = 'https://codex-pets.net';
const ALLOWED_HOSTS = new Set(['codex-pets.net', 'www.codex-pets.net']);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ZIP = 40 * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;

/**
 * 사용자가 붙여넣은 무엇이든 펫 id 로: id, 펫 페이지 주소, 다운로드 주소,
 * 사이트에서 복사한 설치 명령(npx … add <id> / curl …/api/pets/<id>/download …)
 */
function parsePetRef(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    let u;
    try { u = new URL(urlMatch[0]); } catch { return null; }
    if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return { error: 'host', host: u.hostname };
    // 사이트가 해시 주소(https://codex-pets.net/#/pets/<id>)를 써서 해시 쪽도 확인
    const routes = [u.pathname, u.hash.startsWith('#/') ? u.hash.slice(1).split('?')[0] : ''];
    for (const route of routes) {
      const m = route.match(/^\/(?:api\/)?pets\/([a-z0-9-]+)(?:\/|$)/i);
      if (m && ID_PATTERN.test(m[1].toLowerCase())) return { id: m[1].toLowerCase(), gallery: `https://${u.hostname}` };
    }
    return null;
  }
  const npx = text.match(/\badd\s+([a-z0-9-]+)\s*$/i);
  const word = (npx ? npx[1] : text).toLowerCase();
  return ID_PATTERN.test(word) && word.length <= 120 ? { id: word, gallery: DEFAULT_GALLERY } : null;
}

// ---- zip (stored / deflate) 읽기 --------------------------------------------------
function readZip(buf) {
  const files = new Map();
  const minEocd = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 파일이 아니에요');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > 50) throw new Error('zip 안에 파일이 너무 많아요');
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 목록이 손상됐어요');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // 폴더
    if (flags & 0x1) throw new Error('암호가 걸린 zip 은 지원하지 않아요');
    if (size > MAX_FILE) throw new Error(`${name} 이(가) 너무 커요`);
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip 항목이 손상됐어요');
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_FILE });
    else throw new Error(`지원하지 않는 압축 방식(${method})`);
    files.set(name.replace(/\\/g, '/'), data);
  }
  return files;
}

function isImage(buf) {
  return (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    || (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG');
}

/**
 * zip 안의 Codex 펫 패키지를 찾는다. 하위 폴더 하나에 들어 있어도 OK.
 * 반환: { manifest, sheetName, sheet }
 */
function packageFromFiles(files) {
  const names = [...files.keys()];
  const manifestName = names
    .filter((n) => n === 'pet.json' || n.endsWith('/pet.json'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!manifestName) throw new Error('pet.json 이 없어요 (Codex 펫 패키지가 아니에요)');
  let manifest;
  try {
    manifest = JSON.parse(files.get(manifestName).toString('utf8').replace(/^﻿/, ''));
  } catch {
    throw new Error('pet.json 을 읽을 수 없어요');
  }
  if (!manifest || typeof manifest !== 'object') throw new Error('pet.json 형식 오류');
  const dir = manifestName.includes('/') ? manifestName.slice(0, manifestName.lastIndexOf('/') + 1) : '';
  const wanted = typeof manifest.spritesheetPath === 'string' ? path.posix.normalize(manifest.spritesheetPath).replace(/^\.\//, '') : '';
  const candidates = [wanted, 'spritesheet.webp', 'spritesheet.png'].filter((n) => n && !n.startsWith('..') && !n.startsWith('/'));
  for (const rel of candidates) {
    const data = files.get(dir + rel);
    if (data && isImage(data)) {
      const ext = data[0] === 0x89 ? '.png' : '.webp';
      return { manifest, sheetName: `spritesheet${ext}`, sheet: data };
    }
  }
  throw new Error('스프라이트시트 이미지가 없어요');
}

/** 패키지를 ~/.claude/pets/<folderId>/ 에 쓴다. 기존 폴더는 덮어씀 */
function writePackage(petsDir, folderId, pkg, sourceInfo) {
  if (!ID_PATTERN.test(folderId)) throw new Error('펫 id 형식이 올바르지 않아요');
  const folder = path.join(petsDir, folderId);
  fs.mkdirSync(folder, { recursive: true });
  for (const old of ['spritesheet.webp', 'spritesheet.png']) {
    if (old !== pkg.sheetName) fs.rmSync(path.join(folder, old), { force: true });
  }
  fs.writeFileSync(path.join(folder, pkg.sheetName), pkg.sheet);
  const manifest = {
    ...pkg.manifest,
    id: typeof pkg.manifest.id === 'string' && pkg.manifest.id.trim() ? pkg.manifest.id.trim() : folderId,
    spritesheetPath: pkg.sheetName,
  };
  fs.writeFileSync(path.join(folder, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (sourceInfo) fs.writeFileSync(path.join(folder, '.source.json'), JSON.stringify({ ...sourceInfo, installedAt: new Date().toISOString() }, null, 2));
  return { folder, id: manifest.id, folderId, displayName: manifest.displayName || manifest.id };
}

async function fetchBytes(fetchImpl, url, max) {
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': 'claude-pet', accept: '*/*' } });
  } catch (e) {
    throw new Error(`codex-pets.net 에 연결하지 못했어요 (${(e && e.message) || e}). 인터넷을 확인하거나, 사이트에서 Download 로 받은 zip 을 /pet install <zip 경로> 로 설치하세요`);
  }
  if (res.url) {
    const final = new URL(res.url);
    if (final.protocol !== 'https:' || !ALLOWED_HOSTS.has(final.hostname.toLowerCase())) throw new Error('허용되지 않은 주소로 이동했어요');
  }
  if (res.status === 404) throw Object.assign(new Error('갤러리에 그런 펫이 없어요'), { code: 'not-found' });
  if (!res.ok) throw new Error(`갤러리 응답 오류 (HTTP ${res.status})`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('파일이 너무 커요');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('파일이 너무 커요');
  return buf;
}

/** 갤러리에서 받아 설치. ref 는 parsePetRef 가 이해하는 모든 형태 */
async function installFromGallery(ref, { fetchImpl, petsDir }) {
  const parsed = typeof ref === 'string' ? parsePetRef(ref) : ref;
  if (!parsed) throw new Error('펫 링크나 id 를 알아볼 수 없어요. 예: https://codex-pets.net/#/pets/펫이름');
  if (parsed.error === 'host') throw new Error(`${parsed.host} 는 지원하지 않는 사이트예요 (codex-pets.net 만 지원)`);
  const base = parsed.gallery || DEFAULT_GALLERY;
  const zip = await fetchBytes(fetchImpl, `${base}/api/pets/${encodeURIComponent(parsed.id)}/download`, MAX_ZIP);
  const pkg = packageFromFiles(readZip(zip));
  return writePackage(petsDir, parsed.id, pkg, { gallery: base, id: parsed.id, page: `${base}/pets/${parsed.id}` });
}

/** 내려받아 둔 zip 파일(또는 pet.json 이 든 폴더) 설치 */
function installFromLocal(target, { petsDir }) {
  const abs = path.resolve(target);
  const st = fs.statSync(abs);
  let pkg;
  if (st.isDirectory()) {
    const files = new Map();
    for (const name of ['pet.json', 'spritesheet.webp', 'spritesheet.png']) {
      const f = path.join(abs, name);
      if (fs.existsSync(f)) files.set(name, fs.readFileSync(f));
    }
    pkg = packageFromFiles(files);
  } else {
    if (st.size > MAX_ZIP) throw new Error('파일이 너무 커요');
    pkg = packageFromFiles(readZip(fs.readFileSync(abs)));
  }
  const base = String(pkg.manifest.id || path.basename(abs).replace(/\.codex-pet\.zip$|\.zip$/i, ''))
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'pet';
  return writePackage(petsDir, base, pkg, { file: path.basename(abs) });
}

/** 갤러리 검색 */
async function searchGallery(query, { fetchImpl, page = 1 }) {
  const url = `${DEFAULT_GALLERY}/api/pets?q=${encodeURIComponent(query || '')}&page=${page}`;
  const buf = await fetchBytes(fetchImpl, url, 5 * 1024 * 1024);
  const body = JSON.parse(buf.toString('utf8'));
  const pets = Array.isArray(body.pets) ? body.pets : [];
  return {
    total: Number(body.total) || pets.length,
    pets: pets.slice(0, 30).map((p) => ({
      id: String(p.id || ''),
      displayName: String(p.displayName || p.id || ''),
      kind: p.kind ? String(p.kind) : '',
      version: Number(p.spriteVersionNumber) === 2 ? 2 : 1,
      likes: Number(p.likeCount) || 0,
    })).filter((p) => ID_PATTERN.test(p.id)),
  };
}

module.exports = {
  DEFAULT_GALLERY, parsePetRef, readZip, packageFromFiles, writePackage, installFromGallery, installFromLocal, searchGallery,
};
