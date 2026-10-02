#!/usr/bin/env node
'use strict';
// Claude Code 에 ClaudePet 훅과 /pet 명령을 등록한다. (기존 설정은 백업 후 병합)
//   node scripts/install.js            설치
//   node scripts/install.js --dry-run  바뀔 내용만 출력
const fs = require('fs');
const path = require('path');
const { APP_DIR, PACKAGED, paths, ensureConfigFile, loadConfig } = require('../src/core/config');

const MARKER = '--claude-pet';
const CMD_MARKER = '<!-- claude-pet -->';
const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionEnd',
];

const slash = (p) => p.replace(/\\/g, '/');

/** 실행 파일 경로를 명령 첫 단어로: 공백이 없으면 따옴표 없이 써서 Git Bash·PowerShell 어디서든 실행되게 */
function exe(p) {
  const s = slash(p);
  return /\s/.test(s) ? `"${s}"` : s;
}

/**
 * 스크립트(hook.js / cli.js)를 실행하는 명령.
 *  - 설치판(Windows): 설치 폴더의 .cmd 런처 → ClaudePet.exe 를 Node 처럼 실행 (Node 설치 불필요)
 *  - 설치판(macOS/Linux): ELECTRON_RUN_AS_NODE=1 <실행 파일> <스크립트>
 *  - 소스판: node <스크립트>
 */
/**
 * Windows: 경로에 공백이 있으면(예: C:\\Users\\홍 길동\\...) 8.3 짧은 경로로 바꿔 따옴표 없이 쓸 수 있게 한다.
 * 따옴표로 시작하는 명령은 PowerShell 에서 실행되지 않기 때문. 짧은 경로를 못 얻으면 원래 경로 그대로.
 */
function shortPath(p) {
  if (process.platform !== 'win32' || !/\s/.test(p)) return p;
  try {
    const out = require('child_process').execSync(`for %I in ("${p}") do @echo %~sI`, {
      shell: 'cmd.exe', encoding: 'utf8', windowsHide: true, timeout: 5000,
    }).trim().split(/\r?\n/).pop();
    return out && !/\s/.test(out) && fs.existsSync(out) ? out : p;
  } catch {
    return p;
  }
}

function launcher(script) {
  if (PACKAGED && process.versions.electron) {
    if (process.platform === 'win32') {
      const shim = script === 'hook.js' ? 'claude-pet-hook.cmd' : 'claude-pet.cmd';
      return exe(shortPath(path.join(path.dirname(process.execPath), shim)));
    }
    return `ELECTRON_RUN_AS_NODE=1 ${exe(process.execPath)} "${slash(path.join(APP_DIR, script))}"`;
  }
  return `node "${slash(path.join(APP_DIR, script))}"`;
}

function hookCommand() {
  return `${launcher('hook.js')} ${MARKER}`;
}

/** settings.json 에 우리 훅이 있는지: 'none' | 'current' | 'outdated'(경로가 바뀐 경우) */
function hookState() {
  let settings;
  try {
    settings = readSettings(path.join(paths.claude, 'settings.json'));
  } catch {
    return 'none';
  }
  const handlers = Object.values(settings.hooks || {}).flat().flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []));
  const ours = handlers.filter(isOurs);
  if (!ours.length) return 'none';
  const want = hookCommand();
  return ours.length === EVENTS.length && ours.every((h) => h.command === want) ? 'current' : 'outdated';
}

function isOurs(handler) {
  return handler && typeof handler.command === 'string' && handler.command.includes(MARKER);
}

/** settings.hooks 에서 우리 항목을 지운다 (다른 훅은 그대로) */
function stripHooks(settings) {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return settings;
  for (const event of Object.keys(hooks)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const handlers = g.hooks.filter((h) => !isOurs(h));
      if (handlers.length) kept.push({ ...g, hooks: handlers });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete settings.hooks;
  return settings;
}

function addHooks(settings) {
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const command = hookCommand();
  for (const event of EVENTS) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const handler = { type: 'command', command, timeout: 10 };
    // 세션 종료 훅은 Claude Code 가 끝나기 전에 보내야 하므로 동기, 나머지는 백그라운드로(작업 속도에 영향 없음)
    if (event === 'SessionEnd') handler.timeout = 2;
    else handler.async = true;
    list.push({ hooks: [handler] });
    settings.hooks[event] = list;
  }
  return settings;
}

