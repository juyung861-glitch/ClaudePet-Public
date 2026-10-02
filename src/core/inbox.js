'use strict';
// 클라우드 세션(claude.ai / Claude 데스크톱 앱의 클라우드 작업) → 펫 연결 통로.
// 클라우드에서 도는 Claude 는 이 PC 로 직접 연결할 수 없지만, PC 에 연결된 폴더에는 파일을 쓸 수 있다.
// 그래서 <앱 폴더>/inbox/ 에 놓인 신호 파일(JSON)을 읽어 훅 이벤트처럼 처리한다.
//
// 신호 파일 예: inbox/1759300000000-ab12.json
//   {"event":"UserPromptSubmit","session_id":"cloud"}   작업 시작
//   {"event":"Stop","session_id":"cloud"}               작업 끝
const fs = require('fs');
const path = require('path');
const { APP_DIR, PACKAGED, paths } = require('./config');

// 기본 신호함: ~/ClaudePet/inbox (Claude 앱에서 ~/ClaudePet 폴더를 연결하면 클라우드 Claude 가 여기에 씀)
// 개발 모드(소스 폴더에서 실행)일 땐 <앱 폴더>/inbox 도 함께 지켜봄
const INBOX_DIR = paths.inbox;
const INBOX_DIRS = PACKAGED ? [paths.inbox] : [paths.inbox, path.join(APP_DIR, 'inbox')];
const MAX_BYTES = 4096;
const MAX_AGE_MS = 10 * 60 * 1000; // 10분 넘게 쌓여 있던 신호는 버림 (펫이 꺼져 있던 동안 것)
const POLL_MS = 1500;

/** 신호 파일 내용 → 엔진 이벤트 (세션 id 는 cloud: 로 구분) */
function parseSignal(text, fileMtimeMs, now = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const event = typeof raw.event === 'string' ? raw.event : raw.hook_event_name;
  if (typeof event !== 'string' || !event) return null;
  const ts = Number(raw.ts) > 0 ? Number(raw.ts) : fileMtimeMs;
  if (ts && now - ts > MAX_AGE_MS) return null;
  const sid = typeof raw.session_id === 'string' && raw.session_id.length <= 80 ? raw.session_id : 'cloud';
  return {
    ...raw,
    event,
    session_id: sid.startsWith('cloud') ? sid : `cloud:${sid}`,
    ts: ts || now,
  };
}

/**
 * inbox 감시 시작. onEvent(evt) 로 넘기고 처리한 파일은 지운다.
 * 반환: stop()
 */
function watchInbox(onEvent, { dir, dirs, log = () => {} } = {}) {
  const list = dirs || (dir ? [dir] : INBOX_DIRS);
  const stops = list.map((d) => {
    try {
      return watchOne(d, onEvent, log);
    } catch (e) {
      log('inbox: 감시 실패', d, e.message);
      return () => {};
    }
  });
  return () => stops.forEach((stop) => stop());
}

function watchOne(dir, onEvent, log) {
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, 'ClaudePet 신호함: 이 폴더에 {"event":"Stop"} 같은 .json 파일을 넣으면 펫이 반응하고 파일은 지워집니다.\r\n');
  }
  let busy = false;
  const scan = () => {
    if (busy) return;
    busy = true;
    try {
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')).sort(); } catch { names = []; }
      const batch = [];
      for (const name of names) {
        const file = path.join(dir, name);
        try {
          const st = fs.statSync(file);
          if (!st.isFile()) continue;
          const evt = st.size <= MAX_BYTES ? parseSignal(fs.readFileSync(file, 'utf8'), st.mtimeMs) : null;
          fs.rmSync(file, { force: true });
          if (evt) batch.push({ evt, name });
        } catch (e) {
          log('inbox: 처리 실패', name, e.message);
        }
      }
      // 한꺼번에 들어온 신호는 보낸 시각 순서대로 (같은 시각이면 파일 이름 순)
      batch.sort((a, b) => (a.evt.ts - b.evt.ts) || (a.name < b.name ? -1 : 1));
      for (const { evt } of batch) onEvent(evt);
    } finally {
      busy = false;
    }
  };
  let watcher = null;
  try {
    watcher = fs.watch(dir, () => setTimeout(scan, 80));
    watcher.on('error', () => {});
  } catch { /* 폴링으로 대체 */ }
  const timer = setInterval(scan, POLL_MS);
  scan();
  return () => {
    clearInterval(timer);
    try { watcher && watcher.close(); } catch { /* 무시 */ }
  };
}

let seq = 0;

/** 신호 파일 쓰기 (CLI·테스트용). 임시 이름으로 쓴 뒤 바꿔서 반쯤 쓰인 파일을 읽지 않게 함 */
function writeSignal(evt, dir = INBOX_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  seq = (seq + 1) % 10000;
  const base = `${Date.now()}-${String(seq).padStart(4, '0')}-${Math.random().toString(36).slice(2, 6)}`;
  const tmp = path.join(dir, `${base}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ session_id: 'cloud', ts: Date.now(), ...evt }));
  const final = path.join(dir, `${base}.json`);
  fs.renameSync(tmp, final);
  return final;
}

module.exports = { INBOX_DIR, INBOX_DIRS, parseSignal, watchInbox, writeSignal, MAX_AGE_MS };
