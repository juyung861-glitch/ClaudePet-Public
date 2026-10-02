'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-gallery-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, '.claude');
process.env.CLAUDE_PET_HOME = path.join(tmp, 'pet-home');
process.env.CODEX_HOME = path.join(tmp, '.codex');

const g = require('../src/core/gallery');
const { findPet } = require('../src/core/pets');

const petsDir = path.join(tmp, '.claude', 'pets');
const WEBP = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8L', 'latin1'), Buffer.alloc(40)]);

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}

/** 테스트용 zip 만들기 (deflate=true 면 압축) — codex-pets.net 서버와 같은 구조 */
function makeZip(entries, { deflate = false } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(h, nameBuf, body);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const manifest = (id, extra = {}) => Buffer.from(JSON.stringify({ id, displayName: `Pet ${id}`, description: 'd', spritesheetPath: 'spritesheet.webp', ...extra }));

function mockFetch(routes, log = []) {
  return async (url) => {
    log.push(url);
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    if (!hit) return { ok: false, status: 404, url, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
    const [, value] = hit;
    const body = typeof value === 'function' ? value(url) : value;
    return {
      ok: true, status: 200, url: body.redirect || url,
      headers: { get: () => null },
      arrayBuffer: async () => (body.data || body).buffer.slice((body.data || body).byteOffset, (body.data || body).byteOffset + (body.data || body).length),
    };
  };
}

test('parsePetRef: 페이지 링크, 다운로드 링크, 설치 명령, id, 다른 사이트 거부', () => {
  assert.deepEqual(g.parsePetRef('https://codex-pets.net/pets/sample-cat'), { id: 'sample-cat', gallery: 'https://codex-pets.net' });
  assert.equal(g.parsePetRef('https://codex-pets.net/pets/jolyne-cujoh-stone-free?comment=1').id, 'jolyne-cujoh-stone-free');
  assert.equal(g.parsePetRef('curl -L "https://codex-pets.net/api/pets/sample-cat/download?v=1" \\\n -o /tmp/x.zip').id, 'sample-cat');
  assert.equal(g.parsePetRef('npx codex-pets add pet-6abcd821e18081918d0183c471df2603').id, 'pet-6abcd821e18081918d0183c471df2603');
  assert.equal(g.parsePetRef('  Sample-Cat ').id, 'sample-cat');
  assert.equal(g.parsePetRef('https://codex-pets.net/#/pets/my-pet').id, 'my-pet', '해시 주소');
  assert.equal(g.parsePetRef('https://codex-pets.net/#/pets/my-pet?comment=3').id, 'my-pet');
  assert.equal(g.parsePetRef('npx codex-pets add my-pet').id, 'my-pet');
  assert.equal(g.parsePetRef('https://codex-pets.net/#/gallery'), null);
  assert.equal(g.parsePetRef('https://evil.example/pets/sample-cat').error, 'host');
  assert.equal(g.parsePetRef('https://codex-pets.net/'), null);
  assert.equal(g.parsePetRef('../../etc'), null);
  assert.equal(g.parsePetRef(''), null);
});

test('zip 읽기: 무압축/압축 모두', () => {
  for (const deflate of [false, true]) {
    const files = g.readZip(makeZip([['pet.json', manifest('a')], ['spritesheet.webp', WEBP]], { deflate }));
    assert.deepEqual([...files.keys()], ['pet.json', 'spritesheet.webp']);
    assert.ok(files.get('spritesheet.webp').equals(WEBP));
  }
  assert.throws(() => g.readZip(Buffer.from('not a zip at all, nope nope nope')), /zip/);
});

test('갤러리에서 설치: 다운로드 주소, 파일 저장, 펫으로 인식', async () => {
  const log = [];
  const fetchImpl = mockFetch({ 'https://codex-pets.net/api/pets/sample-cat/download': makeZip([['pet.json', manifest('sample-cat', { displayName: '샘플 고양이' })], ['spritesheet.webp', WEBP]]) }, log);
  const r = await g.installFromGallery('https://codex-pets.net/pets/sample-cat', { fetchImpl, petsDir });
  assert.equal(log[0], 'https://codex-pets.net/api/pets/sample-cat/download');
  assert.equal(r.folderId, 'sample-cat');
  assert.ok(fs.existsSync(path.join(petsDir, 'sample-cat', 'spritesheet.webp')));
  const pet = findPet('sample-cat');
  assert.equal(pet.displayName, '샘플 고양이');
  assert.equal(pet.kind, 'codex');
  assert.equal(pet.source, 'claude');
  assert.equal(JSON.parse(fs.readFileSync(path.join(petsDir, 'sample-cat', '.source.json'))).page, 'https://codex-pets.net/pets/sample-cat');
});

test('갤러리: 없는 펫, 다른 사이트로 리다이렉트, 이상한 패키지 거부', async () => {
  await assert.rejects(g.installFromGallery('nope-pet', { fetchImpl: mockFetch({}), petsDir }), /그런 펫이 없어요/);
  const redirect = mockFetch({ 'https://codex-pets.net/api/pets/x/download': { data: makeZip([['pet.json', manifest('x')]]), redirect: 'https://evil.example/x.zip' } });
  await assert.rejects(g.installFromGallery('x', { fetchImpl: redirect, petsDir }), /허용되지 않은/);
  const noSheet = mockFetch({ 'https://codex-pets.net/api/pets/y/download': makeZip([['pet.json', manifest('y', { spritesheetPath: '../../evil.webp' })]]) });
  await assert.rejects(g.installFromGallery('y', { fetchImpl: noSheet, petsDir }), /스프라이트시트/);
  const notImage = mockFetch({ 'https://codex-pets.net/api/pets/z/download': makeZip([['pet.json', manifest('z')], ['spritesheet.webp', Buffer.from('#!/bin/sh echo hi')]]) });
  await assert.rejects(g.installFromGallery('z', { fetchImpl: notImage, petsDir }), /스프라이트시트/);
  await assert.rejects(g.installFromGallery('https://evil.example/pets/a', { fetchImpl: mockFetch({}), petsDir }), /지원하지 않는 사이트/);
  assert.ok(!fs.existsSync(path.join(petsDir, 'y')) && !fs.existsSync(path.join(petsDir, 'z')));
});

test('내려받은 zip(하위 폴더 포함)·폴더 설치', () => {
  const zipFile = path.join(tmp, 'Cool Cat.codex-pet.zip');
  fs.writeFileSync(zipFile, makeZip([['cool-cat/pet.json', manifest('Cool Cat!!')], ['cool-cat/spritesheet.webp', WEBP]], { deflate: true }));
  const r = g.installFromLocal(zipFile, { petsDir });
  assert.equal(r.folderId, 'cool-cat');
  assert.ok(findPet('cool-cat'));

  const dir = path.join(tmp, 'loose');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pet.json'), manifest('loose-pet'));
  fs.writeFileSync(path.join(dir, 'spritesheet.webp'), WEBP);
  assert.equal(g.installFromLocal(dir, { petsDir }).folderId, 'loose-pet');
});

test('갤러리 검색 결과 정리', async () => {
  const body = Buffer.from(JSON.stringify({ total: 2, pets: [
    { id: 'sample-cat', displayName: '샘플 고양이', kind: 'animal', spriteVersionNumber: 2, likeCount: 3 },
    { id: '../bad', displayName: 'bad' },
  ] }));
  const log = [];
  const r = await g.searchGallery('햄', { fetchImpl: mockFetch({ 'https://codex-pets.net/api/pets?q=': body }, log) });
  assert.equal(log[0], 'https://codex-pets.net/api/pets?q=%ED%96%84&page=1');
  assert.deepEqual(r.pets.map((p) => p.id), ['sample-cat']);
  assert.equal(r.pets[0].version, 2);
});
