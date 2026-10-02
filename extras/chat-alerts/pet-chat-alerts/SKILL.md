---
name: pet-chat-alerts
description: Use when the user wants their ClaudePet desktop pet to react to chat replies (e.g. '펫 알림 켜줘', '답변 끝나면 펫이 알려주게', 'notify my pet'), or at the start of any chat when their instructions ask for pet alerts in every conversation.
---

# ClaudePet 채팅 답변 알림

ClaudePet(데스크톱 펫, https://github.com/juyung861-glitch/ClaudePet-Public)은 `~/ClaudePet/inbox/` 에 놓인 `.json` 신호 파일을 읽고 반응한 뒤 지운다.
클라우드에서 도는 채팅은 PC 로 직접 연결할 수 없으므로, 이 세션의 Claude Code 훅(type `mcp_tool`)이 PC 연결 도구 `remote-devices` 의 `device_bash` 를 불러 신호 파일을 쓰게 한다.
- 사용자가 메시지를 보낼 때(UserPromptSubmit) → 펫 "작업 중"
- 답변이 끝날 때(Stop) → 펫 "답변이 나왔어요! ✓"

사용자의 언어로, 짧게 답한다.

## 두 가지 모드
- **요청 모드**: 사용자가 직접 "펫 알림 켜줘" 등으로 부탁한 경우. 안 되는 이유가 있으면 한 줄로 알려 준다.
- **자동 모드**: 사용자의 지침(모든 대화에서 펫 알림)에 따라 대화 첫 답변을 시작하며 스스로 켜는 경우. 사용자의 본래 요청이 주업무다.
  - PC 가 연결돼 있지 않거나 `ClaudePet` 폴더가 없으면 **아무 말 없이 건너뛴다** (휴대폰·웹 대화 등).
  - 이미 이 세션의 `~/.claude/settings.json` 에 `ClaudePet` 훅이 있으면 아무것도 하지 않는다.
  - 진행 과정을 설명하지 않는다. 끝나면 답변 끝에 "🐾 펫 알림 켜짐" 정도 한 줄만, 또는 생략.

## 1. PC 연결 확인
- `mcp__remote-devices__get_device_info` 를 불러 본다 (지연 로드 도구면 ToolSearch 로 먼저 로드).
- 도구가 없거나 "not connected" 오류면:
  - 요청 모드: "Claude 데스크톱 앱에서 이 대화를 열고 메시지를 한 번 보내 주세요" 라고 안내하고 멈춘다.
  - 자동 모드: 조용히 멈춘다.
- `homeDirectories` 에 `ClaudePet` 이 없으면: (요청 모드) ClaudePet 을 설치·실행해야 폴더가 생긴다고 안내 / (자동 모드) 조용히 멈춘다.

## 2. 폴더 연결
- `connectedFolders` 에 `...ClaudePet` 이 없으면 `mcp__remote-devices__device_request_folder_access` 로 `~/ClaudePet` 하나만 요청한다. (폴더 권한은 대화마다 따로라 새 대화마다 한 번 묻게 된다.)
  - reason: "답변이 끝날 때마다 펫이 알려주도록 ClaudePet 신호 폴더에 신호를 남기려고 해요."
- 거절되면 다시 묻지 않고 멈춘다.

## 3. 지금 답변을 "작업 중"으로 + 펫이 듣는지 확인
(첫 메시지는 훅 설치 전에 들어와서 시작 신호가 안 갔으므로 직접 보낸다.) `mcp__remote-devices__device_bash`:
```
D="$HOME/mnt/ClaudePet/inbox"; n="$D/$(date +%s%N)-chat"; printf '%s' '{"event": "UserPromptSubmit", "session_id": "chat", "stale_ms": 3600000}' > "$n.tmp" && mv "$n.tmp" "$n.json"; sleep 3; ls "$D"
```
- 3초 뒤 `-chat.json` 이 사라졌으면 펫이 정상 동작 중.
- 남아 있으면 펫이 꺼져 있는 것 → (요청 모드) "ClaudePet 을 실행해 주세요" 안내. 어느 모드든 훅 설치는 계속한다.

## 4. 이 세션에 훅 설치
클라우드 컨테이너(Bash 도구)의 `~/.claude/settings.json` 에 병합한다. 다른 설정·훅은 보존한다. 명령 문자열에 `${` 를 쓰지 말 것(훅 변수 치환 문법과 겹침). 파일을 바꾸면 같은 대화에서 바로 적용돼, 이번 답변이 끝날 때부터 펫이 알려준다.
```bash
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.claude/settings.json')
try:
    settings = json.load(open(p, encoding='utf-8'))
except Exception:
    settings = {}
def signal(evt):
    return ('D="$HOME/mnt/ClaudePet/inbox"; [ -d "$D" ] || exit 0; n="$D/$(date +%s%N)-chat"; '
            "printf '%s' '" + json.dumps(evt, ensure_ascii=False) + "' > \"$n.tmp\" && mv \"$n.tmp\" \"$n.json\"; exit 0")
def group(evt):
    return {'hooks': [{'type': 'mcp_tool', 'server': 'remote-devices', 'tool': 'device_bash',
                       'input': {'command': signal(evt)}, 'timeout': 20, 'statusMessage': 'ClaudePet 신호'}]}
hooks = settings.setdefault('hooks', {})
for ev in ('UserPromptSubmit', 'Stop'):
    hooks[ev] = [g for g in hooks.get(ev, []) if 'ClaudePet' not in json.dumps(g, ensure_ascii=False)]
hooks['UserPromptSubmit'].append(group({'event': 'UserPromptSubmit', 'session_id': 'chat', 'stale_ms': 3600000}))
hooks['Stop'].append(group({'event': 'Stop', 'session_id': 'chat', 'message': '답변이 나왔어요! ✓'}))
json.dump(settings, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
assert '${' not in json.dumps(hooks)
print('ok')
PY
```

## 5. 마무리
- 요청 모드: 한두 문장으로, 이 대화에서는 이제 답변이 끝날 때마다 펫이 알려준다고 말한다.
- 자동 모드: 답변 끝에 "🐾 펫 알림 켜짐" 한 줄만, 또는 생략. 본래 요청에 대한 답을 이어서 한다.

## 참고
- 신호 형식: `{"event":"Stop","message":"한 줄"}` (작업 끝), `{"event":"UserPromptSubmit","stale_ms":3600000}` (작업 시작). 10분 넘은 신호는 펫이 무시한다.
- PC 가 꺼지거나 연결이 끊기면 훅은 조용히 실패할 뿐 대화에는 영향이 없다.
- 끄려면 `~/.claude/settings.json` 에서 `ClaudePet` 이 들어간 훅 그룹을 지운다.
