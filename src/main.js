'use strict';
// Electron 메인 프로세스: 투명 펫 창 + 로컬 서버 + 트레이/메뉴
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, Menu, Tray, screen, nativeImage, shell, dialog, clipboard, net } = require('electron');

const { paths, PACKAGED, loadConfig, updateConfig, readJson, writeJsonAtomic, ensureConfigFile, log } = require('./core/config');
const hooksSetup = require('../scripts/install');
const desktop = require('./core/desktop');
const { listPets, resolvePet, findPet, loadSpriteDataUrl, loadCustomAnimations } = require('./core/pets');
const { importAnimation } = require('./import');
const gallery = require('./core/gallery');
const { watchInbox } = require('./core/inbox');
const { resolveAnimations, lookCell, CELL_W, CELL_H, ANIMATION_NAMES } = require('./core/atlas');
const { PetEngine } = require('./core/engine');
const { createServer, listen } = require('./core/server');
const { health, request } = require('./core/client');
const pkg = require('../package.json');

const BUBBLE_SPACE = 64;
const MIN_WIDTH = 220;
const SIZE_PRESETS = [
  { key: 'small', scale: 0.35 },
  { key: 'normal', scale: 0.5 },
  { key: 'large', scale: 0.75 },
  { key: 'xlarge', scale: 1.0 },
];

const MENU_TEXT = {
  ko: {
    changePet: '펫 바꾸기', importGif: '파일로 펫 추가… (zip · GIF)', openGallery: 'codex-pets.net 에서 고르기', installCopied: '복사한 펫 받기', noCopied: '(펫 페이지 링크를 복사하면 여기서 받기)', installByLink: '링크·이름으로 펫 받기…', addState: '이 펫에 상태별 GIF 추가', openPets: '내 펫 폴더 열기', openCodexPets: 'Codex 펫 폴더 열기', refresh: '목록 새로고침',
    size: '크기', small: '작게', normal: '보통', large: '크게', xlarge: '아주 크게',
    bubbles: '말풍선', all: '모두 보기', important: '중요한 것만', off: '끄기',
    look: '마우스 바라보기 (v2 펫)', preview: '동작 미리보기', resetPos: '위치 초기화',
    autoStart: 'Claude Code 시작 시 자동 실행', quitWithSessions: '세션이 모두 끝나면 같이 종료',
    openConfig: '설정 파일 열기', openLog: '로그 열기', quit: '종료', codex: 'Codex', claude: '내 펫', builtin: '기본', extra: '추가',
    noPets: '(펫 없음)', claudeCode: 'Claude Code 와 연결', desktopApp: 'Claude 데스크톱 앱과 연결 (채팅 알림)', loginItem: '컴퓨터 켤 때 같이 실행', openUserDir: '클라우드 신호 폴더 열기 (~/ClaudePet)', chatAlerts: 'Claude 채팅 답변 알림 설정…', about: 'ClaudePet',
  },
  en: {
    changePet: 'Change pet', importGif: 'Add pet from file… (zip · GIF)', openGallery: 'Browse codex-pets.net', installCopied: 'Install copied pet', noCopied: '(copy a pet page link to install it here)', installByLink: 'Install pet from link or name…', addState: 'Add a GIF for a state', openPets: 'Open my pets folder', openCodexPets: 'Open Codex pets folder', refresh: 'Refresh list',
    size: 'Size', small: 'Small', normal: 'Normal', large: 'Large', xlarge: 'Extra large',
    bubbles: 'Speech bubbles', all: 'All', important: 'Important only', off: 'Off',
    look: 'Look at cursor (v2 pets)', preview: 'Preview animations', resetPos: 'Reset position',
    autoStart: 'Auto-start with Claude Code', quitWithSessions: 'Quit when all sessions end',
    openConfig: 'Open config file', openLog: 'Open log', quit: 'Quit', codex: 'Codex', claude: 'Mine', builtin: 'Built-in', extra: 'Extra',
    noPets: '(no pets)', claudeCode: 'Connect to Claude Code', desktopApp: 'Connect to Claude desktop app (chat alerts)', loginItem: 'Start when I log in', openUserDir: 'Open cloud signal folder (~/ClaudePet)', chatAlerts: 'Set up Claude chat reply alerts…', about: 'ClaudePet',
  },
};

let cfg;
let engine;
let win = null;
let tray = null;
let server = null;
let pet = null;
let petBox = { w: CELL_W, h: CELL_H }; // 배율 1 기준 펫 크기 (Codex 셀 192x208)
let atlasVersion = 1;
let rendererReady = false;
const pending = [];
let dragState = null;
let lookTimer = null;
let lastLookKey = '';
let quitting = false;

