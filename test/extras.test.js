'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readZip } = require('../src/core/gallery');

const dir = path.join(__dirname, '..', 'extras', 'chat-alerts');

test('채팅 알림 스킬 zip 이 SKILL.md 원본과 같고 업로드 규격에 맞음', () => {
  const src = fs.readFileSync(path.join(dir, 'pet-chat-alerts', 'SKILL.md'));
  const files = readZip(fs.readFileSync(path.join(dir, 'pet-chat-alerts.zip')));
  assert.deepEqual([...files.keys()], ['pet-chat-alerts/SKILL.md'], '폴더 이름 = 스킬 이름, SKILL.md 하나');
  assert.ok(files.get('pet-chat-alerts/SKILL.md').equals(src), 'zip 이 원본과 다르면 extras/chat-alerts 에서 zip 을 다시 만들 것');
  const front = src.toString('utf8').split('---')[1];
  assert.match(front, /^name: pet-chat-alerts$/m);
  assert.match(front, /^description: .+/m);
  assert.doesNotMatch(front, /name: .*(claude|anthropic)/i, '스킬 이름에 claude/anthropic 금지');
});

test('지침 문구가 스킬 이름을 가리킴', () => {
  const text = fs.readFileSync(path.join(dir, 'instructions.txt'), 'utf8');
  assert.match(text, /pet-chat-alerts/);
  assert.ok(text.length < 1000);
});
