#!/usr/bin/env node
'use strict';
// ClaudePet 명령줄 도구. Claude Code 안에서는 /pet 슬래시 명령이 이것을 실행한다.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { APP_DIR, PACKAGED, paths, loadConfig, updateConfig, ensureConfigFile } = require('./src/core/config');
const { listPets, findPet } = require('./src/core/pets');
const { request, health, launchApp, waitForHealth, electronBinary } = require('./src/core/client');
const { ANIMATION_NAMES } = require('./src/core/atlas');

const SIZES = { 작게: 0.35, small: 0.35, 보통: 0.5, normal: 0.5, 크게: 0.75, large: 0.75, '아주크게': 1, xlarge: 1 };
const SOURCE = { claude: '내 펫(~/.claude/pets)', codex: 'Codex 펫(~/.codex/pets)', 'built-in': '기본 펫', extra: '추가 폴더' };

const HELP = `ClaudePet — Claude Code 데스크톱 펫

사용법: node cli.js <명령> [값]   (Claude Code 안에서는 /pet <명령>)

  start             펫 띄우기
  stop              펫 끄기
  status            상태 보기
  list              쓸 수 있는 펫 목록 (~/.claude/pets, ~/.codex/pets 포함)
  use <펫id>        펫 바꾸기
  install <링크|id|zip>  codex-pets.net 펫 받아서 바로 적용 (페이지 링크·설치 명령 붙여넣기 OK)
  search <검색어>    codex-pets.net 에서 펫 찾기
  size <작게|보통|크게|아주크게|0.2~2>   크기 바꾸기
  bubbles <all|important|off>           말풍선 모드
  test [동작]       동작 미리보기 (${ANIMATION_NAMES.join(', ')})
  import <파일> [--name 이름] [--id 펫id] [--state 상태] [--keep-bg]
                    GIF/APNG/WebP 로 펫 만들기 (--state 를 주면 그 상태 전용 애니메이션 추가)
  say <문장>        펫이 말하게 하기
  chat-alerts       Claude 채팅 답변 알림 설정 도우미 (스킬 zip 준비 + 지침 문구 복사)
  signal <start|done|wait|error> [메시지]   클라우드 작업 신호 흉내 (inbox 폴더 경유)
  autostart <on|off> 세션 시작 시 자동 실행
  doctor            설치 상태 점검
`;

async function control(cfg, body, timeoutMs = 3000) {
  const r = await request(cfg.port, '/control', body, timeoutMs);
  if (r.status !== 200) throw new Error((r.body && r.body.error) || `HTTP ${r.status}`);
  return r.body;
}

async function ensureRunning(cfg) {
  if (await health(cfg.port)) return true;
  const r = launchApp(null, { force: true });
  if (!r.ok) {
    if (r.error === 'electron-missing') {
      console.log(`Electron 이 설치되지 않았어요. 다음을 실행하세요:\n  cd "${APP_DIR}"\n  npm install`);
    } else {
      console.log(`펫을 띄우지 못했어요 (${r.error}). 로그: ${paths.log}`);
    }
    return false;
  }
  const h = await waitForHealth(cfg.port, 25000);
  if (!h) console.log(`펫이 응답하지 않아요. 로그를 확인하세요: ${paths.log}`);
  return !!h;
}

function hooksInstalled() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(paths.claude, 'settings.json'), 'utf8'));
    return Object.values(s.hooks || {}).some((groups) => JSON.stringify(groups).includes('--claude-pet'));
  } catch {
    return false;
  }
}