// ---- 시작 --------------------------------------------------------------------
// 설치 프로그램이 부르는 정리 모드: 창 없이 훅만 지우고 끝냄 (제거할 때)
const MAINTENANCE = process.argv.includes('--remove-hooks') ? 'remove' : (process.argv.includes('--install-hooks') ? 'install' : null);
// 설치판은 소스판과 다른 데이터 폴더를 써서, 예전 소스판 펫이 떠 있어도 실행이 막히지 않게 (포트는 아래에서 이어받음)
if (PACKAGED) {
  app.setName('ClaudePet');
  app.setPath('userData', path.join(app.getPath('appData'), 'ClaudePet'));
}
const gotLock = MAINTENANCE ? false : app.requestSingleInstanceLock({ boot: process.env.CLAUDE_PET_BOOT || null });
if (MAINTENANCE) {
  try {
    if (MAINTENANCE === 'remove') {
      hooksSetup.removeHooks();
      desktop.unregisterDesktop(); // 지워진 ClaudePet.exe 를 Claude 앱이 계속 띄우려 하지 않게
      updateConfig({ claudeCode: null, desktopApp: null });
    } else {
      hooksSetup.install();
      const r = desktop.registerDesktop();
      updateConfig(r.ok ? { claudeCode: true, desktopApp: true } : { claudeCode: true });
    }
  } catch (e) {
    log('maintenance failed', e.message);
  }
  app.exit(0);
} else if (!gotLock) {
  app.quit();
} else {
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.disableHardwareAcceleration();
  }
  if (process.platform === 'win32') app.setAppUserModelId('dev.claude-pet');
  app.on('second-instance', (_e, _argv, _cwd, data) => {
    if (data && data.boot) applyBoot(data.boot);
    if (win && !win.isVisible()) win.showInactive();
  });
  app.whenReady().then(start).catch((e) => {
    log('start failed', e.stack || e.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}

async function start() {
  ensureConfigFile();
  cfg = loadConfig();
  try { fs.rmSync(path.join(paths.data, 'launching'), { force: true }); } catch { /* 무시 */ }
  try { fs.rmSync(paths.dismissed, { force: true }); } catch { /* 무시 */ }

  engine = new PetEngine({ config: cfg });
  engine.on('display', (d) => send('pet:display', d));
  engine.on('oneshot', (o) => send('pet:oneshot', o));
  engine.on('bubble', (b) => send('pet:bubble', b));
  engine.on('empty', () => {
    if (cfg.quitWhenNoSessions) setTimeout(() => { if (engine.sessions.size === 0) quit(false); }, 3000);
  });
  setInterval(() => engine.tick(), 1000);

  server = createServer({
    onEvent: (evt) => engine.handle(evt),
    onControl: (body) => control(body || {}),
    info: () => ({ version: pkg.version, pid: process.pid, pet: pet && pet.id }),
  });
  try {
    await listen(server, cfg.port);
  } catch (e) {
    // 예전 버전(소스판 등) 펫이 떠 있으면 끄고 자리를 넘겨받는다
    const other = await health(cfg.port, 800);
    if (other) {
      log(`이전 펫(pid ${other.pid}, v${other.version}) 종료 후 이어받기`);
      await request(cfg.port, '/control', { cmd: 'quit' }, 1500).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
    }
    try {
      await listen(server, cfg.port);
    } catch (e2) {
      log(`port ${cfg.port} 사용 불가:`, e2.message);
      dialog.showErrorBox('ClaudePet', `포트 ${cfg.port} 을(를) 다른 프로그램이 쓰고 있어요.\n${paths.config} 에서 "port" 를 바꿔 주세요.`);
      app.quit();
      return;
    }
  }

  createWindow();
  createTray();
  // 클라우드 Claude 가 연결된 폴더에 남기는 신호 받기
  watchInbox((evt) => engine.handle(evt), { log });
  ensureUserDir();
  loadPet(resolvePet(cfg));
  applyBoot(process.env.CLAUDE_PET_BOOT);
  log(`started pid=${process.pid} port=${cfg.port} pet=${pet && pet.id} packaged=${PACKAGED}`);
  setTimeout(() => {
    ensureClaudeCodeLink()
      .catch((e) => log('link failed', e.message))
      .then(() => ensureDesktopLink())
      .catch((e) => log('desktop link failed', e.message));
  }, 1500);
}

/** ~/ClaudePet: 클라우드 Claude 와 연결할 때 Claude 앱에서 고르는 폴더 */
function ensureUserDir() {
  try {
    fs.mkdirSync(paths.inbox, { recursive: true });
    const readme = path.join(paths.userDir, '읽어주세요.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, [
        'ClaudePet 폴더',
        '',
        'Claude 앱(claude.ai 채팅·클라우드 작업)과 펫을 연결하려면, Claude 앱에서 이 폴더를 대화에 연결(폴더 추가)하고',
        '"작업 끝나면 펫한테 알려줘" 라고 말하세요. Claude 가 inbox 폴더에 신호를 남기면 펫이 반응해요.',
        '',
        '신호 형식: inbox/아무이름.json  →  {"event":"Stop","message":"한 줄 요약"}',
        '',
      ].join('\r\n'), 'utf8');
    }
  } catch (e) {
    log('user dir', e.message);
  }
}

/**
 * Claude 채팅(claude.ai · 데스크톱 앱) 답변 알림 설정 도우미.
 * 스킬 zip 을 ~/ClaudePet 에 두고, 'Instructions for Claude' 에 넣을 문구를 클립보드에 복사한 뒤 순서를 안내한다.
 */
