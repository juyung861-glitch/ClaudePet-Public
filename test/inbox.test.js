'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSignal, watchInbox, writeSignal } = require('../src/core/inbox');
const { PetEngine } = require('../src/core/engine');

test('신호 파일 해석: cloud 세션 구분, 오래된 신호·이상한 내용 거부', () => {
  const now = 1_800_000_000_000;
  assert.equal(parseSignal('{"event":"Stop"}', now - 1000, now).session_id, 'cloud');
  assert.equal(parseSignal('{"event":"Stop","session_id":"abc"}', now, now).session_id, 'cloud:abc');
  assert.equal(parseSignal('{"hook_event_name":"UserPromptSubmit"}', now, now).event, 'UserPromptSubmit');
  assert.equal(parseSignal('{"event":"Stop"}', now - 11 * 60 * 1000, now), null, '10분 지난 신호');
  assert.equal(parseSignal('not json', now, now), null);
  assert.equal(parseSignal('{"nope":1}', now, now), null);
});

test('inbox 감시: 파일을 넣으면 이벤트가 오고 파일은 지워짐', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-inbox-'));
  const got = [];
  const stop = watchInbox((e) => got.push(e), { dir });
  try {
    writeSignal({ event: 'UserPromptSubmit', stale_ms: 3600000 }, dir);
    writeSignal({ event: 'Stop', message: '빌드 끝!' }, dir);
    fs.writeFileSync(path.join(dir, 'half.tmp'), '{"event":"Stop"');
    for (let i = 0; i < 40 && got.length < 2; i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got.map((e) => e.event), ['UserPromptSubmit', 'Stop']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['README.txt', 'half.tmp']);
  } finally {
    stop();
  }
});

test('클라우드 작업: stale_ms 동안 작업 중 유지, 끝 신호의 메시지를 말풍선으로', () => {
  let now = 1_000_000;
  const engine = new PetEngine({ config: { runningTimeoutSec: 60 }, now: () => now });
  const bubbles = [];
  engine.on('bubble', (b) => bubbles.push(b.text));
  engine.handle({ event: 'UserPromptSubmit', session_id: 'cloud', stale_ms: 3600000, ts: 1 });
  now += 30 * 60 * 1000; engine.tick();
  assert.equal(engine.display().anim, 'running', '30분 뒤에도 작업 중');
  engine.handle({ event: 'Stop', session_id: 'cloud', message: 'GIF 기능 끝!', ts: 2 });
  assert.equal(engine.display().anim, 'review');
  assert.ok(bubbles.includes('GIF 기능 끝!'));
  now += 70 * 60 * 1000; engine.tick();
  assert.equal(engine.display().anim, 'idle');
});
