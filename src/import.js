'use strict';
// 메인 프로세스: 이미지 파일 → (숨은 창에서 디코딩) → ~/.claude/pets/<id>/ 에 ClaudePet 형식 펫 저장
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { paths, readJson, writeJsonAtomic } = require('./core/config');
const { CUSTOM_STATES } = require('./core/pets');

const MAX_BYTES = 30 * 1024 * 1024;
const jobs = new Map(); // webContents.id -> { job, resolve }

ipcMain.handle('importer:job', (e) => {
  const j = jobs.get(e.sender.id);
  return j ? j.job : null;
});
ipcMain.on('importer:done', (e, result) => {
  const j = jobs.get(e.sender.id);
  if (j) j.resolve(result);
});

function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return null;
}

function decodeInHiddenWindow(bytes, mime, removeBg) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: {
        preload: path.join(__dirname, 'importer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const id = win.webContents.id;
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      jobs.delete(id);
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: '변환 시간이 너무 오래 걸려요 (30초 초과)' }), 30000);
    jobs.set(id, { job: { bytes: new Uint8Array(bytes), mime, removeBg }, resolve: finish });
    win.webContents.on('render-process-gone', () => finish({ ok: false, error: '변환 중 렌더러가 종료됐어요' }));
    win.loadFile(path.join(__dirname, 'importer', 'index.html')).catch((e) => finish({ ok: false, error: e.message }));
  });
}

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'gif-pet';
}

function uniqueId(base) {
  let id = base;
  for (let n = 2; fs.existsSync(path.join(paths.claudePets, id)); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * opts: { file, id?, name?, state?, removeBg?: 'auto'|'on'|'off' }
 *  - state 없으면 새 펫(default 애니메이션) 생성. id 를 주면 그 펫을 덮어씀.
 *  - state 가 있으면 기존 ClaudePet 형식 펫(id)에 그 상태용 애니메이션 추가.
 */
async function importAnimation(opts) {
  const file = path.resolve(String(opts.file || ''));
  let stat;
  try { stat = fs.statSync(file); } catch { throw new Error(`파일이 없어요: ${file}`); }
  if (!stat.isFile()) throw new Error('파일이 아니에요');
  if (stat.size > MAX_BYTES) throw new Error('파일이 너무 커요 (30MB 초과)');
  const bytes = fs.readFileSync(file);
  const mime = sniffMime(bytes);
  if (!mime) throw new Error('GIF / PNG(APNG) / WebP / JPG 이미지만 가져올 수 있어요');

  const state = opts.state ? String(opts.state) : null;
  if (state && (!CUSTOM_STATES.includes(state))) {
    throw new Error(`상태 이름: ${CUSTOM_STATES.join(', ')}`);
  }

  let id;
  let manifest;
  if (state) {
    id = slugify(opts.id);
    const mf = path.join(paths.claudePets, id, 'pet.json');
    manifest = readJson(mf, null);
    if (!manifest || !manifest.claudePet || !manifest.claudePet.animations) {
      throw new Error(`'${id}' 는 GIF로 만든 펫이 아니에요. 먼저 import 로 펫을 만드세요`);
    }
  } else {
    id = opts.id ? slugify(opts.id) : uniqueId(slugify(path.basename(file)));
    const existing = opts.id ? readJson(path.join(paths.claudePets, id, 'pet.json'), null) : null;
    manifest = existing && existing.claudePet && existing.claudePet.animations
      ? existing // 같은 펫을 다시 가져오면 상태별 애니메이션은 유지하고 기본만 교체
      : {
        id,
        displayName: id,
        description: `${path.basename(file)} 에서 가져온 ClaudePet 펫`,
        claudePet: { format: 1, animations: {} },
      };
    if (opts.name && String(opts.name).trim()) manifest.displayName = String(opts.name).trim().slice(0, 60);
  }

  const result = await decodeInHiddenWindow(bytes, mime, opts.removeBg || 'auto');
  if (!result || !result.ok) throw new Error((result && result.error) || '변환 실패');

  const folder = path.join(paths.claudePets, id);
  fs.mkdirSync(folder, { recursive: true });
  const sheetName = `${state || 'default'}.png`;
  fs.writeFileSync(path.join(folder, sheetName), Buffer.from(result.png));
  manifest.claudePet.animations[state || 'default'] = {
    sheet: sheetName,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    frames: result.frames,
    columns: result.columns,
    durations: result.durations,
  };
  writeJsonAtomic(path.join(folder, 'pet.json'), manifest);
  return {
    id,
    displayName: manifest.displayName,
    state: state || 'default',
    frames: result.frames,
    size: [result.frameWidth, result.frameHeight],
    removedBackground: result.removedBackground,
    folder,
  };
}

module.exports = { importAnimation, sniffMime, slugify };