async function setupChatAlerts() {
  const ko = cfg.language !== 'en';
  ensureUserDir();
  const src = path.join(__dirname, '..', 'extras', 'chat-alerts');
  const zipDest = path.join(paths.userDir, 'pet-chat-alerts.zip');
  fs.copyFileSync(path.join(src, 'pet-chat-alerts.zip'), zipDest);
  const instructions = fs.readFileSync(path.join(src, 'instructions.txt'), 'utf8').trim();
  clipboard.writeText(instructions);
  // 데스크톱 앱과 연결돼 있으면 대화마다 폴더 허용을 누를 필요가 없음
  let linked = false;
  let restart = false;
  try {
    const before = desktop.desktopState();
    if (before !== 'no-app' && before !== 'broken') {
      if (before !== 'current') { linkDesktop(true, { quiet: true }); restart = true; }
      linked = desktop.desktopState() === 'current';
    }
  } catch (e) {
    log('chat alerts: desktop link', e.message);
  }
  const r = await dialog.showMessageBox({
    type: 'info',
    title: 'ClaudePet',
    message: ko ? 'Claude 채팅 답변 알림 설정' : 'Set up Claude chat reply alerts',
    detail: ko
      ? '채팅 답변이 끝날 때 펫이 알려주게 하려면 두 가지만 하면 돼요.\n\n'
        + '① 스킬 올리기\nClaude → Customize → Skills → + → Create skill → Upload a skill\n→ ' + zipDest + '\n(Settings 에서 코드 실행이 켜져 있어야 해요)\n\n'
        + '② 지침 붙여넣기\nClaude → Settings → "Instructions for Claude" 칸에 붙여넣기\n(문구는 방금 클립보드에 복사했어요)\n\n'
        + (linked
          ? '③ Claude 데스크톱 앱과도 연결해 뒀어요.' + (restart ? ' Claude 앱을 완전히 종료(트레이 아이콘 → 종료)했다가 다시 켜 주세요.' : '')
            + '\n그다음부터는 데스크톱 앱에서 이 PC 에 연결된 대화라면 새 대화도 클릭 없이 알림이 켜져요.'
          : '그다음 Claude 데스크톱 앱에서 이 PC 에 연결된 대화를 열면, 첫 답변 때 ClaudePet 폴더 접근을 한 번 물어봐요 → 허용.')
      : 'Two steps so your pet tells you when a chat reply is done:\n\n'
        + '1) Upload the skill\nClaude → Customize → Skills → + → Create skill → Upload a skill\n→ ' + zipDest + '\n(code execution must be on in Settings)\n\n'
        + '2) Paste the instructions\nClaude → Settings → "Instructions for Claude"\n(the text is already on your clipboard)\n\n'
        + (linked
          ? '3) ClaudePet is also linked to the Claude desktop app.' + (restart ? ' Fully quit Claude (tray icon → Quit) and open it again.' : '')
            + '\nAfter that, every chat linked to this PC turns alerts on without any clicks.'
          : 'Then open a chat in the Claude desktop app linked to this PC and allow access to the ClaudePet folder once.'),
    buttons: ko ? ['스킬 파일 위치 열기', '닫기'] : ['Show skill file', 'Close'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) shell.showItemInFolder(zipDest);
}

/**
 * Claude Code 연결(훅·/pet 명령) 관리.
 *  - 처음 실행: 설치판이면 연결할지 물어봄
 *  - 프로그램 위치가 바뀌었으면(업데이트·재설치) 조용히 경로 갱신
 */
async function ensureClaudeCodeLink() {
  if (cfg.claudeCode === false) return;
  let state;
  try {
    state = hooksSetup.hookState();
  } catch {
    state = 'none';
  }
  if (state === 'current') {
    if (cfg.claudeCode !== true) cfg = updateConfig({ claudeCode: true });
    return;
  }
  if (state === 'outdated' || cfg.claudeCode === true) {
    linkClaudeCode(true, { quiet: state === 'outdated' });
    return;
  }
  if (!PACKAGED) return; // 소스판은 npm run setup 으로 직접 연결
  const ko = cfg.language !== 'en';
  const r = await dialog.showMessageBox({
    type: 'question',
    title: 'ClaudePet',
    buttons: ko ? ['연결하기', '나중에'] : ['Connect', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: ko ? 'Claude Code 와 연결할까요?' : 'Connect to Claude Code?',
    detail: ko
      ? 'Claude Code 가 일하고, 허락을 기다리고, 일을 끝낼 때 펫이 반응하도록 설정해요.\n\n'
        + '· ~/.claude/settings.json 에 훅 추가 (기존 파일은 백업, 다른 설정은 그대로)\n'
        + '· /pet 명령 추가\n\n펫 우클릭 메뉴에서 언제든 끌 수 있어요.'
      : 'Adds hooks to ~/.claude/settings.json (backed up) and a /pet command so your pet reacts to Claude Code. You can turn this off from the menu anytime.',
  });
  if (r.response === 0) linkClaudeCode(true);
  else cfg = updateConfig({ claudeCode: false });
}

function linkClaudeCode(on, { quiet = false } = {}) {
  const ko = cfg.language !== 'en';
  try {
    if (on) {
      hooksSetup.install();
      cfg = updateConfig({ claudeCode: true });
      if (!quiet) send('pet:bubble', { text: ko ? 'Claude Code 와 연결했어요!' : 'Connected to Claude Code!', ms: 4500, important: true });
    } else {
      hooksSetup.removeHooks();
      cfg = updateConfig({ claudeCode: false });
      send('pet:bubble', { text: ko ? 'Claude Code 연결을 껐어요' : 'Disconnected from Claude Code', ms: 4000, important: true });
    }
    log(`claude code link: ${on ? 'on' : 'off'}`);
  } catch (e) {
    log('claude code link failed', e.message);
    send('pet:bubble', { text: e.message.slice(0, 80), ms: 7000, important: true });
  }
}

/**
 * Claude 데스크톱 앱 연결(로컬 MCP 서버 등록) 관리.
 *  - 데스크톱 앱이 없으면 아무것도 안 함
 *  - 처음: 설치판이면 연결할지 한 번 물어봄 / 경로가 바뀌었으면 조용히 갱신
 */
async function ensureDesktopLink() {
  if (cfg.desktopApp === false) return;
  const state = desktop.desktopState();
  if (state === 'no-app' || state === 'broken') return;
  if (state === 'current') {
    if (cfg.desktopApp !== true) cfg = updateConfig({ desktopApp: true });
    return;
  }
  if (state === 'outdated' || cfg.desktopApp === true) {
    linkDesktop(true, { quiet: state === 'outdated' });
    return;
  }
  if (!PACKAGED) return; // 소스판은 메뉴에서 직접 켬
  const ko = cfg.language !== 'en';
  const r = await dialog.showMessageBox({
    type: 'question',
    title: 'ClaudePet',
    buttons: ko ? ['연결하기', '나중에'] : ['Connect', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: ko ? 'Claude 데스크톱 앱과도 연결할까요?' : 'Connect to the Claude desktop app too?',
    detail: ko
      ? 'Claude 채팅(데스크톱 앱에서 이 PC 와 연결된 대화)의 답변이 끝날 때, 대화마다 폴더 허용을 누르지 않아도 펫이 알려주게 돼요.\n\n'
        + '· Claude 앱 설정(claude_desktop_config.json)에 ClaudePet 연결 도구 추가 (기존 파일은 백업, 다른 설정은 그대로)\n'
        + '· 연결한 뒤 Claude 앱을 완전히 종료(트레이 아이콘 → 종료)했다가 다시 켜 주세요\n\n펫 우클릭 메뉴에서 언제든 끌 수 있어요.'
      : 'Lets your pet announce Claude chat replies (chats linked to this PC in the desktop app) without allowing folder access in every chat.\n\n'
        + '· Adds a ClaudePet tool to claude_desktop_config.json (backed up, other settings untouched)\n'
        + '· Afterwards fully quit Claude (tray icon → Quit) and open it again\n\nYou can turn this off from the menu anytime.',
  });
  if (r.response === 0) linkDesktop(true);
  else cfg = updateConfig({ desktopApp: false });
}

function linkDesktop(on, { quiet = false } = {}) {
  const ko = cfg.language !== 'en';
  try {
    if (on) {
      const r = desktop.registerDesktop();
      if (!r.ok) {
        send('pet:bubble', { text: ko ? 'Claude 데스크톱 앱을 찾지 못했어요' : 'Claude desktop app not found', ms: 5000, important: true });
        return;
      }
      cfg = updateConfig({ desktopApp: true });
      if (!quiet) {
        send('pet:bubble', {
          text: ko ? 'Claude 앱과 연결했어요! Claude 앱을 다시 켜면 적용돼요' : 'Linked! Restart the Claude app to apply',
          ms: 8000, important: true,
        });
      }
    } else {
      desktop.unregisterDesktop();
      cfg = updateConfig({ desktopApp: false });
      send('pet:bubble', { text: ko ? 'Claude 데스크톱 앱 연결을 껐어요' : 'Disconnected from the Claude desktop app', ms: 4000, important: true });
    }
    log(`claude desktop link: ${on ? 'on' : 'off'}`);
  } catch (e) {
    log('claude desktop link failed', e.message);
    send('pet:bubble', { text: e.message.slice(0, 80), ms: 7000, important: true });
  }
}

function applyBoot(raw) {
  if (!raw) return;
  try {
    const evt = typeof raw === 'string' ? JSON.parse(raw) : raw;
    engine.handle(evt);
  } catch { /* 무시 */ }
}

// ---- 창 ---------------------------------------------------------------------
function sizes(scale = cfg.scale) {
  const petW = Math.round(petBox.w * scale);
  const petH = Math.round(petBox.h * scale);
  return { petW, petH, width: Math.max(petW + 16, MIN_WIDTH), height: petH + BUBBLE_SPACE };
}

function defaultPosition(size) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - size.width - 24, y: wa.y + wa.height - size.height - 8 };
}

/** 펫(창 아래쪽 가운데)이 어느 화면 안에 보이도록 위치 보정 */
function clampPosition(pos, size) {
  const petCenter = { x: Math.round(pos.x + size.width / 2), y: Math.round(pos.y + size.height - size.petH / 2) };
  const display = screen.getDisplayNearestPoint(petCenter);
  const wa = display.workArea;
  const half = size.petW / 2;
  let x = pos.x;
  let y = pos.y;
  const minX = wa.x - size.width / 2 + half * 0.6;
  const maxX = wa.x + wa.width - size.width / 2 - half * 0.6;
  x = Math.min(Math.max(x, minX), maxX);
  y = Math.min(Math.max(y, wa.y - BUBBLE_SPACE), wa.y + wa.height - size.height);
  return { x: Math.round(x), y: Math.round(y) };
}

function createWindow() {
  const size = sizes();
  const saved = readJson(paths.state, {}) || {};
  let pos = Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : defaultPosition(size);
  pos = clampPosition(pos, size);

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // 펫을 클릭해도 터미널 입력 포커스를 뺏지 않음
    title: 'ClaudePet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* 일부 OS 미지원 */ }
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  let saveTimer = null;
  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 400);
  });
  win.on('closed', () => { win = null; });
  screen.on('display-removed', () => win && win.setPosition(...Object.values(clampPosition(winPos(), sizes()))));
}

