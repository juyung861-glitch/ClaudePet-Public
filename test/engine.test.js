'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PetEngine, normalize } = require('../src/core/engine');

function setup(config = {}) {
  let now = 1_000_000;
  const engine = new PetEngine({ config, now: () => now, random: () => 0 });
  const log = { display: [], oneshot: [], bubble: [], empty: 0 };
  engine.on('display', (d) => log.display.push(d));
  engine.on('oneshot', (o) => log.oneshot.push(o.anim));
  engine.on('bubble', (b) => log.bubble.push(b.text));
  engine.on('empty', () => { log.empty += 1; });
  let ts = 1;
  const send = (event, extra = {}) => engine.handle({ event, session_id: 'A', ts: ts++, ...extra });
  return { engine, log, send, advance: (ms) => { now += ms; }, clock: () => now };
}

test('한 턴의 흐름: 시작 → 생각 → 도구 → 완료 → 쉬기', () => {
  const { engine, log, send, advance } = setup();
  send('SessionStart', { source: 'startup' });
  assert.equal(engine.display().anim, 'idle');
  assert.deepEqual(log.oneshot, ['waving']);

  send('UserPromptSubmit');
  assert.equal(engine.display().anim, 'running');
  send('PreToolUse', { tool_name: 'Bash' });
  send('PostToolUse', { tool_name: 'Bash' });
  assert.equal(engine.display().anim, 'running');

  send('Stop');
  assert.equal(engine.display().anim, 'review');
  advance(1000);
  engine.tick();
  assert.equal(engine.display().anim, 'review', '리뷰는 3번 재생 동안 유지');
  advance(10_000);
  engine.tick();
  assert.equal(engine.display().anim, 'idle');
});

test('권한 요청은 waiting, 다음 도구 결과가 오면 다시 running', () => {
  const { engine, send } = setup();
  send('UserPromptSubmit');
  send('Notification', { notification_type: 'permission_prompt' });
  assert.equal(engine.display().anim, 'waiting');
  send('PostToolUse', { tool_name: 'Edit' });
  assert.equal(engine.display().anim, 'running');
});

test('AskUserQuestion / ExitPlanMode 는 입력 대기로 표시', () => {
  const { engine, send } = setup();
  send('PreToolUse', { tool_name: 'AskUserQuestion' });
  assert.equal(engine.display().anim, 'waiting');
  send('PreToolUse', { tool_name: 'ExitPlanMode' });
  assert.equal(engine.display().anim, 'waiting');
});

test('무시해야 하는 알림은 상태를 바꾸지 않음', () => {
  const { engine, send } = setup();
  send('UserPromptSubmit');
  send('Notification', { notification_type: 'auth_success' });
  assert.equal(engine.display().anim, 'running');
});

test('StopFailure → failed 후 일정 시간 뒤 idle', () => {
  const { engine, log, send, advance } = setup();
  send('UserPromptSubmit');
  send('StopFailure', { error_type: 'rate_limit' });
  assert.equal(engine.display().anim, 'failed');
  assert.ok(log.bubble.includes('사용량 한도에 걸렸어요'));
  advance(20_000);
  engine.tick();
  assert.equal(engine.display().anim, 'idle');
});

test('Esc 로 끊겨 Stop 이 안 와도 시간이 지나면 idle', () => {
  const { engine, send, advance } = setup({ runningTimeoutSec: 60 });
  send('UserPromptSubmit');
  advance(59_000); engine.tick();
  assert.equal(engine.display().anim, 'running');
  advance(2_000); engine.tick();
  assert.equal(engine.display().anim, 'idle');
});

test('오래 걸리는 Bash 는 지정된 timeout 동안 running 유지', () => {
  const { engine, send, advance } = setup({ runningTimeoutSec: 60 });
  send('PreToolUse', { tool_name: 'Bash', tool_timeout_ms: 600_000 });
  advance(300_000); engine.tick();
  assert.equal(engine.display().anim, 'running');
  advance(400_000); engine.tick();
  assert.equal(engine.display().anim, 'idle');
});

test('늦게 도착한 이벤트(순서 뒤바뀜)는 무시', () => {
  const { engine } = setup();
  engine.handle({ event: 'Stop', session_id: 'A', ts: 200 });
  const r = engine.handle({ event: 'PostToolUse', session_id: 'A', ts: 150 });
  assert.equal(r.ignored, 'stale');
  assert.equal(engine.display().anim, 'review');
});

test('여러 세션: waiting 이 running 보다 우선, 바쁜 세션 수 배지', () => {
  const { engine } = setup();
  engine.handle({ event: 'UserPromptSubmit', session_id: 'A', ts: 1 });
  engine.handle({ event: 'UserPromptSubmit', session_id: 'B', ts: 1 });
  assert.equal(engine.display().badge, 2);
  engine.handle({ event: 'PermissionRequest', session_id: 'B', tool_name: 'Bash', ts: 2 });
  assert.equal(engine.display().anim, 'waiting');
  engine.handle({ event: 'SessionEnd', session_id: 'B', ts: 3 });
  assert.equal(engine.display().anim, 'running');
  assert.equal(engine.display().badge, 0);
});

test('마지막 세션이 끝나면 empty 이벤트', () => {
  const { log, send } = setup();
  send('SessionStart');
  send('SessionEnd');
  assert.equal(log.empty, 1);
});

test('말풍선: important 모드는 도구 말풍선을 숨기고, off 는 전부 숨김', () => {
  const a = setup({ bubbles: 'important' });
  a.send('PreToolUse', { tool_name: 'Read' });
  a.send('PermissionRequest');
  assert.deepEqual(a.log.bubble, ['허락이 필요해요!']);
  const b = setup({ bubbles: 'off' });
  b.send('PermissionRequest');
  assert.deepEqual(b.log.bubble, []);
});

test('도구 말풍선은 너무 자주 바뀌지 않음', () => {
  const { log, send, advance } = setup();
  send('PreToolUse', { tool_name: 'Read' });
  send('PreToolUse', { tool_name: 'Edit' });
  advance(3000);
  send('PreToolUse', { tool_name: 'Grep' });
  assert.deepEqual(log.bubble, ['파일 읽는 중', '찾아보는 중']);
});

test('normalize 는 긴 문자열/이상한 값을 버림 (프롬프트 등 민감 정보 미전달)', () => {
  const n = normalize({ hook_event_name: 'UserPromptSubmit', prompt: 'secret', session_id: 'x'.repeat(500), ts: 'abc' });
  assert.equal(n.event, 'UserPromptSubmit');
  assert.equal(n.session_id, 'default');
  assert.equal(n.ts, 0);
  assert.equal(n.prompt, undefined);
  assert.equal(normalize(null), null);
  assert.equal(normalize({}), null);
});

test('알 수 없는 이벤트는 무시', () => {
  const { engine } = setup();
  assert.equal(engine.handle({ event: 'MessageDisplay', session_id: 'A' }).ignored, 'unknown-event');
  assert.equal(engine.sessions.size, 0);
});
