'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-int-'));
const PORT = 47000 + Math.floor(Math.random() * 900);
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, '.claude');
process.env.CLAUDE_PET_HOME = path.join(tmp, 'pet-home');
process.env.CODEX_HOME = path.join(tmp, '.codex');
process.env.CLAUDE_PET_PORT = String(PORT);

const { install, MARKER } = require('../scripts/install');
const { uninstall } = require('../scripts/uninstall');
const { createServer, listen } = require('../src/core/server');
const { PetEngine } = require('../src/core/engine');
const { updateConfig } = require('../src/core/config');

const settingsFile = path.join(tmp, '.claude', 'settings.json');
const existing = {
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/local/bin/guard.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  },
};

function runHook(payload, { env = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(ROOT, 'hook.js'), MARKER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

function rawRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, ...opts }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('설치: 기존 설정·훅 보존, 중복 없음, 백업·/pet 명령 생성', () => {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(existing, null, 2));
  install();
  install(); // 두 번 실행해도 중복되지 않아야 함
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.permissions, existing.permissions);
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, '/usr/local/bin/guard.sh');
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'say done');
  for (const [event, groups] of Object.entries(s.hooks)) {
    const ours = groups.flatMap((g) => g.hooks).filter((h) => h.command.includes(MARKER));
    assert.equal(ours.length, 1, `${event} 에 우리 훅은 정확히 1개`);
    assert.equal(ours[0].async, event === 'SessionEnd' ? undefined : true);
  }
  assert.ok(fs.existsSync(`${settingsFile}.bak-claude-pet`));
  const cmd = fs.readFileSync(path.join(tmp, '.claude', 'commands', 'pet.md'), 'utf8');
  assert.match(cmd, /\$ARGUMENTS/);
  assert.match(cmd, /cli\.js/);
});

test('훅 → 펫 서버: 상태 전환, 표준출력 없음, 빠른 종료', async () => {
  const engine = new PetEngine({ config: {} });
  const server = createServer({ onEvent: (e) => engine.handle(e), onControl: () => ({}) });
  await listen(server, PORT);
  try {
    const base = { session_id: 'sess-1', cwd: '/tmp', transcript_path: '/tmp/t.jsonl' };
    let r = await runHook({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '', 'SessionStart 훅은 아무것도 출력하면 안 됨 (Claude 컨텍스트 오염)');
    assert.ok(r.ms < 2000, `훅이 너무 느림: ${r.ms}ms`);
    assert.equal(engine.display().anim, 'idle');

    r = await runHook({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '비밀 프롬프트' });
    assert.equal(r.stdout, '');
    assert.equal(engine.display().anim, 'running');

    await runHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf secret', timeout: 600000 } });
    const s = engine.sessions.get('sess-1');
    assert.ok(s.staleMs >= 600000, 'Bash timeout 반영');

    await runHook({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs permission' });
    assert.equal(engine.display().anim, 'waiting');

    await runHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    assert.equal(engine.display().anim, 'running');

    await runHook({ ...base, hook_event_name: 'Stop', last_assistant_message: '...' });
    assert.equal(engine.display().anim, 'review');

    await runHook({ ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    assert.equal(engine.sessions.size, 0);

    // 이상한 입력에도 조용히 exit 0
    r = await runHook('not json');
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  } finally {
    server.close();
  }
});

test('서버 보안: 브라우저 Origin 요청·헤더 없는 요청 거부', async () => {
  const server = createServer({ onEvent: () => ({}), onControl: () => ({}) });
  await listen(server, PORT);
  try {
    const body = JSON.stringify({ event: 'Stop' });
    assert.equal(await rawRequest({ method: 'POST', path: '/event', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-claude-pet': '1' } }, body), 403);
    assert.equal(await rawRequest({ method: 'POST', path: '/event', headers: { 'content-type': 'application/json' } }, body), 403);
    assert.equal(await rawRequest({ method: 'POST', path: '/control', headers: { 'x-claude-pet': '1' } }, '{bad'), 400);
    assert.equal(await rawRequest({ method: 'POST', path: '/event', headers: { 'x-claude-pet': '1' } }, body), 200);
  } finally {
    server.close();
  }
});

test('펫이 꺼져 있고 자동 실행을 꺼두면 훅은 조용히 바로 끝남', async () => {
  updateConfig({ autoStart: false });
  const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'x' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 2000);
  updateConfig({ autoStart: true });
});

test('제거: 우리 훅과 /pet 만 지우고 나머지는 그대로', async () => {
  await uninstall();
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.deepEqual(s.hooks, existing.hooks);
  assert.equal(s.model, 'opus');
  assert.ok(!fs.existsSync(path.join(tmp, '.claude', 'commands', 'pet.md')));
});