async function main() {
  ensureConfigFile();
  let cfg = loadConfig();
  const [cmdRaw, ...rest] = process.argv.slice(2);
  const cmd = (cmdRaw || 'start').toLowerCase();
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case 'help': case '-h': case '--help':
      console.log(HELP);
      return;

    case 'start': case 'show': case 'on': {
      const was = await health(cfg.port);
      if (!(await ensureRunning(cfg))) return;
      if (was) await control(cfg, { cmd: 'reload' }).catch(() => {}); // 설정 파일 변경 반영
      await control(cfg, { cmd: 'show' }).catch(() => {});
      const st = await control(cfg, { cmd: 'status' });
      console.log(`${was ? '이미 떠 있어요' : '펫을 띄웠어요'}: ${st.pet ? st.pet.displayName : '?'} (${st.statusText})`);
      return;
    }

    case 'stop': case 'off': case 'quit': {
      if (!(await health(cfg.port))) { console.log('펫이 이미 꺼져 있어요.'); return; }
      await control(cfg, { cmd: 'quit' });
      console.log('펫을 껐어요. 다음 Claude Code 세션이 시작되면 다시 나타나요.');
      return;
    }

    case 'status': {
      const h = await health(cfg.port);
      if (!h) { console.log(`꺼져 있음 · 설정된 펫: ${cfg.petId} · 훅 ${hooksInstalled() ? '설치됨' : '미설치'}`); return; }
      const st = await control(cfg, { cmd: 'status' });
      console.log(`켜져 있음 · ${st.pet.displayName} (${st.pet.id}, v${st.pet.version}) · 크기 ${st.scale} · 지금: ${st.display.status} · ${st.statusText}`);
      return;
    }

    case 'list': case 'ls': {
      const { pets, problems } = listPets(cfg);
      if (!pets.length) console.log('펫이 없어요.');
      for (const p of pets) {
        const mark = p.id.toLowerCase() === cfg.petId.toLowerCase() ? '●' : '○';
        console.log(`${mark} ${p.id.padEnd(20)} ${p.displayName}  — ${SOURCE[p.source] || p.source}${p.kind === 'custom' ? ` · GIF 펫 (동작 ${Object.keys(p.animations).filter((k) => k !== 'default').join(', ') || '기본만'})` : ''}`);
      }
      for (const p of problems) console.log(`  ⚠ ${path.basename(p.folder)}: ${p.error}`);
      console.log(`\n새 펫 추가: Codex 펫 폴더(pet.json + spritesheet.webp)를 ${paths.claudePets} 에 넣거나, /pet install <codex-pets.net 링크> 로 받거나, /pet import <GIF 경로> 로 만드세요.`);
      return;
    }

    case 'use': case 'set': case 'switch': {
      if (!arg) { console.log('펫 id 를 적어주세요. 예: /pet use mochi'); return; }
      const p = findPet(arg, cfg);
      if (!p) { console.log(`'${arg}' 펫이 내 컴퓨터에 없어요. /pet list 로 목록을 보거나, 갤러리에서 받으려면 /pet install ${arg}`); return; }
      cfg = updateConfig({ petId: p.id });
      if (await health(cfg.port)) await control(cfg, { cmd: 'use', id: p.id });
      console.log(`펫을 ${p.displayName}(으)로 바꿨어요.`);
      return;
    }

    case 'install': case 'add': case 'get': case 'download': {
      if (!arg) {
        // 인자 없이 부르면 펫 받기 창을 띄움
        if (!(await ensureRunning(cfg))) return;
        await control(cfg, { cmd: 'open-install' });
        console.log('펫 받기 창을 열었어요. codex-pets.net 주소나 설치 명령을 붙여넣으세요.');
        return;
      }
      const raw = arg.replace(/^["']|["']$/g, '');
      // 내려받은 zip 이나 펫 폴더 경로면 절대경로로
      const local = !/^https?:/i.test(raw) && /[\\/.]/.test(raw) && fs.existsSync(path.resolve(raw)) ? path.resolve(raw) : null;
      if (!(await ensureRunning(cfg))) return;
      const r = await control(cfg, { cmd: 'install', ref: local || raw }, 60000);
      console.log(`'${r.installed.displayName}' 펫을 받아서 바로 바꿨어요. (${r.installed.id})\n저장 위치: ${r.installed.folder}`);
      return;
    }

    case 'search': case 'find': {
      if (!(await ensureRunning(cfg))) return;
      const r = await control(cfg, { cmd: 'search', q: arg }, 20000);
      if (!r.pets.length) { console.log(`'${arg}' 검색 결과가 없어요.`); return; }
      console.log(`codex-pets.net 검색 결과 ${r.total}개${r.total > r.pets.length ? ` 중 ${r.pets.length}개` : ''}:`);
      for (const p of r.pets) console.log(`  ${p.id.padEnd(32)} ${p.displayName}${p.version === 2 ? ' · v2' : ''}`);
      console.log('\n받으려면: /pet install <id>');
      return;
    }

    case 'size': case 'scale': {
      const key = arg.replace(/\s+/g, '').toLowerCase();
      const scale = SIZES[key] != null ? SIZES[key] : Number(key);
      if (!Number.isFinite(scale) || scale < 0.2 || scale > 2) { console.log('크기는 작게/보통/크게/아주크게 또는 0.2~2 숫자로 적어주세요.'); return; }
      cfg = updateConfig({ scale });
      if (await health(cfg.port)) await control(cfg, { cmd: 'size', scale });
      console.log(`크기를 ${scale} 배로 바꿨어요.`);
      return;
    }

    case 'bubbles': case 'bubble': {
      const map = { all: 'all', 모두: 'all', important: 'important', 중요: 'important', off: 'off', 끄기: 'off' };
      const mode = map[arg.toLowerCase()];
      if (!mode) { console.log('all / important / off 중에서 골라주세요.'); return; }
      cfg = updateConfig({ bubbles: mode });
      if (await health(cfg.port)) await control(cfg, { cmd: 'reload' });
      console.log(`말풍선: ${mode}`);
      return;
    }

    case 'test': case 'preview': {
      if (arg && !ANIMATION_NAMES.includes(arg)) { console.log(`동작 이름: ${ANIMATION_NAMES.join(', ')}`); return; }
      if (!(await ensureRunning(cfg))) return;
      const r = await control(cfg, { cmd: 'test', anim: arg || undefined });
      console.log(`미리보기: ${r.played.join(' → ')}`);
      return;
    }

    case 'import': case 'gif': {
      const opts = { removeBg: 'auto' };
      const words = [];
      for (let i = 0; i < rest.length; i += 1) {
        const w = rest[i];
        if (w === '--name' || w === '--id' || w === '--state') opts[w.slice(2)] = rest[++i];
        else if (w === '--keep-bg') opts.removeBg = 'off';
        else if (w === '--remove-bg') opts.removeBg = 'on';
        else words.push(w);
      }
      const file = words.join(' ').replace(/^["']|["']$/g, '');
      if (!file) { console.log('가져올 이미지 경로를 적어주세요. 예: /pet import C:/Users/me/Downloads/pet.gif --name 내펫'); return; }
      const abs = path.resolve(file);
      if (!fs.existsSync(abs)) { console.log(`파일이 없어요: ${abs}`); return; }
      if (opts.state && !opts.id) opts.id = cfg.petId; // 상태 추가는 기본적으로 지금 펫에
      if (!(await ensureRunning(cfg))) return;
      const r = await control(cfg, { cmd: 'import', file: abs, ...opts }, 45000);
      const im = r.imported;
      console.log(im.state === 'default'
        ? `펫 '${im.displayName}'(${im.id}) 을 만들고 바꿨어요 · 프레임 ${im.frames}개 · ${im.size.join('x')}${im.removedBackground ? ' · 배경 제거함' : ''}\n저장 위치: ${im.folder}`
        : `'${im.id}' 펫에 ${im.state} 동작을 추가했어요 · 프레임 ${im.frames}개`);
      return;
    }

    case 'signal': {
      const { writeSignal, INBOX_DIR } = require('./src/core/inbox');
      const map = { start: 'UserPromptSubmit', done: 'Stop', wait: 'PermissionRequest', error: 'StopFailure', end: 'SessionEnd' };
      const [kind, ...msg] = rest;
      const event = map[(kind || 'done').toLowerCase()] || kind;
      const f = writeSignal({ event, ...(msg.length ? { message: msg.join(' ').slice(0, 80) } : {}), ...(event === 'UserPromptSubmit' ? { stale_ms: 3600000 } : {}) });
      console.log(`신호를 남겼어요: ${event} → ${path.relative(INBOX_DIR, f)} (펫이 켜져 있으면 바로 반응해요)`);
      return;
    }

    case 'chat-alerts': case 'chat': {
      if (!(await ensureRunning(cfg))) return;
      const r = await control(cfg, { cmd: 'chat-alerts' });
      console.log(`설정 안내 창을 열었어요. 스킬 파일: ${r.zip} · 지침 문구는 클립보드에 복사했어요.`);
      return;
    }

    case 'say': {
      if (!(await ensureRunning(cfg))) return;
      await control(cfg, { cmd: 'say', text: arg || '안녕!' });
      console.log('말했어요.');
      return;
    }

    case 'autostart': {
      const on = !/^(off|false|0|끄기)$/i.test(arg);
      cfg = updateConfig({ autoStart: on });
      console.log(`세션 시작 시 자동 실행: ${on ? '켬' : '끔'}`);
      return;
    }

    case 'doctor': {
      const lines = [];
      const nodeMajor = Number(process.versions.node.split('.')[0]);
      lines.push(`${nodeMajor >= 18 ? '✓' : '✗'} Node.js ${process.versions.node}`);
      let bin = electronBinary();
      if (!bin && fs.existsSync(path.join(APP_DIR, 'node_modules', 'electron', 'install.js'))) {
        // electron 패키지는 있는데 실행 파일 다운로드가 빠진 경우 복구 시도
        spawnSync(process.execPath, [path.join(APP_DIR, 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' });
        bin = electronBinary();
      }
      lines.push(`${bin ? '✓' : '✗'} 실행 파일 ${bin ? (PACKAGED ? `설치판 ${require('./package.json').version}` : 'Electron 설치됨') : '없음 → 앱 폴더에서 npm install'}`);
      lines.push(`  클라우드 신호 폴더: ${paths.inbox}`);
      lines.push(`${hooksInstalled() ? '✓' : '✗'} Claude Code 훅 ${hooksInstalled() ? '설치됨' : (PACKAGED ? '없음 → 펫 우클릭 → Claude Code 와 연결' : '없음 → npm run setup')}`);
      const cmdFile = path.join(paths.claude, 'commands', 'pet.md');
      lines.push(`${fs.existsSync(cmdFile) ? '✓' : '·'} /pet 명령 ${fs.existsSync(cmdFile) ? '설치됨' : '없음'}`);
      const { pets, problems } = listPets(cfg);
      lines.push(`${pets.length ? '✓' : '✗'} 펫 ${pets.length}개 (${pets.map((p) => p.id).join(', ')})${problems.length ? ` · 문제 ${problems.length}개` : ''}`);
      const h = await health(cfg.port);
      lines.push(`${h ? '✓' : '·'} 펫 앱 ${h ? `실행 중 (pid ${h.pid}, 포트 ${cfg.port})` : `꺼져 있음 (포트 ${cfg.port})`}`);
      lines.push(`  설정: ${paths.config}`);
      lines.push(`  로그: ${paths.log}`);
      console.log(lines.join('\n'));
      return;
    }

    default:
      console.log(`알 수 없는 명령: ${cmd}\n`);
      console.log(HELP);
  }
}

main().catch((e) => {
  console.log(`오류: ${e.message}`);
  process.exitCode = 1;
});