function winPos() {
  const [x, y] = win.getPosition();
  return { x, y };
}

function savePosition() {
  if (!win) return;
  const { x, y } = winPos();
  const state = readJson(paths.state, {}) || {};
  try { writeJsonAtomic(paths.state, { ...state, x, y }); } catch { /* 무시 */ }
}

function send(channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (!rendererReady) {
    pending.push([channel, payload]);
    return;
  }
  win.webContents.send(channel, payload);
}

function setScale(scale) {
  const before = sizes(cfg.scale);
  cfg = updateConfig({ scale });
  const after = sizes(cfg.scale);
  if (win) {
    const { x, y } = winPos();
    // 펫 발 위치(창 아래 가운데)를 고정한 채로 크기 변경
    const nx = Math.round(x + before.width / 2 - after.width / 2);
    const ny = Math.round(y + before.height - after.height);
    win.setBounds({ ...clampPosition({ x: nx, y: ny }, after), width: after.width, height: after.height });
  }
  send('pet:scale', { scale: cfg.scale, ...after });
}

// ---- 펫 ---------------------------------------------------------------------
function loadPet(next) {
  if (!next) {
    log('펫을 찾지 못했습니다');
    send('pet:bubble', { text: cfg.language === 'en' ? 'No pet found' : '펫을 찾지 못했어요', ms: 6000, important: true });
    return null;
  }
  const before = sizes();
  let payload;
  try {
    if (next.kind === 'custom') {
      const animations = loadCustomAnimations(next);
      const d = animations.default;
      // 자유 크기 애니메이션은 Codex 셀(192x208) 안에 비율을 지켜 맞춘다
      const f = Math.min(CELL_W / d.frameWidth, CELL_H / d.frameHeight);
      petBox = { w: Math.max(8, Math.round(d.frameWidth * f)), h: Math.max(8, Math.round(d.frameHeight * f)) };
      payload = { kind: 'custom', animations };
    } else {
      petBox = { w: CELL_W, h: CELL_H };
      payload = { kind: 'codex', dataUrl: loadSpriteDataUrl(next), declaredVersion: next.declaredVersion };
    }
  } catch (e) {
    log('펫 이미지 읽기 실패', next.id, e.message);
    send('pet:bubble', { text: cfg.language === 'en' ? 'Could not read the pet image' : '펫 이미지를 읽지 못했어요', ms: 5000, important: true });
    return null;
  }
  pet = next;
  atlasVersion = next.kind === 'codex' ? (next.declaredVersion || 1) : 1;
  resizeKeepingFeet(before);
  send('pet:load', {
    id: next.id,
    displayName: next.displayName,
    ...payload,
    anims: resolveAnimations(cfg.animationDurations),
    scale: cfg.scale,
    ...sizes(),
  });
  send('pet:display', engine.display());
  if (tray) tray.setToolTip(`ClaudePet · ${next.displayName}`);
  updateLookTimer();
  return next;
}

