#!/usr/bin/env node
'use strict';
// Claude Code 훅 진입점. settings.json 에 `node "<이 파일>" --claude-pet` 로 등록된다.
// 규칙: 표준출력에 아무것도 쓰지 않는다(SessionStart/UserPromptSubmit 은 출력이 Claude 컨텍스트에 들어감),
//       항상 exit 0, 1초 안에 끝낸다. 프롬프트·명령어·파일 내용은 펫으로 보내지 않는다.

const fs = require('fs');

const hardStop = setTimeout(() => process.exit(0), 2500);
hardStop.unref();

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    let size = 0;
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    process.stdin.on('data', (c) => {
      size += c.length;
      if (size <= 4 * 1024 * 1024) chunks.push(c);
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    setTimeout(done, 1000).unref();
  });
}

function pickEvent(input) {
  const keep = (v, max = 120) => (typeof v === 'string' && v.length <= max ? v : undefined);
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const evt = {
    event: keep(input.hook_event_name, 40),
    session_id: keep(input.session_id),
    tool_name: keep(input.tool_name),
    notification_type: keep(input.notification_type, 60),
    source: keep(input.source, 30),
    reason: keep(input.reason, 60),
    error_type: keep(input.error_type, 60) || keep(input.error, 60),
    agent_type: keep(input.agent_type, 80),
    ts: Date.now(),
  };
  // Bash 의 timeout 값만 사용 (명령어 자체는 보내지 않음)
  if (Number.isFinite(toolInput.timeout)) evt.tool_timeout_ms = toolInput.timeout;
  if (toolInput.run_in_background === true) evt.run_in_background = true;
  for (const k of Object.keys(evt)) if (evt[k] === undefined) delete evt[k];
  return evt;
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (!input || typeof input !== 'object' || !input.hook_event_name) return;

  const { loadConfig, paths, log } = require('./src/core/config');
  const { request, launchApp } = require('./src/core/client');
  const cfg = loadConfig();
  const evt = pickEvent(input);

  try {
    const r = await request(cfg.port, '/event', evt, 700);
    if (r.status === 200) return;
  } catch { /* 펫이 안 떠 있음 */ }

  // 펫이 꺼져 있을 때: 세션 시작/프롬프트 제출 시에만 자동 실행
  if (!cfg.autoStart) return;
  if (evt.event === 'SessionStart' && (evt.source === 'startup' || !evt.source)) {
    try { fs.rmSync(paths.dismissed, { force: true }); } catch { /* 무시 */ }
  } else if (evt.event === 'UserPromptSubmit' || evt.event === 'SessionStart') {
    if (fs.existsSync(paths.dismissed)) return; // 사용자가 직접 끈 뒤엔 새 세션 전까지 조용히
  } else {
    return;
  }
  if (process.env.CLAUDE_CODE_REMOTE === 'true') return; // 클라우드 세션엔 화면이 없음
  const r = launchApp(evt);
  if (!r.ok && r.error !== 'launch-in-progress') log('hook: launch failed', r.error);
}

main()
  .catch(() => { /* 훅 오류로 Claude Code 를 방해하지 않음 */ })
  .finally(() => process.exit(0));
