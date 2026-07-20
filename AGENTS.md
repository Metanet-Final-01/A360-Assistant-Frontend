# AGENTS.md — AI 에이전트 작업 가이드

이 리포는 "업무정의서 기반 A360 작업 추천 AI 플랫폼"의 프론트엔드다 (Vue 3 + Vite, Vercel 배포).
AI 도구(Claude Code, Cursor 등)로 이 리포에서 작업할 때 아래 규칙을 따른다.
상세 규칙: [docs/CONVENTIONS.md](docs/CONVENTIONS.md), Jira 연동: [docs/JIRA_GITHUB.md](docs/JIRA_GITHUB.md)

## Git 작업 규칙 (필수)

1. **main·dev에 직접 커밋 금지.** 작업 시작 전 현재 브랜치를 확인하고, main/dev면 반드시 **dev에서 새 브랜치를 분기**한 뒤 작업한다. PR은 **dev를 대상으로** 만든다 (main은 배포용).
2. **브랜치 이름**: `<type>/<Jira키>-<영문-요약>` (예: `feat/RPA-15-chat-message-list`)
   - **Jira 키(RPA-N)를 임의로 지어내지 않는다.** 이슈 트래킹의 원본은 Jira이며, 브랜치는 Jira 이슈가 먼저 있어야 한다. 키를 구하는 방법은 세션에 Atlassian MCP가 있는지에 따라 다르다:
   - **Atlassian MCP 도구(`mcp__atlassian__*`)가 사용 가능하면 → 직접 처리한다**:
     기존 작업이면 JQL로 이슈를 조회하고, 새 작업이면 이슈를 직접 생성한다
     (cloudId: `metanetfinal.atlassian.net`, projectKey: `RPA`, 이슈 유형 이름: `작업`).
     **프론트엔드 작업 이슈에는 반드시 라벨 `frontend`를 붙인다** — Jira Automation이
     이 라벨을 보고 GitHub 미러 이슈를 이 리포(A360-Assistant-Frontend)에 생성한다.
     이슈 생성 후 잠시 기다렸다가 `gh issue list --search "RPA-N in:title"`로 미러 번호를 찾아
     PR 본문의 `Closes #번호`에 쓴다. **GitHub 이슈를 직접 만들지 않는다** (미러와 중복됨).
     Jira 상태 전환도 직접 하지 않는다 — Automation이 브랜치 생성/PR 머지에 반응해 자동 전환한다.
   - **MCP 도구가 없으면 → 사용자에게 Jira 키를 물어본다.** (수동 트랙 팀원 환경 또는 미인증 세션)
   - 두 트랙의 상세 흐름은 [docs/CONVENTIONS.md](docs/CONVENTIONS.md) 7장 참고.
3. **커밋 메시지**: `<type>(<scope>): <한글 제목> (<Jira키>)`
   - type: `feat` `fix` `refactor` `docs` `test` `chore` `ci` `perf` `style`
   - scope(선택): `ui` `chat` `search` `api` `router` `store` `style` `build` `ci`
   - 제목 50자 이내, 본문에는 "왜"를 쓴다. 1 커밋 = 1 논리적 변경.
4. **커밋 전 자가 점검** (어긋나면 스스로 고친 뒤 진행):
   - [ ] 메시지가 위 형식을 따르는가? Jira 키가 포함됐는가?
   - [ ] diff에 시크릿(API 키, 토큰)이나 `.env` 파일이 없는가? (`.env.example`만 허용)
   - [ ] 이번 변경과 무관한 파일이 섞여 있지 않은가?
   - [ ] `console.log`·디버그 코드·임시 주석이 남아 있지 않은가?
5. **PR**: 제목은 커밋 컨벤션과 동일 형식. 머지는 merge commit 방식이라 **개별 커밋 메시지가 dev 히스토리에 그대로 남는다** — 커밋 하나하나 컨벤션을 지킨다.
   본문은 `.github/PULL_REQUEST_TEMPLATE.md` 구조를 따르고, GitHub 미러 이슈가 있으면 `Closes #번호`를 넣는다.
   UI 변경이면 스크린샷을 첨부한다.
6. **push 전 확인**: PR Title Lint와 Secret Scan 워크플로가 통과할 수 있는 상태인지 점검한다.

## 하지 말 것

- `main` 직접 push, `--force` push (작업 브랜치의 `--force-with-lease`만 허용)
- `.env` 커밋, 시크릿 하드코딩 (백엔드 API 주소 등 환경값은 `.env.example`에 키 이름만 추가)
- 사용자 확인 없이 커밋·push·PR 생성 — **커밋/PR 직전에 컨벤션 준수 여부를 요약해서 보여주고 진행한다**
- Jira 키 임의 생성, 컨벤션에 안 맞는 브랜치/커밋을 "일단" 만들기

## 담당 영역

| 영역 | 담당 | AI 작업 가능 여부 |
|---|---|---|
| `src/` 전체 | 프론트엔드 담당 | ✅ 주 작업 영역 |
| 백엔드 API 스키마 (요청/응답 형식) | 백엔드 담당과 합의 | ⚠️ 임의로 가정하지 말고 백엔드 리포 문서 확인 |
| `vercel.json`, 배포 설정 | 인프라·배포 담당 | ⚠️ 수정 시 담당자 리뷰 필수 |
| `.github/`, `docs/` | 공용 (컨벤션 관리) | ✅ |

## 개발 환경 참고

- Node 22+ / Vue 3 + Vite. `npm install` 후 `npm run dev` (기본 5173 포트)
- 백엔드 API: A360-Assistant-Backend 리포 (FastAPI) — 로컬 개발 시 백엔드를 함께 띄우거나 mock 사용
- 배포: Vercel (`vercel.json`) — SPA rewrite 설정 포함
