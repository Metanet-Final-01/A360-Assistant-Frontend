# A360 Assistant Frontend

업무정의서(PDF/PPT/PPTX/DOCX)를 업로드하면 AI가 업무 흐름을 단계별로 분석하고,
Automation 360(A360) 액션으로 구성된 자동화 흐름도를 추천해주는 어시스턴트의 프론트엔드입니다(Vue 3 SPA).

```
업무정의서 업로드 → 분석 결과 확인 → 추천 흐름도 생성 → 캔버스 편집 · 챗봇 대화 수정 → 내보내기(JSON/Markdown/DOCX/이미지)
```

<img width="1835" height="874" alt="A360 Assistant 화면" src="https://github.com/user-attachments/assets/325bf6b4-946d-4414-8d81-739ee670fb00" />

| 영역 | 스택 |
|---|---|
| UI 프레임워크 | Vue 3 · Vite · @vitejs/plugin-vue |
| 상태 관리 | Pinia(화면 상태) + TanStack Query(서버 상태 캐시) |
| 흐름도 시각화 | @vue-flow/core, background/controls, 커스텀 노드·엣지 |
| 네트워킹 · 스트리밍 | fetch + ReadableStream + AbortSignal (백엔드 SSE 소비) |
| 문서 · 내보내기 | FormData 업로드, docx, html-to-image |
| 콘텐츠 렌더링 · 다국어 | markdown-it + DOMPurify, vue-i18n |
| 인증 · 보안 | Bearer JWT + HttpOnly 쿠키, GitLeaks(시크릿 스캔 CI) |
| 배포 · CI | Node.js 22.x, Vercel, GitHub Actions |

## 빠른 시작

**요구사항**: Node.js 22+

```bash
git clone https://github.com/Metanet-Final-01/A360-Assistant-Frontend.git
cd A360-Assistant-Frontend

npm install
npm run dev
```

