# 프론트엔드용 API 명세

백엔드에 **지금 구현되어 있는 API**와 **아직 없는 API(예정)** 를 나눠 정리한 문서.
프론트는 이 문서 기준으로 "지금 붙일 수 있는 것"과 "목업으로 대기할 것"을 구분하면 된다.

- 로컬 백엔드: `http://localhost:8000` (FastAPI, 자동 문서 `GET /docs` 에서 실제 스키마 확인 가능)
- CORS: `http://localhost:5173`, `http://127.0.0.1:5173` 및 Vercel 배포 도메인 허용됨
- 인증: 현재 없음 (전 구간)

## 공통 에러 형식

모든 4xx/5xx 응답은 FastAPI 표준으로 `detail` 안에 `{code, message}`가 들어간다.

```json
{
  "detail": { "code": "INVALID_FILE_TYPE", "message": "지원하지 않는 형식입니다: .docx (PDF/PPTX만 가능)" }
}
```

`message`는 그대로 사용자에게 보여줘도 되는 한국어 문구다. 분기가 필요하면 `code`로 한다.

---

## 1. ✅ 구현 완료 — 지금 연동 가능

### 1-1. 헬스체크 / 연결 확인

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/` | 서비스 상태 `{service, environment, status}` |
| GET | `/api/health` (= `/health`) | `{"status": "healthy"}` |
| GET | `/api/message` | 프론트-백 연결 확인용 |
| POST | `/api/echo` | 연결 테스트. body `{"message": "hi"}` → `{"received", "reply"}` |

### 1-2. 문서 업로드 — `POST /api/documents`

업무정의서 업로드. **검증 → 저장 → 파싱까지 동기로 한 번에** 처리되고 결과가 바로 응답으로 온다.
(별도 파싱 폴링 불필요 — 응답의 `status`가 최종 상태)

- 요청: `multipart/form-data`
  - `file` (필수): PDF 또는 PPTX, 기본 최대 20MB
  - `session_id` (선택): 기존 세션에 추가 업로드할 때. 없으면 새 세션이 자동 생성됨
- 응답: `201 Created`

```json
{
  "id": "0b3f...-uuid",
  "session_id": "77aa...-uuid",
  "filename": "업무정의서.pdf",
  "size_bytes": 1048576,
  "status": "parsed",
  "error": null,
  "page_count": 12,
  "warnings": ["3페이지에 추출된 텍스트가 없습니다 (이미지 페이지 가능성)"],
  "created_at": "2026-07-06T09:00:00+00:00"
}
```

- `status` 값: `uploaded` → `parsing` → `parsed` | `failed`
  - `failed`여도 HTTP는 201이다. 파싱 실패는 `status: "failed"` + `error` 문구로 판단할 것
- `session_id`는 이후 모든 기능(분석·추천·챗봇)의 키가 되므로 프론트 상태에 보관 필요
- `warnings`는 사용자에게 안내 배너 등으로 노출 권장 (이미지 위주 문서 감지)

**에러 코드:**

| HTTP | code | 상황 |
|---|---|---|
| 400 | `INVALID_FILE_TYPE` | PDF/PPTX 외 확장자 |
| 400 | `EMPTY_FILE` | 빈 파일 |
| 400 | `FILE_TYPE_MISMATCH` | 확장자와 실제 형식 불일치 (매직바이트 검사) |
| 400 | `SUSPICIOUS_FILE` | PDF 내 JavaScript/실행 요소, 매크로 포함 PPTX 등 |
| 400 | `CORRUPTED_FILE` | 손상된 PPTX |
| 413 | `FILE_TOO_LARGE` | 20MB 초과 |
| 404 | `SESSION_NOT_FOUND` | 전달한 `session_id`가 존재하지 않음 |

### 1-3. 문서 상태 조회 — `GET /api/documents/{document_id}`

업로드 응답과 동일한 형태의 메타데이터·상태를 반환. (새로고침 후 재조회 용도)

- 400 `INVALID_ID` (UUID 형식 아님), 404 `NOT_FOUND`

### 1-4. 파싱 결과 조회 — `GET /api/documents/{document_id}/content`

파싱된 구조화 JSON. 문서 미리보기/디버그 용도이며, 분석(FR-05)의 입력이 되는 데이터.

```json
{
  "id": "0b3f...-uuid",
  "parsed_content": {
    "parser": "pypdf",
    "page_count": 12,
    "pages": [
      { "page": 1, "blocks": [
        { "type": "text", "text": "..." },
        { "type": "table", "rows": [["헤더1", "헤더2"], ["값1", "값2"]] }
      ]}
    ],
    "full_text": "LLM 입력용 전체 텍스트",
    "warnings": []
  }
}
```

- `blocks[].type`: `text` | `table` | `notes`(PPTX 발표자 노트) | `vision_text`(비전 보강분)
- 409 `NOT_PARSED`: 아직 파싱 전이거나 실패한 문서

### 1-5. RAG 검색 — `GET /api/rag/search?q=엑셀 셀 입력&limit=5`

A360 패키지/액션 지식베이스 벡터 검색. (내부/디버그 성격 — 최종 UI에 필수는 아님)

```json
{ "query": "엑셀 셀 입력", "results": [ { "source_type": "action_schema", "package_name": "Excel_MS", "title": "...", "content": "...", "score": 0.91, "url": "..." } ] }
```

- 503: 임베딩 설정 오류 또는 DB 연결 실패

---

## 2. 🔨 개발 중 — 곧 머지 (현재 브랜치)

### 2-1. 비전 보강 — `POST /api/documents/{document_id}/enrich-vision`

이미지 중심 문서(스캔본, 화면 캡처 위주 PPT)의 텍스트 부족 페이지를 비전 LLM으로 읽어서 파싱 결과에 보강.

- 요청 body 없음
- 응답: 문서 메타데이터(1-2와 동일) + `vision` 필드

```json
{
  "id": "...", "status": "parsed", "...": "...",
  "vision": { "enriched_pages": [3, 7] }
}
```

- 보강할 페이지가 없으면 `"vision": {"enriched_pages": [], "skipped": "보강이 필요한 페이지 없음"}`
- 409 `NOT_PARSED`: 파싱 완료 문서에만 호출 가능
- 503 `LLM_UNAVAILABLE`: LLM 키 미설정 등
- LLM 호출이 포함되므로 **수 초~수십 초 걸릴 수 있음** — 로딩 UI 필요
- 프론트 UX 제안: 업로드 응답의 `warnings`에 "텍스트 없는 페이지" 경고가 있으면 이 API 호출 버튼/자동 호출

---

## 3. ⬜ 미구현 — 예정 (프론트는 목업으로 대기)

아래는 DB 모델·JSON 스키마·SSE 규약까지는 확정되어 있고 **엔드포인트만 아직 없는 것들**.
경로는 잠정안이므로 구현 시 변경될 수 있다 (변경되면 이 문서 갱신).

| 기능 (FR) | 잠정 엔드포인트 | 방식 |
|---|---|---|
| 문서 분석 — 업무 단계/입출력/시스템/분기 식별 (FR-05) | `POST /api/sessions/{id}/analyze` | SSE 스트림 |
| 추천안 생성 — A360 액션 매핑 (FR-09~12) | `POST /api/sessions/{id}/recommend` | SSE 스트림 |
| 챗봇 질의응답·추천 수정 (FR-13~16) | `POST /api/sessions/{id}/chat` | SSE 스트림 |
| 추천안 버전 목록/조회 (undo 지원) | `GET /api/sessions/{id}/recommendations` | JSON |
| 드래그 편집 저장 (FR-18) | `POST /api/sessions/{id}/recommendations` (새 버전 생성) | JSON |
| 세션 목록/이력 (FR-20) | `GET /api/sessions` | JSON |
| 피드백 제출 (추가기능) | `POST /api/recommendations/{id}/feedback` | JSON |
| 내보내기 (FR-17) | `GET /api/sessions/{id}/export` | 파일 다운로드 |
| 민감정보 마스킹 (FR-06~07) | 업로드 파이프라인에 통합 예정 | — |

### 3-1. SSE 이벤트 규약 (확정) — 프론트가 미리 준비할 수 있는 부분

분석/추천/챗봇 스트림은 전부 `text/event-stream`으로 아래 단일 규약을 쓴다.
`data:` 라인에 JSON 한 건씩 오고, **`event` 필드로 분기**하면 된다.

| event | 의미 | 사용할 필드 |
|---|---|---|
| `stage` | 처리 단계 진입 (진행바/스피너 문구 교체) | `stage`(기계용 키), `message`(표시용 문구) |
| `partial` | 중간 산출물 (단계 하나 완료분 등 — 점진 렌더링) | `data` |
| `token` | 챗봇 답변 텍스트 조각 (타자 효과) | `message` |
| `done` | 완료 | `data` (최종 산출물) |
| `error` | 실패 | `message` (사용자용 문구) |

```
data: {"event":"stage","stage":"searching","message":"관련 A360 액션 검색 중"}
data: {"event":"partial","data":{"step_id":"step-1","actions":[...]}}
data: {"event":"done","data":{"recommendation":{...}}}
```

`stage` 키 값: `parsing` | `masking` | `analyzing` | `searching` | `recommending` | `refining`

### 3-2. 분석 결과 JSON (확정 스키마 — `AnalysisResult`)

분석 완료 시 `done.data`로 오게 될 형태. 단계별 카드 UI의 데이터 모델로 미리 써도 됨.

```json
{
  "schema_version": "1.0",
  "document_title": "금 시세 조회 후 결과 발송",
  "summary": "비개발자용 한 문단 요약",
  "steps": [
    {
      "step_id": "step-1",
      "order": 1,
      "name": "금 시세 내역 엑셀 가공",
      "description": "...",
      "inputs": ["금 시세 표 (웹)"],
      "outputs": ["시세 엑셀 파일"],
      "systems": ["Edge", "Excel"],
      "branching": "최근 3일치만 반복",
      "evidence": { "page": 2, "snippet": "문서 원문 발췌" }
    }
  ],
  "ambiguities": ["문서만으로 확정 못 한 항목 — 챗봇 재질의 후보"]
}
```

### 3-3. 추천안 JSON (확정 스키마 — `Recommendation`)

추천/챗봇 수정의 산출물이자 흐름도(FR-18) 렌더링 데이터. 핵심 구조:

```
steps[]               ─ 업무 단계 (step_id로 분석 결과와 연결)
 └─ actions[]         ─ A360 액션 시퀀스 (order 순 실행)
     ├─ parameters[]  ─ 액션 설정값
     └─ children[]    ─ Loop/If 컨테이너의 본문 (재귀 트리 — 흐름도는 이 트리를 그대로 그림)
