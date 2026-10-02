'use strict';
// Claude Code 훅 이벤트 -> 펫 상태 엔진 (Electron 없이 테스트 가능한 순수 로직)
const { EventEmitter } = require('events');
const { resolveAnimations, loopMs } = require('./atlas');
const { strings, toolKey, pick } = require('./labels');

const PRIORITY = { idle: 0, review: 1, running: 2, failed: 3, waiting: 4 };
const STATUS_ANIM = { idle: 'idle', review: 'review', running: 'running', failed: 'failed', waiting: 'waiting' };
const END_LOOPS = 3;                 // review / failed 는 3번 재생 후 쉬기 (Codex 펫과 동일)
const NORMAL_BUBBLE_GAP_MS = 2500;   // 도구 말풍선이 너무 자주 바뀌지 않게
const IDLE_SESSION_GC_MS = 6 * 60 * 60 * 1000;

const KNOWN_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
]);

const IGNORED_NOTIFICATIONS = new Set([
  'auth_success', 'elicitation_complete', 'elicitation_response', 'agent_completed',
  'quota_auto_resume_fired', 'quota_auto_resume_stale', 'quota_auto_resume_disabled',
]);

class PetEngine extends EventEmitter {
  constructor({ config = {}, now = Date.now, random = Math.random } = {}) {
    super();
    this.now = now;
    this.random = random;
    this.sessions = new Map();
    this.lastNormalBubbleAt = 0;
    this.lastDisplay = null;
    this.configure(config);
  }

  configure(config) {
    this.config = { bubbles: 'all', language: 'ko', runningTimeoutSec: 300, waitingTimeoutSec: 1800, ...config };
    this.anims = resolveAnimations(this.config.animationDurations);
    this.t = strings(this.config.language);
  }

  // ---- 외부 API ------------------------------------------------------------
  handle(raw) {
    const evt = normalize(raw);
    if (!evt) return { ok: false, reason: 'invalid' };
    if (!KNOWN_EVENTS.has(evt.event)) return { ok: true, ignored: 'unknown-event' };

    const now = this.now();
    const sid = evt.session_id;
    let s = this.sessions.get(sid);

    if (evt.event === 'SessionEnd') {
      if (s) this.sessions.delete(sid);
      this.oneshot('waving');
      this.bubble(this.t.bye, false);
      this.emitDisplay();
      if (this.sessions.size === 0) this.emit('empty');
      return { ok: true };
    }

    if (!s) {
      s = { status: 'idle', since: now, lastEventAt: now, lastTs: 0, staleMs: 0, expiresAt: 0, label: '' };
      this.sessions.set(sid, s);
    }
    // 비동기 훅은 순서가 뒤바뀌어 도착할 수 있음 -> 더 오래된 이벤트는 버림
    if (evt.ts && s.lastTs && evt.ts < s.lastTs) return { ok: true, ignored: 'stale' };
    if (evt.ts) s.lastTs = evt.ts;
    s.lastEventAt = now;

    const t = this.t;
    switch (evt.event) {
      case 'SessionStart': {
        this.set(s, 'idle');
        if (evt.source === 'resume' || evt.source === 'fork') this.bubble(t.resume, true);
        else if (evt.source === 'clear') this.bubble(t.clear, true);
        else if (evt.source !== 'compact') this.bubble(pick(t.hello, this.random), true);
        if (evt.source !== 'compact') this.oneshot('waving');
        break;
      }
      case 'UserPromptSubmit':
        this.set(s, 'running', t.thinking);
        this.bubble(t.thinking, false);
        break;
      case 'PreToolUse': {
        if (evt.tool_name === 'AskUserQuestion') {
          this.set(s, 'waiting', t.question);
          this.bubble(t.question, true);
          break;
        }
        if (evt.tool_name === 'ExitPlanMode') {
          this.set(s, 'waiting', t.plan);
          this.bubble(t.plan, true);
          break;
        }
        const label = t[toolKey(evt.tool_name)] || t.working;
        this.set(s, 'running', label);
        // 오래 걸리는 명령(빌드 등)은 그 시간만큼 '작업 중' 유지
        if (evt.tool_timeout_ms && !evt.run_in_background) s.staleMs = Math.min(evt.tool_timeout_ms + 30000, 2 * 60 * 60 * 1000);
        this.bubble(label, false);
        break;
      }
      case 'PostToolUse':
        this.set(s, 'running', s.status === 'running' ? s.label : t.working);
        break;
      case 'PostToolUseFailure':
        this.set(s, 'running', s.status === 'running' ? s.label : t.working);
        this.oneshot('failed', 1);
        break;
      case 'PermissionRequest':
        this.set(s, 'waiting', t.permission);
        this.bubble(t.permission, true);
        break;
      case 'Notification': {
        const type = evt.notification_type;
        if (type && IGNORED_NOTIFICATIONS.has(type)) return { ok: true, ignored: 'notification' };
        let label = t.needsInput;
        if (type === 'permission_prompt') label = t.permission;
        else if (type === 'idle_prompt') label = t.yourTurn;
        else if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog') label = t.question;
        this.set(s, 'waiting', label);
        this.bubble(label, true);
        break;
      }
      case 'Stop':
        this.set(s, 'review', t.done);
        s.expiresAt = now + loopMs(this.anims, 'review') * END_LOOPS;
        this.bubble(evt.message || t.done, true);
        break;
      case 'StopFailure': {
        const label = (evt.error_type && t.errors[evt.error_type]) || t.failed;
        this.set(s, 'failed', label);
        s.expiresAt = now + loopMs(this.anims, 'failed') * END_LOOPS;
        this.bubble(label, true);
        break;
      }
      case 'SubagentStart':
        this.set(s, 'running', t.agent);
        this.bubble(t.subagentStart, false);
        break;
      case 'SubagentStop':
        this.oneshot('jumping');
        this.bubble(t.subagentStop, false);
        break;
      case 'PreCompact':
        this.set(s, 'running', t.compacting);
        this.bubble(t.compacting, false);
        break;
      case 'PostCompact':
        if (s.status === 'running' && s.label === t.compacting) this.set(s, 'running', t.thinking);
        break;
      default:
        break;
    }
    // 클라우드 신호처럼 중간 소식이 드문 작업은 stale_ms 동안 '작업 중' 유지
    if (s.status === 'running' && evt.stale_ms) s.staleMs = Math.max(s.staleMs || 0, Math.min(evt.stale_ms, 6 * 60 * 60 * 1000));
    if (evt.message && evt.event !== 'Stop' && s.status !== 'idle') this.bubble(evt.message, true);
    this.emitDisplay();
    return { ok: true };
  }

