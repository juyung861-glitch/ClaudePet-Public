'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..', '..');
const APP_NAME = 'claude-pet';

// 설치 프로그램으로 깔린 경우: <설치 폴더>/resources/app 안에서 실행됨
const PACKAGED = path.basename(APP_DIR) === 'app' && path.basename(path.dirname(APP_DIR)) === 'resources';
/** 설치 폴더 (ClaudePet.exe 가 있는 곳). 개발 모드면 null */
const INSTALL_DIR = PACKAGED ? path.dirname(path.dirname(APP_DIR)) : null;

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), '.claude');
}

function dataDir() {
  return process.env.CLAUDE_PET_HOME
    ? path.resolve(process.env.CLAUDE_PET_HOME)
    : path.join(claudeDir(), 'claude-pet');
}

const paths = {
  get app() { return APP_DIR; },
  get claude() { return claudeDir(); },
  get data() { return dataDir(); },
  get config() { return path.join(dataDir(), 'config.json'); },
  get state() { return path.join(dataDir(), 'state.json'); },
  get log() { return path.join(dataDir(), 'claude-pet.log'); },
  get dismissed() { return path.join(dataDir(), 'dismissed'); },
  /** 사용자가 보는 폴더: 클라우드 Claude 가 연결해서 신호를 남길 수 있는 곳 (~/ClaudePet) */
  get userDir() {
    return process.env.CLAUDE_PET_USER_DIR ? path.resolve(process.env.CLAUDE_PET_USER_DIR) : path.join(os.homedir(), 'ClaudePet');
  },
  get inbox() { return path.join(this.userDir, 'inbox'); },
  get builtinPets() { return path.join(APP_DIR, 'pets'); },
  get claudePets() { return path.join(claudeDir(), 'pets'); },
  get codexPets() {
    const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
    return path.join(codexHome, 'pets');
  },
};

const DEFAULTS = Object.freeze({
  petId: 'mochi',            // 사용할 펫 id (pets/, ~/.claude/pets, ~/.codex/pets 에서 찾음)
  scale: 0.5,                // 192x208 셀 기준 배율
  port: 47321,               // 훅 -> 펫 통신용 로컬 포트 (127.0.0.1 전용)
  language: 'ko',            // 말풍선 언어: ko | en
  bubbles: 'all',            // all | important | off
  autoStart: true,           // Claude Code 세션이 시작되면 펫 자동 실행
  quitWhenNoSessions: false, // 마지막 세션이 끝나면 펫도 종료
  lookAtCursor: true,        // v2 펫: 쉬는 중에 마우스 쪽을 바라봄
  lookRadius: 600,
  lookDeadzone: 48,
  runningTimeoutSec: 300,    // 이벤트가 끊긴 채 이 시간이 지나면 '작업 중' -> 쉬기 (Esc 중단 대비)
  waitingTimeoutSec: 1800,
  extraPetDirs: [],          // 추가로 펫을 찾을 폴더
  animationDurations: {},    // { "idle": [ms,...] } 프레임 시간 덮어쓰기
});

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function sanitize(cfg) {
  const c = { ...DEFAULTS, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  c.scale = Math.min(2, Math.max(0.2, Number(c.scale) || DEFAULTS.scale));
  c.port = Number.isInteger(Number(c.port)) && c.port > 1024 && c.port < 65536 ? Number(c.port) : DEFAULTS.port;
  if (process.env.CLAUDE_PET_PORT) {
    const p = Number(process.env.CLAUDE_PET_PORT);
    if (Number.isInteger(p) && p > 1024 && p < 65536) c.port = p;
  }
  if (!['ko', 'en'].includes(c.language)) c.language = DEFAULTS.language;
  if (!['all', 'important', 'off'].includes(c.bubbles)) c.bubbles = DEFAULTS.bubbles;
  c.petId = typeof c.petId === 'string' && c.petId.trim() ? c.petId.trim() : DEFAULTS.petId;
  if (process.env.CLAUDE_PET_ID) c.petId = process.env.CLAUDE_PET_ID;
  for (const k of ['autoStart', 'lookAtCursor']) c[k] = c[k] !== false && c[k] !== 'false';
  c.quitWhenNoSessions = c.quitWhenNoSessions === true || c.quitWhenNoSessions === 'true';
  for (const k of ['lookRadius', 'lookDeadzone', 'runningTimeoutSec', 'waitingTimeoutSec']) {
    const n = Number(c[k]);
    c[k] = Number.isFinite(n) && n >= 0 ? n : DEFAULTS[k];
  }
  if (!Array.isArray(c.extraPetDirs)) c.extraPetDirs = [];
  for (const k of ['claudeCode', 'desktopApp']) c[k] = c[k] === true ? true : (c[k] === false ? false : null); // null = 아직 안 물어봄
  if (!c.animationDurations || typeof c.animationDurations !== 'object') c.animationDurations = {};
  return c;
}

function loadConfig() {
  return sanitize(readJson(paths.config, {}));
}

/** 파일에 있는 값만 바꿔 저장 (기본값까지 파일에 다 쓰지 않음) */
function updateConfig(patch) {
  const current = readJson(paths.config, {}) || {};
  const next = { ...current, ...patch };
  writeJsonAtomic(paths.config, next);
  return sanitize(next);
}

function ensureConfigFile() {
  if (!fs.existsSync(paths.config)) {
    writeJsonAtomic(paths.config, { petId: DEFAULTS.petId, scale: DEFAULTS.scale, bubbles: DEFAULTS.bubbles, language: DEFAULTS.language });
  }
}

function log(...args) {
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    const file = paths.log;
    try {
      if (fs.statSync(file).size > 1024 * 1024) {
        const buf = fs.readFileSync(file);
        fs.writeFileSync(file, buf.subarray(buf.length - 256 * 1024));
      }
    } catch { /* 첫 기록 */ }
    const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    fs.appendFileSync(file, line);
  } catch { /* 로그 실패는 무시 */ }
}

module.exports = { APP_DIR, APP_NAME, PACKAGED, INSTALL_DIR, DEFAULTS, paths, readJson, writeJsonAtomic, loadConfig, updateConfig, ensureConfigFile, sanitize, log };