+ variables[]          ─ 봇 변수 (단계 간 데이터 전달)
+ notes                ─ 전제·주의사항
```

액션 하나의 예 (UI에 쓸 필드: `label` 표시, `rationale`+`sources`는 "왜 이 액션?" 펼침, `confidence`는 신뢰도 뱃지):

```json
{
  "order": 1,
  "package": "Browser", "action": "OpenBrowser", "label": "브라우저 열기",
  "parameters": [{ "name": "url", "value": "https://finance.naver.com", "value_source": "llm" }],
  "rationale": "네이버 증권 접속 단계이므로 Browser 패키지로 페이지를 연다",
  "sources": [{ "source_type": "action_schema", "title": "Browser: 열기", "score": 0.91 }],
  "confidence": 0.95,
  "children": []
}
```

전체 예시는 [docs/INTERFACES.md](INTERFACES.md) 2.1절 참고.

---

## 4. 프론트 작업 순서 제안

1. **지금**: 업로드 화면 ↔ 1-2/1-3/1-4 실연동 (상태·에러 코드 처리 포함), `session_id` 상태 관리
2. **지금**: SSE 파서 유틸 + `stage`/`partial`/`token`/`done`/`error` 분기 컴포넌트를 규약(3-1) 기준으로 선작업
3. **지금**: 분석 결과 화면·추천안 흐름도를 3-2/3-3 스키마의 목업 JSON으로 개발
4. **백엔드 머지 후**: 잠정 엔드포인트를 실제 경로로 교체
