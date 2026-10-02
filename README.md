# ClaudePet 🐾

**Claude Code 가 일하는 동안 화면 구석에서 같이 움직이는 데스크톱 펫.**
Claude 가 생각하고, 코드를 고치고, 허락을 기다리고, 일을 끝내는 순간을 펫이 보여주고 알려줘요.
Codex 펫 패키지와 호환돼서 [codex-pets.net](https://codex-pets.net) 같은 커뮤니티 갤러리의 펫을 그대로 쓸 수 있어요.

> A desktop pet that reacts to Claude Code in real time — thinking, editing, waiting for your approval, done.
> Compatible with Codex pet packages (`pet.json` + `spritesheet.webp`). Windows installer, no Node.js needed.

![미리보기](assets/preview.gif)

## 이런 걸 해요

- **Claude Code 상태에 반응** — 터미널, VS Code, Claude 데스크톱 앱의 Code 탭 등 Claude Code 가 도는 곳이면 어디서든
- **일 끝나면 알려줘요** — "다 했어요! ✓", "허락이 필요해요!" 말풍선으로 다른 창을 보고 있어도 바로 알 수 있어요
- **펫 마음대로 바꾸기** — codex-pets.net 링크 붙여넣기 한 번으로 설치, 가진 GIF 로 새 펫 만들기
- **방해하지 않는 창** — 투명·항상 위, 펫 모양 밖은 클릭이 아래 창으로 통과, 눌러도 터미널 포커스를 안 뺏어요
- **개인정보 안전** — 프롬프트·명령어·파일 내용은 펫으로 보내지 않아요
- 기본 펫 **Mochi(모찌)** 는 이 프로젝트를 위해 새로 그린 오리지널 픽셀아트예요

---

## 설치

### Windows (권장)

1. [**Releases**](https://github.com/juyung861-glitch/ClaudePet-Public/releases/latest) 에서 `ClaudePet-Setup-<버전>.exe` 를 받아 실행
   - "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** (코드 서명이 없는 개인 프로젝트라 뜨는 경고예요)
2. 펫이 나타나고 **"Claude Code 와 연결할까요?"** 를 물으면 **연결하기**
3. 끝! Node.js 나 npm 은 필요 없어요.

- 설치 위치 `%LOCALAPPDATA%\Programs\ClaudePet` (관리자 권한 불필요), 바탕화면·시작 메뉴 바로가기
- 컴퓨터 켤 때 같이 실행: 펫 우클릭 → **컴퓨터 켤 때 같이 실행**
- 지우기: Windows 설정 → 앱 → ClaudePet 제거 (Claude Code 설정에서 ClaudePet 훅만 깔끔하게 빠져요)

### 소스에서 (macOS · Linux · 개발용)

Node.js 18 이상이 필요해요.

```bash
git clone https://github.com/juyung861-glitch/ClaudePet-Public.git
cd ClaudePet-Public
npm install          # Electron 등
npm run setup        # Claude Code 에 훅 · /pet 명령 등록
npm start            # 펫 실행
```

Windows 에서 소스로 쓸 땐 `install-windows.cmd` 를 더블클릭해도 돼요.
PowerShell 에서 `npm.ps1 파일을 로드할 수 없습니다` 오류가 나면 `npm` 대신 `npm.cmd` 를 쓰세요.

---

## 펫이 보여주는 상태

| Claude Code 에서 | 펫 | 말풍선 예 |
| --- | --- | --- |
| 세션 시작 | 손 흔들기 | 안녕! 같이 코딩해요 |
| 프롬프트 보냄 / 도구 실행 중 | **running** (키보드 타닥타닥) | 생각 중… · 코드 고치는 중 · 명령 실행 중 |
| 권한 요청 · 질문 · 계획 확인 | **waiting** | 허락이 필요해요! |
| 응답 끝 | **review** (돋보기 + 체크) → 쉬기 | 다 했어요! ✓ |
| API 오류로 멈춤 | **failed** → 쉬기 | 사용량 한도에 걸렸어요 |
| 서브에이전트 끝 | 점프 | 도우미 복귀! |
| 세션 종료 | 손 흔들기 | 수고했어요! |
| 아무 일 없음 | **idle** (숨쉬기 · 눈 깜빡) | — |

- 세션이 여러 개면 가장 급한 상태(입력 대기 > 오류 > 작업 중 > 완료)를 보여주고, 바쁜 세션이 2개 이상이면 숫자 배지가 붙어요.
- Esc 로 중단하면 Claude Code 가 신호를 보내지 않아서, 5분 동안 소식이 없으면 쉬기로 돌아가요. 오래 걸리는 명령은 그 명령의 timeout 만큼 기다려요.

## 조작

| 동작 | 결과 |
| --- | --- |
| 드래그 | 펫 옮기기 (끌면 달리고, 놓으면 점프) |
| 클릭 | 인사 + 한마디 |
| 더블클릭 | 지금 세션 상태 |
| 우클릭 · 트레이 아이콘 우클릭 | 펫 바꾸기, 크기, 말풍선, 동작 미리보기, Claude Code 연결, 종료 … |
| 트레이 아이콘 클릭 | 숨기기 / 보이기 |

메뉴에서 **종료**하면 다음 Claude Code 세션이 시작될 때까지 다시 뜨지 않아요.

## `/pet` 명령 (Claude Code 안에서)

```
/pet                      펫 띄우기
/pet list                 쓸 수 있는 펫 목록
/pet use <펫id>            펫 바꾸기
/pet install <링크|이름>    codex-pets.net 펫 받아서 바로 적용 (비워 두면 입력 창이 열림)
/pet search <검색어>        codex-pets.net 에서 찾기
/pet import <GIF경로>       GIF 로 새 펫 만들기
/pet size 크게              작게 | 보통 | 크게 | 아주크게 | 0.2~2
/pet bubbles important     말풍선: all | important | off
/pet test                  모든 동작 미리보기 (/pet test waving 처럼 하나만도 가능)
/pet stop                  끄기
/pet doctor                설치 상태 점검
```

터미널에서는 설치 폴더의 `claude-pet.cmd <명령>`(설치판) 또는 `node cli.js <명령>`(소스판)으로 같은 명령을 쓸 수 있어요.

---

## 펫 바꾸기

### codex-pets.net 에서 받기

1. 갤러리에서 마음에 드는 펫 페이지 주소(`https://codex-pets.net/#/pets/<id>`)나 설치 명령(`npx codex-pets add <id>`)을 복사
2. 펫 우클릭 → **펫 바꾸기 → 링크·이름으로 펫 받기…** → 붙여넣고 **받기**
   - 주소를 복사해 둔 상태면 메뉴에 **복사한 펫 받기: <id>** 가 바로 떠요
   - Claude Code 에서는 `/pet install <주소 또는 id>`

사이트에서 Download 로 받은 `*.codex-pet.zip` 은 우클릭 → **파일로 펫 추가…** 로 넣으면 돼요.
받은 펫은 `~/.claude/pets/<id>/` 에 저장되고 9가지 동작이 모두 그대로 나와요 (v2 펫은 쉬는 동안 마우스도 바라봐요).

### Codex 펫 그대로 쓰기

`~/.codex/pets/` 에 이미 설치한 Codex 펫은 자동으로 목록에 나와요. 새 펫은 `~/.claude/pets/<펫id>/` 에 넣으세요.

```
~/.claude/pets/my-pet/
├── pet.json
└── spritesheet.webp
```

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "내가 만든 펫",
  "spritesheetPath": "spritesheet.webp",
  "spriteVersionNumber": 1
}
```

스프라이트시트 규격 (Codex 펫과 같음):

| 행 | 동작 | 프레임 |
| --- | --- | --- |
| 0 | idle | 6 |
| 1 | running-right | 8 |
| 2 | running-left | 8 |
| 3 | waving | 4 |
| 4 | jumping | 5 |
| 5 | failed | 8 |
| 6 | waiting | 6 |
| 7 | running | 6 |
| 8 | review | 6 |
| 9–10 | (v2) 16방향 시선 | 8 + 8 |

v1 은 1536×1872(8열×9행), v2 는 1536×2288(8열×11행), 셀은 192×208 이에요. 같은 id 가 여러 곳에 있으면 `~/.claude/pets` > `~/.codex/pets` > 기본 펫 순서로 써요.

### GIF 로 펫 만들기

움직이는 이미지(GIF · APNG · 움직이는 WebP)를 바로 펫으로 만들 수 있어요.
펫 우클릭 → **펫 바꾸기 → 파일로 펫 추가…**, 또는 `/pet import <파일> --name 내펫`

- 프레임과 프레임 시간 유지 (최대 64프레임), 단색 배경은 자동으로 투명하게 (`--keep-bg` 로 끄기), 빈 여백 자르기
- GIF 하나로 모든 상태를 표현하고, 상태는 작은 아이콘(⌨️ ❓ ✅ ⚠️)과 움직임으로 구분해요
- 상태별 GIF 도 넣을 수 있어요: `/pet import typing.gif --state running` (메뉴: **이 펫에 상태별 GIF 추가**)

### 나만의 펫 그리기

기본 펫 Mochi 는 `tools/make_mochi.py` 로 그렸어요. 색이나 모양을 바꾸고 `npm run make-pet` (Python + Pillow) 하면 다시 만들어져요.

> **펫 그림의 권리는 그린 사람에게 있어요.** 갤러리나 인터넷에서 받은 펫 · GIF 는 개인적으로 즐기고, 다시 배포할 땐 원작자 허락을 받으세요. 이 저장소에는 기본 펫 Mochi 외에 다른 사람의 그림을 넣지 않아요.

---

## Claude 채팅과 연결하기 (선택)

claude.ai · Claude 데스크톱 앱의 일반 채팅은 클라우드에서 돌아서 PC 의 Claude Code 훅이 울리지 않아요.
대신 대화가 PC 에 연결돼 있으면, Claude 가 `~/ClaudePet/inbox/` 폴더에 신호 파일을 남겨 펫을 움직일 수 있어요.
그 대화에 `~/ClaudePet` 폴더를 연결하고 "답변 끝나면 펫한테 알려줘" 라고 부탁해 보세요. (펫 우클릭 → **클라우드 신호 폴더 열기**)

| 신호 파일 내용 | 펫 |
| --- | --- |
| `{"event":"UserPromptSubmit","stale_ms":3600000}` | 작업 중 (최대 1시간 유지) |
| `{"event":"Stop","message":"한 줄 요약"}` | 그 문장을 말하며 "다 했어요" |

`claude-pet signal done 끝났다!` 처럼 직접 시험할 수 있어요. 펫은 신호를 읽자마자 지우고, 10분이 넘은 신호는 무시해요.

---

## 설정 — `~/.claude/claude-pet/config.json`

대부분 메뉴나 `/pet` 으로 바꿀 수 있어요. 직접 고쳤다면 메뉴의 **목록 새로고침**으로 반영돼요.

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `petId` | `"mochi"` | 사용할 펫 |
| `scale` | `0.5` | 크기 (192×208 기준 배율, 0.2~2) |
| `bubbles` | `"all"` | `all` / `important`(권한·완료·오류만) / `off` |
| `language` | `"ko"` | 말풍선·메뉴 언어 `ko` / `en` |
| `autoStart` | `true` | Claude Code 세션이 시작되면 자동 실행 |
| `quitWhenNoSessions` | `false` | 마지막 세션이 끝나면 펫도 종료 |
| `lookAtCursor` | `true` | v2 펫이 쉬는 동안 마우스를 바라봄 |
| `runningTimeoutSec` | `300` | 소식 없이 이 시간이 지나면 '작업 중' 해제 |
| `port` | `47321` | 훅↔펫 통신 포트 (127.0.0.1 전용) |
| `extraPetDirs` | `[]` | 펫을 더 찾을 폴더 |
| `animationDurations` | `{}` | 프레임 시간 덮어쓰기, 예: `{"idle": [1200,500,500,600,600,1500]}` |

## 동작 원리

```
Claude Code ──(훅: SessionStart · PreToolUse · Stop …)──▶ hook.js
                                                          │ 상태에 필요한 최소 정보만
                                                          ▼
                                    127.0.0.1:47321  ClaudePet (Electron)
                                                          │ 상태 엔진 → 애니메이션 · 말풍선
                                                          ▼
                                                투명한 항상-위 펫 창
```

- 훅은 백그라운드로 돌아서 Claude Code 속도에 영향이 없고, 표준출력에 아무것도 쓰지 않아요 (Claude 의 컨텍스트를 건드리지 않음).
- 펫이 꺼져 있으면 세션 시작 · 프롬프트 제출 때 자동으로 띄워요.
- **개인정보**: 펫으로는 이벤트 종류, 도구 이름, 세션 id 만 가요. 프롬프트 · 명령어 · 파일 내용 · 파일 이름은 보내지 않아요. 서버는 `127.0.0.1` 에서만 열리고 브라우저 페이지가 보내는 요청은 거부해요.

## 문제 해결

| 증상 | 해결 |
| --- | --- |
| 펫이 안 나타남 | `/pet doctor` (또는 `claude-pet doctor`) 결과 확인 |
| Claude Code 에 반응이 없음 | 펫 우클릭 → **Claude Code 와 연결** 이 켜져 있는지 확인 |
| 소스판 폴더를 옮긴 뒤 반응 없음 | `npm run setup` 다시 실행 |
| 포트 충돌 | `config.json` 의 `port` 를 바꾸고 펫 재시작 |
| 리눅스에서 배경이 검게 보임 | 투명 창을 지원하는 컴포지터가 필요해요 (GNOME · KDE 등) |

로그: `~/.claude/claude-pet/claude-pet.log`

---

## 개발

```bash
npm test             # 상태 엔진 · 펫 로더 · 설치/제거 · 훅→서버 · GIF/갤러리 테스트
npm start            # 펫 실행
npm run dist:win     # Windows 설치 파일 (dist/ClaudePet-Setup-x.y.z.exe)
```

`package.json` 의 `version` 을 올려 `main` 에 푸시하면 GitHub Actions 가 Windows 설치 파일을 만들어 [Releases](https://github.com/juyung861-glitch/ClaudePet-Public/releases) 에 자동으로 올려요.

```
ClaudePet/
├── hook.js              Claude Code 훅 진입점
├── cli.js               /pet 명령 · 터미널 CLI
├── scripts/             Claude Code 훅 설치 · 제거
├── src/main.js          Electron 메인 (창 · 트레이 · 메뉴 · 로컬 서버)
├── src/renderer/        스프라이트 재생 · 클릭 통과 · 드래그 · 말풍선
├── src/core/            상태 엔진 · 펫 탐색 · 아틀라스 · 갤러리 · 신호함 · 설정
├── src/import.js        GIF → 펫 (src/importer/ 숨은 창에서 디코딩)
├── src/prompt/          링크로 펫 받기 창
├── build/               설치 파일 설정 · 아이콘
├── pets/mochi/          기본 펫
├── tools/make_mochi.py  기본 펫 생성기
└── test/
```

버그 제보와 아이디어는 [Issues](https://github.com/juyung861-glitch/ClaudePet-Public/issues) 에 남겨 주세요.

## 라이선스 · 고지

- 코드와 기본 펫 Mochi: [MIT License](LICENSE)
- 이 프로젝트는 개인이 만든 비공식 프로젝트로, **Anthropic · OpenAI 와 관련이 없어요.** Claude 와 Claude Code 는 Anthropic 의 상표이고, Codex 는 OpenAI 의 상표예요.
- [codex-pets.net](https://codex-pets.net) 은 별도의 커뮤니티 사이트예요. ClaudePet 은 공개된 다운로드 주소로 펫 패키지를 받아 올 뿐이고, 각 펫의 권리는 만든 사람에게 있어요.
- 설치 파일에는 [Electron](https://www.electronjs.org/) (MIT) 과 Chromium 이 포함되며, 해당 라이선스 문서가 설치 폴더에 함께 들어 있어요.
