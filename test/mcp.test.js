'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-mcp-'));
const PORT = 46000 + Math.floor(Math.random() * 900);
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, '.claude');
process.env.CLAUDE_PET_HOME = path.join(tmp, 'pet-home');
process.env.CLAUDE_PET_PORT = String(PORT);
process.env.CLAUDE_PET_DESKTOP_DIR = path.join(tmp, 'Claude');

const { createServer, listen } = require('../src/core/server');
const desktop = require('../src/core/desktop');

/** mcp.js 를 띄워 줄 단위 JSON-RPC 로 대화하는 작은 클라이언트 */
function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp.js')], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  const lines = [];
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(line);
      const msg = JSON.parse(line); // stdout 에는 JSON-RPC 말고 아무것도 나오면 안 됨
      if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  let nextId = 1;
  return {
    child,
    lines,
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    close() {
      child.stdin.end();
      return new Promise((r) => child.on('close', r));
    },
  };
}

test('MCP 서버: 초기화 · 도구 목록 · 펫 신호 전달', async () => {
  const events = [];
  const server = createServer({ onEvent: (e) => events.push(e), onControl: () => ({}), info: () => ({ version: 'test', pid: 1, pet: 'mochi' }) });
  await listen(server, PORT);
  const mcp = startServer();
  try {
    const init = await mcp.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'claudepet');
    assert.ok(init.result.capabilities.tools);
    mcp.notify('notifications/initialized');

    const list = await mcp.call('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['pet_signal', 'pet_status']);
    assert.deepEqual(list.result.tools[0].inputSchema.properties.event.enum, ['start', 'done', 'waiting', 'error', 'end']);

    const done = await mcp.call('tools/call', { name: 'pet_signal', arguments: { event: 'done', message: '답변이 나왔어요! ✓' } });
    assert.equal(done.result.isError, false);
    assert.equal(done.result.content[0].text, 'ok');
    const start = await mcp.call('tools/call', { name: 'pet_signal', arguments: { event: 'start' } });
    assert.equal(start.result.content[0].text, 'ok');
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'Stop');
    assert.equal(events[0].message, '답변이 나왔어요! ✓');
    assert.equal(events[0].session_id, 'chat');
    assert.equal(events[1].event, 'UserPromptSubmit');
    assert.equal(events[1].stale_ms, 3600000);

    const status = await mcp.call('tools/call', { name: 'pet_status', arguments: {} });
    assert.match(status.result.content[0].text, /켜져 있음/);

    const bad = await mcp.call('tools/call', { name: 'pet_signal', arguments: { event: 'explode' } });
    assert.equal(bad.error.code, -32602);
    const unknown = await mcp.call('nope/nope', {});
    assert.equal(unknown.error.code, -32601);
    assert.deepEqual((await mcp.call('ping', {})).result, {});
  } finally {
    await mcp.close();
    await new Promise((r) => server.close(r));
  }
  // 알림(notifications/initialized)에는 응답하지 않음 → 요청 수와 응답 줄 수가 같음
  assert.equal(mcp.lines.length, 8);
});

test('MCP 서버: 펫이 꺼져 있으면 끝 신호로 펫을 띄우지 않음', async () => {
  const mcp = startServer();
  try {
    const r = await mcp.call('tools/call', { name: 'pet_signal', arguments: { event: 'done' } });
    assert.equal(r.result.content[0].text, 'ClaudePet 꺼져 있음');
  } finally {
    await mcp.close();
  }
});

test('Claude 데스크톱 앱 설정에 등록 · 갱신 · 해제 (다른 설정은 보존)', () => {
  const dir = process.env.CLAUDE_PET_DESKTOP_DIR;
  const file = path.join(dir, 'claude_desktop_config.json');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(desktop.desktopState(), 'no-app');
  assert.equal(desktop.registerDesktop().ok, false);

  fs.mkdirSync(dir, { recursive: true });
  assert.equal(desktop.desktopState(), 'none');
  const original = { preferences: { sidebarMode: 'chat' }, mcpServers: { other: { command: 'other.exe', args: [] } } };
  fs.writeFileSync(file, JSON.stringify(original));

  const r = desktop.registerDesktop();
  assert.deepEqual(r.changed, [file]);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.preferences, original.preferences);
  assert.deepEqual(saved.mcpServers.other, original.mcpServers.other);
  assert.equal(saved.mcpServers.claudepet.command, process.execPath);
  assert.deepEqual(saved.mcpServers.claudepet.args, [path.join(ROOT, 'mcp.js')]);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.claudepet-backup`, 'utf8')), original);
  assert.equal(desktop.desktopState(), 'current');
  assert.deepEqual(desktop.registerDesktop().changed, [], '이미 최신이면 파일을 다시 쓰지 않음');

  // 프로그램 위치가 바뀐 경우
  saved.mcpServers.claudepet.args = ['C:\\old\\mcp.js'];
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(desktop.desktopState(), 'outdated');
  desktop.registerDesktop();
  assert.equal(desktop.desktopState(), 'current');

  desktop.unregisterDesktop();
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after, original);
  assert.equal(desktop.desktopState(), 'none');

  // 깨진 설정 파일은 건드리지 않음
  fs.writeFileSync(file, '{ not json');
  assert.equal(desktop.desktopState(), 'broken');
  assert.throws(() => desktop.registerDesktop(), /JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('설정 파일이 아직 없으면 새로 만듦', () => {
  const dir = process.env.CLAUDE_PET_DESKTOP_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  desktop.registerDesktop();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'claude_desktop_config.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.mcpServers), ['claudepet']);
});