function slashCommand() {
  const run = launcher('cli.js');
  return `---
description: 데스크톱 펫(ClaudePet) 켜기·끄기·바꾸기·codex-pets.net에서 받기·GIF로 만들기·크기 조절
argument-hint: "[start | stop | list | use <펫id> | install <codex-pets.net 링크> | search <검색어> | import <GIF경로> | size <작게|보통|크게> | test | doctor]"
allowed-tools: Bash(${run}), Bash(${run} *), PowerShell(${run}), PowerShell(& ${run} *), PowerShell(${run} *)
---
${CMD_MARKER}
아래 명령을 셸 도구(Bash 또는 PowerShell)로 **한 번만** 실행하고, 출력 내용을 한두 문장으로 그대로 전해 주세요. 다른 파일을 읽거나 고치지 마세요.
인자가 비어 있으면 그대로 실행합니다(펫 띄우기). PowerShell 에서 경로에 따옴표가 있으면 앞에 \`&\` 를 붙이세요.

\`\`\`
${run} $ARGUMENTS
\`\`\`
`;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} 이(가) 올바른 JSON 이 아니라서 건드리지 않았어요. 고친 뒤 다시 실행하세요. (${e.message})`);
  }
}

function install({ dryRun = false, withCommand = true } = {}) {
  const settingsFile = path.join(paths.claude, 'settings.json');
  const settings = readSettings(settingsFile);
  const next = addHooks(stripHooks(JSON.parse(JSON.stringify(settings))));
  const commandFile = path.join(paths.claude, 'commands', 'pet.md');

  if (dryRun) {
    console.log(JSON.stringify(next.hooks, null, 2));
    return { settingsFile, commandFile };
  }

  fs.mkdirSync(paths.claude, { recursive: true });
  if (fs.existsSync(settingsFile)) {
    const backup = `${settingsFile}.bak-claude-pet`;
    if (!fs.existsSync(backup)) fs.copyFileSync(settingsFile, backup);
  }
  const tmp = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, settingsFile);

  let commandNote = '건너뜀';
  if (withCommand) {
    fs.mkdirSync(path.dirname(commandFile), { recursive: true });
    if (fs.existsSync(commandFile) && !fs.readFileSync(commandFile, 'utf8').includes(CMD_MARKER)) {
      commandNote = `기존 ${commandFile} 이(가) 있어서 건드리지 않았어요`;
    } else {
      fs.writeFileSync(commandFile, slashCommand(), 'utf8');
      commandNote = commandFile;
    }
  }
  fs.mkdirSync(paths.claudePets, { recursive: true });
  ensureConfigFile();
  return { settingsFile, commandFile, commandNote };
}

/** 우리 훅과 /pet 명령만 지운다 (다른 설정은 그대로). 반환: 바뀐 항목 목록 */
function removeHooks() {
  const out = [];
  const settingsFile = path.join(paths.claude, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    const settings = readSettings(settingsFile);
    const before = JSON.stringify(settings);
    stripHooks(settings);
    if (JSON.stringify(settings) !== before) {
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      out.push(`훅 제거: ${settingsFile}`);
    }
  }
  const commandFile = path.join(paths.claude, 'commands', 'pet.md');
  if (fs.existsSync(commandFile) && fs.readFileSync(commandFile, 'utf8').includes(CMD_MARKER)) {
    fs.rmSync(commandFile);
    out.push(`/pet 명령 제거: ${commandFile}`);
  }
  return out;
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  try {
    const r = install({ dryRun: args.has('--dry-run'), withCommand: !args.has('--no-command') });
    if (!args.has('--dry-run')) {
      const cfg = loadConfig();
      let electronOk = false;
      try { electronOk = typeof require(path.join(APP_DIR, 'node_modules', 'electron')) === 'string'; } catch { /* 없음 */ }
      console.log([
        '✓ ClaudePet 설치 완료',
        `  훅 등록: ${r.settingsFile} (${EVENTS.length}개 이벤트, 기존 설정은 .bak-claude-pet 으로 백업)`,
        `  /pet 명령: ${r.commandNote}`,
        `  내 펫 폴더: ${paths.claudePets}`,
        `  설정 파일: ${paths.config} (포트 ${cfg.port})`,
        '  Claude 데스크톱 앱 채팅 알림을 클릭 없이 쓰려면: npm run pet -- desktop on',
        electronOk ? '' : '\n⚠ Electron 이 아직 없어요. 이 폴더에서 `npm install` 을 먼저 실행하세요.',
        '',
        '이제 Claude Code 를 새로 시작하면 펫이 나타나요. 바로 보려면: npm run pet -- start',
      ].filter((l) => l !== null).join('\n'));
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { install, removeHooks, stripHooks, addHooks, hookCommand, hookState, launcher, slashCommand, readSettings, EVENTS, MARKER, CMD_MARKER };
