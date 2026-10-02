'use strict';
// Claude 데스크톱 앱 연결: claude_desktop_config.json 의 mcpServers 에 ClaudePet 로컬 MCP 서버(mcp.js)를 등록한다.
// 등록해 두면 이 PC 에 연결된 Claude 채팅이 폴더 권한 없이 펫에게 신호를 보낼 수 있다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { APP_DIR, readJson, writeJsonAtomic, log } = require('./config');

const SERVER_NAME = 'claudepet';
const CONFIG_NAME = 'claude_desktop_config.json';

/** Claude 데스크톱 앱 설정 폴더 후보 (앱이 설치돼 있으면 폴더가 있다) */
function desktopDirs() {
  const home = os.homedir();
  const dirs = [];
  if (process.env.CLAUDE_PET_DESKTOP_DIR) {
    dirs.push(path.resolve(process.env.CLAUDE_PET_DESKTOP_DIR));
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appData, 'Claude'));
    // Microsoft Store(MSIX)판은 AppData 가 패키지 폴더로 가상화됨
    try {
      const pkgs = path.join(localAppData, 'Packages');
      for (const name of fs.readdirSync(pkgs)) {
        if (/claude/i.test(name)) dirs.push(path.join(pkgs, name, 'LocalCache', 'Roaming', 'Claude'));
      }
    } catch { /* Packages 폴더 없음 */ }
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    dirs.push(path.join(xdg, 'Claude'));
  }
  return dirs.filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  });
}

function configFiles() {
  return desktopDirs().map((d) => path.join(d, CONFIG_NAME));
}

/** 데스크톱 앱이 띄울 명령. 설치판·소스판 모두 Electron 실행 파일을 Node 로 써서 mcp.js 를 돌린다 */
function longPath(p) {
  // .cmd 런처로 실행되면 8.3 짧은 경로(C:\Users\ABCDEF~1\...)일 수 있어 실제 경로로 맞춤
  try { return fs.realpathSync.native(p); } catch { return p; }
}

function serverEntry() {
  const entry = { command: longPath(process.execPath), args: [longPath(path.join(APP_DIR, 'mcp.js'))] };
  if (process.versions.electron) entry.env = { ELECTRON_RUN_AS_NODE: '1' };
  return entry;
}

function sameEntry(a, b) {
  return !!a && JSON.stringify({ command: a.command, args: a.args, env: a.env || undefined })
    === JSON.stringify({ command: b.command, args: b.args, env: b.env || undefined });
}

/** 'no-app' | 'none' | 'outdated' | 'current' | 'broken'(설정 파일을 읽을 수 없음) */
function desktopState() {
  const files = configFiles();
  if (files.length === 0) return 'no-app';
  const want = serverEntry();
  let worst = 'current';
  const rank = { current: 0, outdated: 1, none: 2, broken: 3 };
  for (const file of files) {
    let state;
    if (!fs.existsSync(file)) state = 'none';
    else {
      const json = readJson(file, undefined);
      if (!json || typeof json !== 'object' || Array.isArray(json)) state = 'broken';
      else {
        const cur = json.mcpServers && json.mcpServers[SERVER_NAME];
        state = !cur ? 'none' : (sameEntry(cur, want) ? 'current' : 'outdated');
      }
    }
    if (rank[state] > rank[worst]) worst = state;
  }
  return worst;
}

function editConfig(file, fn) {
  let json = {};
  if (fs.existsSync(file)) {
    json = readJson(file, undefined);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error(`${file} 을(를) 읽을 수 없어 건드리지 않았어요 (JSON 형식 오류)`);
    }
    const backup = `${file}.claudepet-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  }
  const changed = fn(json);
  if (changed) writeJsonAtomic(file, json);
  return changed;
}

/** mcpServers.claudepet 등록(또는 경로 갱신). 다른 서버·설정은 그대로 둔다 */
function registerDesktop() {
  const files = configFiles();
  if (files.length === 0) return { ok: false, error: 'no-app', files };
  const want = serverEntry();
  const changed = [];
  for (const file of files) {
    const did = editConfig(file, (json) => {
      if (!json.mcpServers || typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers)) json.mcpServers = {};
      if (sameEntry(json.mcpServers[SERVER_NAME], want)) return false;
      json.mcpServers[SERVER_NAME] = want;
      return true;
    });
    if (did) changed.push(file);
  }
  if (changed.length) log('claude desktop: mcp 등록', changed.join(', '));
  return { ok: true, changed, files };
}

/** mcpServers.claudepet 만 지운다 */
function unregisterDesktop() {
  const changed = [];
  for (const file of configFiles()) {
    if (!fs.existsSync(file)) continue;
    try {
      const did = editConfig(file, (json) => {
        if (!json.mcpServers || !json.mcpServers[SERVER_NAME]) return false;
        delete json.mcpServers[SERVER_NAME];
        return true;
      });
      if (did) changed.push(file);
    } catch (e) {
      log('claude desktop: 등록 해제 실패', e.message);
    }
  }
  if (changed.length) log('claude desktop: mcp 해제', changed.join(', '));
  return { ok: true, changed };
}

module.exports = { SERVER_NAME, desktopDirs, configFiles, serverEntry, desktopState, registerDesktop, unregisterDesktop };
