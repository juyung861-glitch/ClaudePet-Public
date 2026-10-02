'use strict';
// 말풍선 문구. 프롬프트 내용·파일명·명령어는 절대 표시하지 않고 "무슨 종류의 일"만 보여준다.

const STRINGS = {
  ko: {
    hello: ['안녕! 같이 코딩해요', '왔어요! 👋', '오늘도 화이팅!'],
    resume: '이어서 해볼까요?',
    clear: '새로 시작!',
    bye: '수고했어요!',
    thinking: '생각 중…',
    compacting: '대화 정리 중…',
    working: '작업 중…',
    bash: '명령 실행 중',
    read: '파일 읽는 중',
    edit: '코드 고치는 중',
    search: '찾아보는 중',
    web: '웹 찾아보는 중',
    agent: '도우미 보내는 중',
    todo: '할 일 정리 중',
    mcp: '도구 쓰는 중',
    subagentStart: '도우미 출동!',
    subagentStop: '도우미 복귀!',
    permission: '허락이 필요해요!',
    question: '질문이 있어요!',
    plan: '계획 확인해 주세요',
    yourTurn: '입력을 기다려요',
    needsInput: '확인이 필요해요',
    done: '다 했어요! ✓',
    failed: '오류로 멈췄어요',
    errors: {
      rate_limit: '사용량 한도에 걸렸어요', overloaded: '서버가 붐벼요', authentication_failed: '로그인이 필요해요',
      billing_error: '결제 문제가 있어요', max_output_tokens: '출력이 너무 길어요', server_error: '서버 오류예요',
    },
    pokes: ['반가워요!', '코딩 화이팅!', '헤헤', '쉬엄쉬엄 해요', '물 한 잔 어때요?'],
    status: (busy, total) => (total ? `세션 ${total}개 · 작업 중 ${busy}개` : '쉬는 중이에요'),
  },
  en: {
    hello: ['Hi! Let’s code', 'Hello! 👋', 'Ready when you are'],
    resume: 'Picking up where we left off',
    clear: 'Fresh start!',
    bye: 'Good work!',
    thinking: 'Thinking…',
    compacting: 'Compacting…',
    working: 'Working…',
    bash: 'Running a command',
    read: 'Reading files',
    edit: 'Editing code',
    search: 'Searching',
    web: 'Browsing the web',
    agent: 'Sending a helper',
    todo: 'Planning tasks',
    mcp: 'Using a tool',
    subagentStart: 'Helper deployed!',
    subagentStop: 'Helper is back!',
    permission: 'Need your OK!',
    question: 'I have a question!',
    plan: 'Please review the plan',
    yourTurn: 'Your turn',
    needsInput: 'Needs your attention',
    done: 'All done! ✓',
    failed: 'Stopped with an error',
    errors: {
      rate_limit: 'Hit a rate limit', overloaded: 'Servers are busy', authentication_failed: 'Please log in',
      billing_error: 'Billing issue', max_output_tokens: 'Output too long', server_error: 'Server error',
    },
    pokes: ['Hi there!', 'You got this!', 'Hehe', 'Take a break?', 'Stay hydrated!'],
    status: (busy, total) => (total ? `${total} session(s) · ${busy} busy` : 'Taking a break'),
  },
};

function strings(lang) {
  return STRINGS[lang] || STRINGS.ko;
}

/** 도구 이름 -> 말풍선 키 */
function toolKey(tool) {
  const t = String(tool || '');
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/.test(t)) return 'bash';
  if (/^(Read|NotebookRead|LS)$/.test(t)) return 'read';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(t)) return 'edit';
  if (/^(Glob|Grep|ToolSearch)$/.test(t)) return 'search';
  if (/^(WebSearch|WebFetch)$/.test(t)) return 'web';
  if (/^(Agent|Task|SendMessage)$/.test(t)) return 'agent';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(t)) return 'todo';
  if (t.startsWith('mcp__')) return 'mcp';
  return 'working';
}

function pick(list, rnd = Math.random) {
  return Array.isArray(list) ? list[Math.floor(rnd() * list.length) % list.length] : list;
}

module.exports = { STRINGS, strings, toolKey, pick };
