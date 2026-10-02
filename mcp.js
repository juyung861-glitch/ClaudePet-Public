#!/usr/bin/env node
'use strict';
// ClaudePet 로컬 MCP 서버 (stdio, 의존성 없음)
// Claude 데스크톱 앱이 이 서버를 띄우면, PC 에 연결된 Claude 채팅이 폴더 권한 없이도 펫에게 신호를 보낼 수 있다.
//   도구: pet_signal(event, message?)  ·  pet_status()
// 실행: node mcp.js  (설치판: ELECTRON_RUN_AS_NODE=1 ClaudePet.exe resources/app/mcp.js)

const readline = require('readline');
const { loadConfig, log } = require('./src/core/config');
const { request, health, launchApp } = require('./src/core/client');
const pkg = require('./package.json');

const EVENTS = {
  start: { event: 'UserPromptSubmit', stale_ms: 3600000 },
  done: { event: 'Stop' },
  waiting: { event: 'PermissionRequest' },
  error: { event: 'StopFailure' },
  end: { event: 'SessionEnd' },
};

const TOOLS = [
  {
    name: 'pet_signal',
    description: 'ClaudePet 데스크톱 펫에게 채팅 상태를 알린다. start = 답변 작성 시작(작업 중), done = 답변 끝(말풍선으로 알림), waiting = 사용자 입력 대기, error = 오류로 멈춤.',
    inputSchema: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: Object.keys(EVENTS), description: '알릴 상태' },
        message: { type: 'string', maxLength: 80, description: '말풍선에 보여줄 짧은 문장 (선택)' },
      },
      required: ['event'],
      additionalProperties: false,
    },
    annotations: { title: 'ClaudePet 신호', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'pet_status',
    description: 'ClaudePet 데스크톱 펫이 켜져 있는지 확인한다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'ClaudePet 상태', readOnlyHint: true, openWorldHint: false },
  },
];

async function callTool(name, args = {}) {
  const cfg = loadConfig();
  if (name === 'pet_status') {
    const h = await health(cfg.port, 800);
    return h ? `ClaudePet ${h.version} 켜져 있음 (펫: ${h.pet})` : 'ClaudePet 꺼져 있음';
  }
  if (name !== 'pet_signal') throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  const def = EVENTS[args.event];
  if (!def) throw Object.assign(new Error(`event 는 ${Object.keys(EVENTS).join(', ')} 중 하나`), { code: -32602 });
  const evt = { ...def, session_id: 'chat', ts: Date.now() };
  if (typeof args.message === 'string' && args.message.trim()) evt.message = args.message.trim().slice(0, 80);
  try {
    const r = await request(cfg.port, '/event', evt, 1500);
    if (r.status === 200) return 'ok';
  } catch { /* 펫이 꺼져 있음 */ }
  // 꺼져 있으면 작업 시작 신호일 때만 펫을 띄움 (끝 신호로 갑자기 뜨지는 않게)
  if (args.event === 'start' && cfg.autoStart) {
    const r = launchApp(evt);
    return r.ok ? 'ClaudePet 을 띄웠어요' : `ClaudePet 을 띄우지 못함 (${r.error})`;
  }
  return 'ClaudePet 꺼져 있음';
}

// ---- JSON-RPC over stdio (줄 단위) -------------------------------------------------
function send(msg) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'claudepet', title: 'ClaudePet', version: pkg.version },
          instructions: 'ClaudePet: 사용자의 데스크톱 펫. pet_signal 로 채팅 상태(start/done 등)를 알리면 펫이 반응한다. 보통은 pet-chat-alerts 스킬이 설치한 훅이 자동으로 부르므로 직접 부를 필요는 없다.',
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const text = await callTool(params && params.name, (params && params.arguments) || {});
        result = { content: [{ type: 'text', text }], isError: false };
        break;
      }
      case 'resources/list':
        result = { resources: [] };
        break;
      case 'prompts/list':
        result = { prompts: [] };
        break;
      default:
        if (!isRequest) return; // notifications/initialized 등 알림은 응답 없음
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
    if (isRequest) send({ id, result });
  } catch (e) {
    if (!isRequest) return;
    if (method === 'tools/call' && e.code !== -32602) {
      send({ id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } });
    } else {
      send({ id, error: { code: e.code || -32603, message: String(e.message || e) } });
    }
  }
}

if (require.main === module) {
  const pending = new Set();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const m of batch) {
      const p = handle(m).catch((e) => log('mcp', e.message));
      pending.add(p);
      p.finally(() => pending.delete(p));
    }
  });
  // 입력이 닫혀도 처리 중인 요청의 응답은 마저 보내고 끝냄
  rl.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
}

module.exports = { TOOLS, EVENTS, handle, callTool };