  /** 주기적으로 호출 (1초마다): 시간 초과 상태 정리 */
  tick() {
    const now = this.now();
    for (const [sid, s] of this.sessions) {
      const quiet = now - s.lastEventAt;
      if (s.status === 'running') {
        const limit = Math.max(this.config.runningTimeoutSec * 1000, s.staleMs || 0);
        if (limit > 0 && quiet > limit) this.set(s, 'idle');
      } else if (s.status === 'waiting') {
        if (this.config.waitingTimeoutSec > 0 && quiet > this.config.waitingTimeoutSec * 1000) this.set(s, 'idle');
      } else if (s.status === 'review' || s.status === 'failed') {
        if (now >= s.expiresAt) this.set(s, 'idle');
      } else if (s.status === 'idle' && quiet > IDLE_SESSION_GC_MS) {
        this.sessions.delete(sid);
      }
    }
    this.emitDisplay();
  }

  display() {
    let top = null;
    let busy = 0;
    for (const s of this.sessions.values()) {
      if (s.status === 'running' || s.status === 'waiting') busy += 1;
      if (!top || PRIORITY[s.status] > PRIORITY[top.status] ||
          (PRIORITY[s.status] === PRIORITY[top.status] && s.lastEventAt > top.lastEventAt)) top = s;
    }
    const status = top ? top.status : 'idle';
    return {
      status,
      anim: STATUS_ANIM[status],
      label: top ? top.label : '',
      sessions: this.sessions.size,
      busy,
      badge: busy >= 2 ? busy : 0,
    };
  }

  statusText() {
    const d = this.display();
    return this.t.status(d.busy, d.sessions);
  }

  poke() {
    this.oneshot('waving');
    this.bubble(pick(this.t.pokes, this.random), true);
  }

  // ---- 내부 -------------------------------------------------------------
  set(s, status, label = '') {
    if (s.status !== status) {
      s.status = status;
      s.since = this.now();
      if (status !== 'running') s.staleMs = 0;
    }
    s.label = label;
  }

  oneshot(anim, loops = 1) {
    this.emit('oneshot', { anim, loops });
  }

  bubble(text, important) {
    const mode = this.config.bubbles;
    if (!text || mode === 'off') return;
    if (!important) {
      if (mode === 'important') return;
      const now = this.now();
      if (now - this.lastNormalBubbleAt < NORMAL_BUBBLE_GAP_MS) return;
      this.lastNormalBubbleAt = now;
    }
    this.emit('bubble', { text, ms: important ? 4500 : 2200, important: !!important });
  }

  emitDisplay() {
    const d = this.display();
    const key = `${d.anim}|${d.badge}|${d.label}`;
    if (key !== this.lastDisplay) {
      this.lastDisplay = key;
      this.emit('display', d);
    }
  }
}

/** 훅에서 온 데이터 정리: 짧은 문자열/숫자 필드만 남긴다 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const event = str(raw.event || raw.hook_event_name, 40);
  if (!event) return null;
  return {
    event,
    session_id: str(raw.session_id, 120) || 'default',
    tool_name: str(raw.tool_name, 120),
    notification_type: str(raw.notification_type, 60),
    source: str(raw.source, 30),
    reason: str(raw.reason, 60),
    error_type: str(raw.error_type || raw.error, 60),
    agent_type: str(raw.agent_type, 80),
    tool_timeout_ms: num(raw.tool_timeout_ms),
    run_in_background: raw.run_in_background === true,
    stale_ms: num(raw.stale_ms),
    message: str(raw.message, 80),
    ts: num(raw.ts),
  };
}

function str(v, max) {
  return typeof v === 'string' && v.length <= max ? v : '';
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

module.exports = { PetEngine, normalize, KNOWN_EVENTS, PRIORITY };