/** 펫 크기가 바뀌어도 발 위치(창 아래 가운데)는 그대로 */
function resizeKeepingFeet(before) {
  if (!win) return;
  const after = sizes();
  if (after.width === before.width && after.height === before.height) return;
  const { x, y } = winPos();
  const nx = Math.round(x + before.width / 2 - after.width / 2);
  const ny = Math.round(y + before.height - after.height);
  win.setBounds({ ...clampPosition({ x: nx, y: ny }, after), width: after.width, height: after.height });
}

async function runImport(opts) {
  const r = await importAnimation(opts);
  cfg = updateConfig({ petId: r.id });
  const found = findPet(r.id, cfg);
  loadPet(found);
  engine.oneshot('waving');
  const ko = cfg.language !== 'en';
  send('pet:bubble', {
    text: r.state === 'default' ? (ko ? `${r.displayName} 등장!` : `${r.displayName} is here!`) : (ko ? `${r.state} 동작 추가!` : `Added ${r.state}!`),
    ms: 4000, important: true,
  });
  return r;
}

async function pickAndImport(extra = {}) {
  const res = await dialog.showOpenDialog({
    title: cfg.language === 'en' ? 'Choose a pet zip or an image' : '펫 zip 또는 이미지(GIF) 고르기',
    properties: ['openFile'],
    filters: extra.state
      ? [{ name: 'Images', extensions: ['gif', 'png', 'apng', 'webp', 'jpg', 'jpeg'] }]
      : [{ name: 'Pet / Images', extensions: ['zip', 'gif', 'png', 'apng', 'webp', 'jpg', 'jpeg'] }],
  });
  if (res.canceled || !res.filePaths.length) return;
  const file = res.filePaths[0];
  try {
    if (/\.zip$/i.test(file)) await installPet(file);
    else await runImport({ file, ...extra });
  } catch (e) {
    send('pet:bubble', { text: e.message, ms: 6000, important: true });
  }
}

