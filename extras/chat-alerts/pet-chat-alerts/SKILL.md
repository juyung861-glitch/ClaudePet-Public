---
name: pet-chat-alerts
description: Use when the user wants their ClaudePet desktop pet to react to chat replies (e.g. '펫 알림 켜줘', '답변 끝나면 펫이 알려주게'), or at the start of any chat when their preferences ask for pet alerts in every conversation.
---

# ClaudePet 채팅 알림 켜기

이 세션의 Claude Code 훅(type `mcp_tool`)이 사용자 PC 의 ClaudePet(데스크톱 펫)에 신호를 보내게 한다.
- 사용자가 메시지를 보낼 때(UserPromptSubmit) → 펫 "작업 중"
- 답변이 끝날 때(Stop) → 펫 "답변이 나왔어요! ✓"

신호를 보내는 길은 두 가지다. **A 를 먼저 찾고, 없을 때만 B.**
- **A. ClaudePet 연결 도구**: ClaudePet 1.3 이상이 Claude 데스크톱 앱에 등록한 로컬 MCP 서버 `claudepet`. 권한 요청 없이 바로 된다.
- **B. ClaudePet 폴더**: PC 연결 도구 `device_bash` 로 `~/ClaudePet/inbox/` 에 신호 파일을 쓴다. 대화마다 폴더 접근 허용을 한 번 받아야 한다.

답변은 한국어로, 짧게.

## 두 가지 모드
- **요청 모드**: 사용자가 직접 "펫 알림 켜줘" 등으로 부탁한 경우. 안 되는 이유가 있으면 한 줄로 알려 준다.
- **자동 모드**: 사용자의 선호 설정(모든 대화에서 펫 알림)에 따라 대화 첫 답변을 시작하며 스스로 켜는 경우. 사용자의 본래 요청이 주업무다.
  - PC 가 연결돼 있지 않으면 **아무 말 없이 건너뛴다** (휴대폰·웹 대화 등).
  - 진행 과정을 설명하지 않는다. 끝나면 답변 끝에 "🐾 펫 알림 켜짐" 정도 한 줄만, 또는 생략.

## 1. 이미 켜져 있는지
Bash 도구(클라우드 컨테이너)로:
```bash
grep -o 'pet_signal\|ClaudePet' ~/.claude/settings.json 2>/dev/null | sort -u
```
- `pet_signal` 이 있으면 이미 길 A 로 켜져 있다 → 자동 모드는 아무것도 하지 않고, 요청 모드는 이미 켜져 있다고 말한다.
- `ClaudePet` 만 있으면 길 B 로 켜져 있다 → 2 에서 길 A 가 되면 A 로 바꾸고, 안 되면 그대로 끝.

## 2. 길 A: ClaudePet 연결 도구
- ToolSearch 로 `claudepet pet_signal` 을 검색한다 (max_results 5).
- 이름이 `mcp__remote-devices__` 로 시작하고 `pet_signal` 로 끝나는 도구(예: `mcp__remote-devices__claudepet__pet_signal`)가 있으면 길 A. 없으면 3 으로.
- 그 도구를 `{"event": "start"}` 로 한 번 부른다. 첫 메시지는 훅 설치 전에 들어와 시작 신호가 안 갔기 때문이다.
  - 결과가 `ok` 또는 `띄웠어요` 면 펫이 듣고 있다.
  - `꺼져 있음` 이면 (요청 모드) "ClaudePet 을 실행해 주세요" 라고 안내한다. 어느 모드든 훅 설치는 계속한다.
- 4 의 스크립트를 `MODE=mcp TOOL=<도구 이름에서 앞의 mcp__remote-devices__ 를 뗀 것>` 으로 실행한다. 예: `TOOL=claudepet__pet_signal`.

## 3. 길 B: ClaudePet 폴더 (길 A 가 없을 때만)
1. `mcp__remote-devices__get_device_info` 를 부른다 (지연 로드 도구면 ToolSearch 로 먼저 로드).
   - 도구가 없거나 "not connected" 오류면: (요청 모드) "Claude 데스크톱 앱에서 이 대화를 열고 메시지를 한 번 보내 주세요" 라고 안내하고 멈춘다 / (자동 모드) 조용히 멈춘다.
   - `homeDirectories` 에 `ClaudePet` 이 없으면: (요청 모드) ClaudePet 을 한 번 실행해야 폴더가 생긴다고 안내 / (자동 모드) 조용히 멈춘다.
2. `connectedFolders` 에 `...\ClaudePet` 이 없으면 `mcp__remote-devices__device_request_folder_access` 로 `~/ClaudePet` 하나만 요청한다.
   - reason: "답변이 끝날 때마다 펫이 알려주도록 ClaudePet 신호 폴더에 신호를 남기려고 해요."
   - 거절되면 다시 묻지 않고 멈춘다.
   - 요청 모드라면 마무리 때 한 줄 덧붙인다: "ClaudePet 을 1.3 이상으로 업데이트하고 Claude 앱을 다시 켜면, 다음부터는 이 허용 없이 켜져요."
