#!/usr/bin/env node
'use strict';
// ClaudePet 훅·/pet 명령 제거. 다른 훅과 설정은 그대로 둔다.
//   node scripts/uninstall.js          제거 (펫 설정 파일은 남김)
//   node scripts/uninstall.js --purge  ~/.claude/claude-pet 설정·로그까지 삭제
const fs = require('fs');
const path = require('path');
const { paths, loadConfig } = require('../src/core/config');
const { removeHooks } = require('./install');
const { request } = require('../src/core/client');

async function uninstall({ purge = false } = {}) {
  const out = [];
  try {
    await request(loadConfig().port, '/control', { cmd: 'quit' }, 800);
    out.push('펫 앱 종료');
  } catch { /* 꺼져 있음 */ }

  out.push(...removeHooks());
  if (purge) {
    fs.rmSync(paths.data, { recursive: true, force: true });
    out.push(`설정·로그 삭제: ${paths.data}`);
  }
  return out;
}

if (require.main === module) {
  uninstall({ purge: process.argv.includes('--purge') })
    .then((out) => console.log(out.length ? `✓ ${out.join('\n✓ ')}` : '제거할 것이 없어요.'))
    .catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
}

module.exports = { uninstall };