기본적으로 `http://localhost:8000`의 백엔드([A360-Assistant-Backend](https://github.com/Metanet-Final-01/A360-Assistant-Backend))를 바라봅니다. 다른 백엔드를 쓰려면:

```bash
copy .env.example .env.local
```

`.env.local`에서 값을 수정합니다:

```text
VITE_API_BASE_URL=http://localhost:8000
```

확인: http://localhost:5173

## 시스템 아키텍처

```
브라우저 ──────▶ A360 Assistant Frontend (Vue 3 SPA) ──────▶ A360 Assistant Backend
                 │                                          (REST + SSE,
                 ├─ 뷰 컴포넌트(UI)                            Agent/LLM 오케스트레이션 포함)
                 │   UploadPanel · AnalysisPanel · Chatbot
                 │   AppSidebar · flow-window · 인증/설정 화면
                 │
                 ├─ API 클라이언트(모듈)
                 │   http.js(JWT 로테이션) · auth.js · documents.js
                 │   agent.js(챗/분석/파싱) · sessions.js · recommend.js
                 │
                 ├─ 상태 관리(Pinia Store)
                 │   auth · chat · pipeline(업로드·분석·추천 핵심) · archive · settings
                 │
                 └─ 화면 로직 보조
                     usePanelReorder · flowTree/flowLayout · chatFormat/typewriter
```

- 입력: 업무정의서 선택(파일 업로드) → `POST /api/documents` 계열
- 출력: `POST /api/sessions/{id}/turn`의 SSE `done` 응답(`analysis_result`, `recommendation` 흐름 트리)을 받아 화면 렌더링
- 흐름도 트리 구성·레이아웃, 챗 포맷팅·타이핑 효과 등 화면 전용 로직은 `composables/`·`utils/`로 분리

## 화면 구성

로그인 후 화면은 4개 패널로 구성됩니다 (헤더의 그립을 드래그해 순서를 바꿀 수 있습니다).

| 패널 | 내용 |
|---|---|
| 메뉴바 (사이드바) | 분석 기록 조회·재로드, 기능 소개, 사용자 설정 |
| 업무정의서 업로드 | 파일(PDF·PPT·PPTX·DOCX) 업로드 또는 텍스트 입력으로 분석 시작 |
| 분석·추천 흐름도 상세 | 업무 흐름·근거·입출력·연계 시스템·추천 흐름도를 탭으로 표시 |
| AI 챗봇 (대화형 수정) | 분석·추천 진행 안내, 결과 질의응답, 대화로 흐름도 수정 요청 |

## 주요 기능

- **업무정의서 업로드** — 파일 드래그 앤 드롭 또는 텍스트 직접 입력. 파일 검증 → 콘텐츠 추출 → 업무 흐름 분석(LLM) → 추천 흐름도 생성 4단계 진행 상태를 실시간 표시
- **분석 결과** — 업무 흐름 요약 · 단계별 상세(수정 가능) · 시스템/외부 연계 · 입력/출력 항목 · 원문 근거 5개 관점 제공
- **추천 흐름도** — 패키지별 색상으로 구분된 액션 시퀀스 자동 생성, 단계별 신뢰도·근거·출처 표시, 컨테이너/예외 처리 등 분기 구조 지원, 흐름도 보기로 별도 창에서 확대 확인
- **업무 흐름도 편집 (Vue Flow)** — 드래그 앤 드롭으로 캔버스에서 직접 패키지·액션 추가/수정/삭제, 저장 시 새 버전으로 기록되고 버전 이력에서 되돌리기 가능
- **AI 챗봇** — 자연어로 분석 요청·흐름도 수정·A360 관련 질의, 스트리밍 응답 렌더링, 에이전트 버전 선택, 대화 누적 토큰 게이지 표시 및 대화 압축
- **내보내기** — JSON / Markdown / DOCX / 이미지
- **세션 이력** — 과거 분석·대화 세션을 검색해 다시 불러오면 분석 결과·흐름도·대화·게이지가 그대로 복원

## 상태 관리

Pinia와 TanStack Query로 전역 상태와 서버 상태를 분리해 관리합니다 — 여러 화면이 prop drilling 없이 같은 상태를 읽고 써야 하는 화면 상태는 Pinia, 캐시가 필요한 서버 데이터는 TanStack Query로 나눕니다.

| 스토어 | 역할 |
|---|---|
| `auth` (Pinia) | 로그인 상태 · 사용자 정보 |
| `chat` (Pinia) | 대화 메시지 · 전송 상태 |
| `pipeline` (Pinia, 핵심) | 업로드 · 분석 · 추천 전 과정 상태, undo 스택, 창 간(BroadcastChannel) 동기화 |
| `archive` (Pinia + Query 혼합) | 세션 이력 목록은 `useQuery`/`useMutation` 캐시, 삭제 등 UI 상태는 Pinia |
| `settings` (Pinia) | 언어 · 테마 · 에이전트 버전 |

## 성능 · 품질

[Lighthouse](https://developer.chrome.com/docs/lighthouse)로 Performance·Accessibility·Best Practices·SEO를 정량 측정하며 개선합니다. 예: 로그인 화면 배경 이미지 srcset 추가·재압축, 사이드바 불필요한 강제 리플로우(forced reflow) 제거.

## 배포 (Vercel)

**옵션 A**: Vercel 대시보드에서 이 GitHub 리포지토리를 연결하고 아래 환경 변수를 설정합니다.

**옵션 B**: 포함된 GitHub Actions 워크플로(`.github/workflows/vercel-deploy.yml`)를 사용합니다. 필요한 GitHub Secrets:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
VITE_API_BASE_URL
```

빌드 명령 `npm run build`, 출력 디렉터리 `dist`. Vercel 환경 변수:

```text
VITE_API_BASE_URL=https://your-backend-domain.example.com
```

백엔드 CloudFormation의 `FrontendOrigins`에 최종 Vercel URL을 포함해야 합니다.

## 프로젝트 구조

```
src/
├── main.js, App.vue   앱 진입점 · 로그인 세션 전환 · 패널 레이아웃 조립
├── api/               백엔드 REST/SSE 클라이언트 (http·auth·documents·agent·sessions·recommend)
├── components/        화면 컴포넌트 (UploadPanel · AnalysisPanel · ChatWidget · AppSidebar 등)
│   └── flow-canvas/   추천 흐름도 캔버스 (@vue-flow/core 기반)
├── flow-window/        흐름도를 별도 브라우저 창으로 띄우는 진입점
├── stores/             Pinia 스토어 (auth · chat · pipeline · archive · settings · ui)
├── composables/        화면 로직 보조 (usePanelReorder · useFitTitle · useRecommendationExport)
├── utils/              흐름도 트리/레이아웃 · 챗 포맷팅 · 내보내기 등 순수 함수
├── i18n/               vue-i18n 로케일 (ko/en)
└── assets/             이미지 · 아이콘
```

## 문서

| 문서 | 내용 |
|---|---|
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | 브랜치 · 커밋 · PR 협업 컨벤션 |
| [docs/JIRA_GITHUB.md](docs/JIRA_GITHUB.md) | Jira ↔ GitHub 연동 가이드 |
| [docs/API_명세.md](docs/API_명세.md) | 프론트엔드용 백엔드 API 명세 |
| [AGENTS.md](AGENTS.md) | AI 에이전트 작업 가이드 |

## 환경변수

`.env.example`에 전체 목록이 있습니다. 핵심만:

| 키 | 용도 |
|---|---|
| `VITE_API_BASE_URL` | 백엔드 API 주소 (기본 `http://localhost:8000`) |
