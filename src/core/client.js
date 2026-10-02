'use strict';
// hook.js / cli.js 에서 쓰는 가벼운 클라이언트 (Electron 없이 동작)
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { APP_DIR, PACKAGED, paths, log } = require('./config');

function request(port, urlPath, body, timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method: data ? 'POST' : 'GET',
      headers: data
        ? { 'content-type': 'application/json', 'content-length': data.length, 'x-claude-pet': '1' }
        : { 'x-claude-pet': '1' },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function health(port, timeoutMs = 600) {
  try {
    const r = await request(port, '/health', null, timeoutMs);
    return r.status === 200 && r.body && r.body.app === 'claude-pet' ? r.body : null;
  } catch {
    return null;
  }
}

function electronBinary() {
  // 설치판: 훅·CLI 도 ClaudePet.exe 를 Node 처럼 써서 실행되므로 자기 자신이 곧 펫 앱
  if (process.versions.electron) return process.execPath;
  try {
    // electron npm 패키지는 일반 Node 에서 require 하면 실행 파일 경로를 돌려준다
    const p = require(path.join(APP_DIR, 'node_modules', 'electron'));
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch { /* 미설치 */ }
  return null;
}

/** 리눅스에서 chrome-sandbox 권한이 없으면(또는 root 이면) Electron 이 바로 죽으므로 --no-sandbox 를 붙인다 */
function electronArgs(bin) {
  const args = [];
  if (process.platform === 'linux') {
    let needsNoSandbox = typeof process.getuid === 'function' && process.getuid() === 0;
    try {
      const st = fs.statSync(path.join(path.dirname(bin), 'chrome-sandbox'));
      if (st.uid !== 0 || !(st.mode & 0o4000)) needsNoSandbox = true;
    } catch { /* 샌드박스 도우미 없음 */ }
    if (needsNoSandbox) args.push('--no-sandbox');
  }
  if (!PACKAGED) args.push(APP_DIR);
  return args;
}

const LAUNCH_MARK = () => path.join(paths.data, 'launching');

/** 펫 앱을 백그라운드로 띄운다. bootEvent 는 시작하자마자 반영할 훅 이벤트 */
function launchApp(bootEvent, { force = false } = {}) {
  const bin = electronBinary();
  if (!bin) {
    log('launch: 실행 파일을 찾지 못함 — 소스판이면 앱 폴더에서 npm install 을 실행하세요', APP_DIR);
    return { ok: false, error: 'electron-missing' };
  }
  try {
    const st = fs.statSync(LAUNCH_MARK());
    if (!force && Date.now() - st.mtimeMs < 8000) return { ok: false, error: 'launch-in-progress' };
  } catch { /* 표시 없음 */ }
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(LAUNCH_MARK(), String(Date.now()));
  } catch { /* 무시 */ }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VS Code 등에서 상속되면 Electron 이 Node 로 동작해버림
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  if (bootEvent) env.CLAUDE_PET_BOOT = JSON.stringify(bootEvent);
  const child = spawn(bin, electronArgs(bin), {
    cwd: PACKAGED ? path.dirname(bin) : APP_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env,
  });
  child.on('error', (e) => log('launch error', e.message));
  child.unref();
  return { ok: true, pid: child.pid };
}

async function waitForHealth(port, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const h = await health(port, 400);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

module.exports = { request, health, launchApp, waitForHealth, electronBinary };