3. 지금 답변을 "작업 중"으로 + 펫이 듣는지 확인. `mcp__remote-devices__device_bash`:
   ```
   D="$HOME/mnt/ClaudePet/inbox"; n="$D/$(date +%s%N)-chat"; printf '%s' '{"event": "UserPromptSubmit", "session_id": "chat", "stale_ms": 3600000}' > "$n.tmp" && mv "$n.tmp" "$n.json"; sleep 3; ls "$D"
   ```
   - 3초 뒤 `-chat.json` 이 사라졌으면 펫이 정상 동작 중.
   - 남아 있으면 펫이 꺼져 있는 것 → (요청 모드) "ClaudePet 을 실행해 주세요" 안내. 어느 모드든 훅 설치는 계속한다.
4. 4 의 스크립트를 `MODE=folder` 로 실행한다.

## 4. 이 세션에 훅 설치
클라우드 컨테이너(Bash 도구)의 `~/.claude/settings.json` 에 병합한다. 다른 설정·훅은 보존하고, 예전 ClaudePet 훅은 바꿔 끼운다. 명령 문자열에 `${` 를 쓰지 말 것(훅 변수 치환 문법과 겹침). 파일을 바꾸면 같은 대화에서 바로 적용돼, 이번 답변이 끝날 때부터 펫이 알려준다.
```bash
MODE=mcp TOOL=claudepet__pet_signal python3 - <<'EOF'
import json, os
mode = os.environ.get('MODE', 'mcp')
tool = os.environ.get('TOOL', 'claudepet__pet_signal')
p = os.path.expanduser('~/.claude/settings.json')
try:
    settings = json.load(open(p, encoding='utf-8'))
except Exception:
    settings = {}
def folder_cmd(evt):
    return ('D="$HOME/mnt/ClaudePet/inbox"; [ -d "$D" ] || exit 0; n="$D/$(date +%s%N)-chat"; '
            "printf '%s' '" + json.dumps(evt, ensure_ascii=False) + "' > \"$n.tmp\" && mv \"$n.tmp\" \"$n.json\"; exit 0")
def group(kind, message=None):
    if mode == 'mcp':
        args = {'event': kind}
        if message:
            args['message'] = message
        hook = {'type': 'mcp_tool', 'server': 'remote-devices', 'tool': tool, 'input': args}
    else:
        evt = ({'event': 'UserPromptSubmit', 'session_id': 'chat', 'stale_ms': 3600000} if kind == 'start'
               else {'event': 'Stop', 'session_id': 'chat', 'message': message})
        hook = {'type': 'mcp_tool', 'server': 'remote-devices', 'tool': 'device_bash', 'input': {'command': folder_cmd(evt)}}
    hook.update({'timeout': 20, 'statusMessage': 'ClaudePet 신호'})
    return {'hooks': [hook]}
hooks = settings.setdefault('hooks', {})
for ev in ('UserPromptSubmit', 'Stop'):
    hooks[ev] = [g for g in hooks.get(ev, []) if 'ClaudePet' not in json.dumps(g, ensure_ascii=False)]
hooks['UserPromptSubmit'].append(group('start'))
hooks['Stop'].append(group('done', '답변이 나왔어요! ✓'))
assert '${' not in json.dumps(hooks)
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(settings, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('ok', mode)
EOF
```

## 5. 마무리
- 요청 모드: 한두 문장으로, 이 대화에서는 이제 답변이 끝날 때마다 펫이 알려준다고 말한다.
- 자동 모드: 답변 끝에 "🐾 펫 알림 켜짐" 한 줄만, 또는 생략. 본래 요청에 대한 답을 이어서 한다.

## 참고
- 길 A 도구 인자: `event` = start(작업 시작) · done(답변 끝) · waiting(입력 대기) · error(오류) · end, `message` = 말풍선 한 줄(선택).
- 길 B 신호 형식: `{"event":"Stop","message":"한 줄"}` (작업 끝), `{"event":"UserPromptSubmit","stale_ms":3600000}` (작업 시작). 10분 넘은 신호는 펫이 무시한다.
- 길 A 도구가 안 보이면: ClaudePet 1.3 이상인지, 펫 우클릭 메뉴의 "Claude 데스크톱 앱과 연결" 이 켜져 있는지, 그 뒤 Claude 앱을 완전히 종료했다가 다시 켰는지 확인.
- PC 가 꺼지거나 연결이 끊기면 훅은 조용히 실패할 뿐 대화에는 영향이 없다.
- 끄려면 `~/.claude/settings.json` 에서 `ClaudePet` 이 들어간 훅 그룹을 지운다.