/** 갤러리 링크·id·설치 명령, 또는 내려받은 zip/폴더 경로 → 설치하고 바로 적용 */
async function installPet(ref) {
  const ko = cfg.language !== 'en';
  const text = String(ref || '').trim().replace(/^["']|["']$/g, '');
  let r;
  if (text && path.isAbsolute(text) && fs.existsSync(text)) {
    r = gallery.installFromLocal(text, { petsDir: paths.claudePets });
  } else {
    send('pet:bubble', { text: ko ? '펫 데려오는 중…' : 'Fetching pet…', ms: 8000, important: true });
    r = await gallery.installFromGallery(text, { fetchImpl: (url, opts) => net.fetch(url, opts), petsDir: paths.claudePets });
  }
  const found = findPet(r.folderId, cfg) || findPet(r.id, cfg);
  if (!found) throw new Error(ko ? '설치했지만 펫을 읽지 못했어요' : 'Installed but could not load the pet');
  cfg = updateConfig({ petId: found.id });
  loadPet(found);
  engine.oneshot('waving');
  send('pet:bubble', { text: ko ? `${found.displayName} 왔어요!` : `${found.displayName} is here!`, ms: 4500, important: true });
  return { id: found.id, displayName: found.displayName, folder: r.folder };
}

// ---- 링크·이름으로 펫 받기 창 ----------------------------------------------------
let promptWin = null;

function openInstallPrompt() {
  if (promptWin && !promptWin.isDestroyed()) {
    promptWin.show();
    promptWin.focus();
    return;
  }
  promptWin = new BrowserWindow({
    width: 560,
    height: 150,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    title: cfg.language === 'en' ? 'Install a pet' : '펫 받기',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'prompt', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  promptWin.setMenu(null);
  promptWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  promptWin.webContents.on('will-navigate', (e) => e.preventDefault());
  promptWin.loadFile(path.join(__dirname, 'prompt', 'index.html'));
  promptWin.once('ready-to-show', () => { promptWin.show(); promptWin.focus(); });
  promptWin.on('closed', () => { promptWin = null; });
}

ipcMain.handle('prompt:initial', () => {
  // 클립보드에 펫 주소·설치 명령이 있으면 미리 채워 줌
  try {
    const text = clipboard.readText().trim();
    if (text && text.length <= 2000 && gallery.parsePetRef(text) && /codex-pets\.net|\badd\s/i.test(text)) return text;
  } catch { /* 무시 */ }
  return '';
});
ipcMain.handle('prompt:submit', async (_e, text) => {
  try {
    const r = await installPet(String(text || '').slice(0, 2000));
    return { ok: true, displayName: r.displayName, id: r.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.on('prompt:close', () => { if (promptWin && !promptWin.isDestroyed()) promptWin.close(); });

function clipboardPetRef() {
  try {
    const text = clipboard.readText().trim();
    if (!text || text.length > 2000) return null;
    const ref = gallery.parsePetRef(text);
    // 그냥 단어만 복사된 경우는 오해 소지가 있어서 링크/설치 명령일 때만
    return ref && ref.id && /codex-pets\.net|\badd\s/i.test(text) ? ref : null;
  } catch {
    return null;
  }
}

function updateLookTimer() {
  const want = atlasVersion === 2 && cfg.lookAtCursor && win;
  if (want && !lookTimer) {
    lookTimer = setInterval(() => {
      if (!win || dragState) return;
      const b = win.getBounds();
      const s = sizes();
      const c = screen.getCursorScreenPoint();
      const cell = lookCell(c.x - (b.x + b.width / 2), c.y - (b.y + b.height - s.petH / 2), {
        radius: cfg.lookRadius, deadzone: cfg.lookDeadzone,
      });
      const key = cell ? `${cell.row}:${cell.col}` : '';
      if (key !== lastLookKey) {
        lastLookKey = key;
        send('pet:look', cell);
      }
    }, 80);
  } else if (!want && lookTimer) {
    clearInterval(lookTimer);
    lookTimer = null;
    lastLookKey = '';
    send('pet:look', null);
  }
}

// ---- 제어 (cli.js / 메뉴) -------------------------------------------------------
async function control({ cmd, ...args }) {
  switch (cmd) {
    case 'status':
      return { pet: pet && { id: pet.id, displayName: pet.displayName, source: pet.source, version: atlasVersion }, display: engine.display(), statusText: engine.statusText(), scale: cfg.scale };
    case 'use': {
      const found = findPet(args.id, cfg);
      if (!found) return { error: 'not-found' };
      cfg = updateConfig({ petId: found.id });
      loadPet(found);
      engine.oneshot('waving');
      return { pet: { id: found.id, displayName: found.displayName, source: found.source } };
    }
    case 'size':
      setScale(Number(args.scale));
      return { scale: cfg.scale };
    case 'test': {
      const names = args.anim && ANIMATION_NAMES.includes(args.anim) ? [args.anim] : ANIMATION_NAMES;
      send('pet:sequence', names);
      return { played: names };
    }
    case 'install': {
      const r = await installPet(args.ref);
      return { installed: r };
    }
    case 'open-install':
      openInstallPrompt();
      return {};
    case 'desktop':
      if (args.on === true || args.on === false) linkDesktop(args.on);
      return { state: desktop.desktopState(), files: desktop.configFiles() };
    case 'chat-alerts':
      setupChatAlerts().catch((e) => log('chat alerts', e.message));
      return { zip: path.join(paths.userDir, 'pet-chat-alerts.zip') };
    case 'search':
      return await gallery.searchGallery(args.q, { fetchImpl: (url, opts) => net.fetch(url, opts) });
    case 'import': {
      const r = await runImport(args);
      return { imported: r };
    }
    case 'say':
      send('pet:bubble', { text: String(args.text || '').slice(0, 80), ms: 5000, important: true });
      return {};
    case 'reload':
      cfg = loadConfig();
      engine.configure(cfg);
      loadPet(resolvePet(cfg));
      send('pet:scale', { scale: cfg.scale, ...sizes() });
      return { pet: pet && pet.id };
    case 'show':
      if (win) win.showInactive();
      return {};
    case 'quit':
      setTimeout(() => quit(false), 100);
      return {};
    default:
      return { error: 'unknown-command' };
  }
}

function quit(dismiss) {
  if (quitting) return;
  quitting = true;
  if (dismiss) {
    // 사용자가 직접 끈 경우: 새 Claude Code 세션이 시작될 때까지 자동 실행 안 함
    try { fs.mkdirSync(paths.data, { recursive: true }); fs.writeFileSync(paths.dismissed, String(Date.now())); } catch { /* 무시 */ }
  }
  savePosition();
  try { server && server.close(); } catch { /* 무시 */ }
  if (lookTimer) clearInterval(lookTimer);
  try { tray && tray.destroy(); } catch { /* 무시 */ }
  app.quit();
  // 창 정리가 늦어져도 1.5초 안에는 확실히 끝내서, 바로 다시 띄울 때 충돌하지 않게
  setTimeout(() => app.exit(0), 1500);
}

// ---- 메뉴 / 트레이 -------------------------------------------------------------
function buildMenu() {
  const t = MENU_TEXT[cfg.language] || MENU_TEXT.ko;
  const { pets } = listPets(cfg);
  const sourceTag = { codex: t.codex, claude: t.claude, 'built-in': t.builtin, extra: t.extra };
  const petItems = pets.length
    ? pets.map((p) => ({
      label: `${p.displayName}  · ${sourceTag[p.source] || p.source}`,
      type: 'radio',
      checked: !!pet && p.id === pet.id && p.folder === pet.folder,
      click: () => { cfg = updateConfig({ petId: p.id }); loadPet(p); engine.oneshot('waving'); },
    }))
    : [{ label: t.noPets, enabled: false }];

  const nearest = SIZE_PRESETS.reduce((a, b) => (Math.abs(b.scale - cfg.scale) < Math.abs(a.scale - cfg.scale) ? b : a));
  return Menu.buildFromTemplate([
    { label: `${pet ? pet.displayName : 'ClaudePet'} — ${engine.statusText()}`, enabled: false },
    { type: 'separator' },
    {
      label: t.changePet,
      submenu: [
        ...petItems,
        { type: 'separator' },
        { label: t.openPets, click: () => { fs.mkdirSync(paths.claudePets, { recursive: true }); shell.openPath(paths.claudePets); } },
        { label: t.openCodexPets, enabled: fs.existsSync(paths.codexPets), click: () => shell.openPath(paths.codexPets) },
        { label: t.refresh, click: () => control({ cmd: 'reload' }) },
        { type: 'separator' },
        { label: t.openGallery, click: () => shell.openExternal(gallery.DEFAULT_GALLERY) },
        (() => {
          const ref = clipboardPetRef();
          return ref
            ? { label: `${t.installCopied}: ${ref.id}`, click: () => installPet(ref.gallery + '/pets/' + ref.id).catch((e) => send('pet:bubble', { text: e.message, ms: 6000, important: true })) }
            : null;
        })(),
        { label: t.installByLink, click: () => openInstallPrompt() },
        { label: t.importGif, click: () => pickAndImport() },
        {
          label: t.addState,
          enabled: !!pet && pet.kind === 'custom' && pet.source === 'claude',
          submenu: ['idle', 'running', 'waiting', 'review', 'failed', 'waving', 'jumping', 'running-right'].map((st) => ({
            label: `${st}${pet && pet.kind === 'custom' && pet.animations[st] ? ' ✓' : ''}`,
            click: () => pickAndImport({ id: pet.folderName, state: st }),
          })),
        },
      ].filter(Boolean),
    },
    {
      label: t.size,
      submenu: SIZE_PRESETS.map((p) => ({ label: t[p.key], type: 'radio', checked: p === nearest, click: () => setScale(p.scale) })),
    },
    {
      label: t.bubbles,
      submenu: ['all', 'important', 'off'].map((mode) => ({
        label: t[mode], type: 'radio', checked: cfg.bubbles === mode,
        click: () => { cfg = updateConfig({ bubbles: mode }); engine.configure(cfg); },
      })),
    },
    {
      label: t.look, type: 'checkbox', checked: cfg.lookAtCursor, enabled: atlasVersion === 2,
      click: (item) => { cfg = updateConfig({ lookAtCursor: item.checked }); updateLookTimer(); },
    },
    { label: t.preview, submenu: ANIMATION_NAMES.map((name) => ({ label: name, click: () => send('pet:sequence', [name]) })) },
    { label: t.resetPos, click: () => { if (win) { const s = sizes(); const p = defaultPosition(s); win.setPosition(p.x, p.y); savePosition(); } } },
    { type: 'separator' },
    { label: t.claudeCode, type: 'checkbox', checked: cfg.claudeCode === true, click: (item) => linkClaudeCode(item.checked) },
    {
      label: t.desktopApp, type: 'checkbox', checked: cfg.desktopApp === true, enabled: desktop.desktopDirs().length > 0,
      click: (item) => linkDesktop(item.checked),
    },
    { label: t.autoStart, type: 'checkbox', checked: cfg.autoStart, click: (item) => { cfg = updateConfig({ autoStart: item.checked }); } },
    ...(PACKAGED && process.platform !== 'linux' ? [{
      label: t.loginItem, type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    }] : []),
    { label: t.chatAlerts, click: () => setupChatAlerts().catch((e) => log('chat alerts', e.message)) },
    { label: t.openUserDir, click: () => { ensureUserDir(); shell.openPath(paths.userDir); } },
    { label: t.quitWithSessions, type: 'checkbox', checked: cfg.quitWhenNoSessions, click: (item) => { cfg = updateConfig({ quitWhenNoSessions: item.checked }); } },
    { label: t.openConfig, click: () => shell.openPath(paths.config) },
    { label: t.openLog, click: () => { log('open log'); shell.openPath(paths.log); } },
    { type: 'separator' },
    { label: `${t.about} ${pkg.version}`, enabled: false },
    { label: t.quit, click: () => quit(true) },
  ]);
}

function createTray() {
  try {
    const iconFile = path.join(__dirname, '..', 'assets', process.platform === 'darwin' ? 'tray.png' : 'tray@2x.png');
    let image = nativeImage.createFromPath(iconFile);
    if (process.platform !== 'darwin') image = image.resize({ width: 16, height: 16, quality: 'best' });
    tray = new Tray(image);
    tray.setToolTip('ClaudePet');
    tray.on('click', () => {
      if (!win) return;
      if (win.isVisible()) win.hide();
      else win.showInactive();
    });
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
    if (process.platform === 'linux') tray.setContextMenu(buildMenu());
  } catch (e) {
    log('tray unavailable', e.message);
  }
}

// ---- 렌더러와의 IPC --------------------------------------------------------------
ipcMain.on('renderer:ready', () => {
  rendererReady = true;
  while (pending.length) {
    const [ch, payload] = pending.shift();
    if (win) win.webContents.send(ch, payload);
  }
});
ipcMain.on('mouse:ignore', (_e, ignore) => {
  if (!win || dragState) return;
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('drag:start', () => {
  if (!win) return;
  const c = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragState = { cx: c.x, cy: c.y, x, y };
  win.setIgnoreMouseEvents(false);
});
ipcMain.on('drag:move', () => {
  if (!win || !dragState) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(Math.round(dragState.x + c.x - dragState.cx), Math.round(dragState.y + c.y - dragState.cy));
});
ipcMain.on('drag:end', () => {
  if (!win || !dragState) return;
  dragState = null;
  const p = clampPosition(winPos(), sizes());
  win.setPosition(p.x, p.y);
  savePosition();
});
ipcMain.on('pet:click', () => engine && engine.poke());
ipcMain.on('pet:dblclick', () => engine && send('pet:bubble', { text: engine.statusText(), ms: 3500, important: true }));
ipcMain.on('pet:menu', () => {
  if (!win) return;
  buildMenu().popup({ window: win });
});
ipcMain.on('pet:atlas', (_e, info) => {
  if (info && (info.version === 1 || info.version === 2)) {
    atlasVersion = info.version;
    if (info.mismatch) log(`펫 ${pet && pet.id}: pet.json 버전과 실제 이미지 크기가 달라 이미지 기준(v${info.version})으로 표시`);
    updateLookTimer();
  }
});
