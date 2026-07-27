# 백엔드 작업 명세 — DOCX 내보내기, 흐름도 이미지 여러 장(페이지 분할) 삽입 지원

> 형식은 `A360-Assistant-Frontend/docs/API_명세.md` 스타일을 따름 (AS-IS/TO-BE 구분, 요청·응답
> 스키마·에러 코드를 표/코드블록으로 정리). Jira 키는 아직 없음 — 아래 "작업 순서 제안" 참고.
> 백엔드 리포(`A360-Assistant-Backend`)로 전달할 문서 — 프론트 리포에는 참고용으로만 둔다.

## 배경

`GET/POST .../recommendations/{version}/export/docx`는 프론트가 캔버스에서 캡처한 흐름도 PNG를
`flow_image` 한 장으로 받아 `doc.add_picture(image, width=Inches(6.3))`로 문서에 삽입한다
(RPA-296). 이 호출은 **폭만 고정**하고 높이는 이미지 원본 비율 그대로 따라가는데, MS Word는
**페이지보다 큰 인라인 그림을 다음 페이지로 이어 그려주지 않고 페이지 경계에서 그냥 잘라버린다**
(실측 확인됨 — 자동 페이지 넘김 없음). 그 결과 액션 수가 많은 흐름도는 이미지가 중간에 잘려서
문서에 실린다.

프론트에서 임시로 "스텝을 여러 컬럼으로 재배치해 이미지 한 장을 페이지 비율에 맞게 욱여넣는"
방식으로 우회했지만, 이 방식은 흐름도가 길어질수록 컬럼이 늘고 글자가 작아지는 근본적 한계가
있다. **더 나은 해결책은 흐름도 캡처를 원래 형태(세로 한 줄)로 유지하되, 페이지 분량만큼 여러
장으로 나눠 캡처해서 각 장을 별도 페이지에 순서대로 삽입하는 것** — 이러면 컬럼 재배치 없이도
글자 크기가 항상 일정하고, 페이지 수만 늘어난다. 이 문서는 그 백엔드 쪽 변경 사항을 정의한다.

## 현재 동작 (AS-IS)

### 엔드포인트 — `POST /api/sessions/{session_id}/recommendations/{version}/export/docx`

`app/api/sessions.py:551-618`

```python
@router.post("/{session_id}/recommendations/{version}/export/docx")
async def export_recommendation_docx(
    session_id: str,
    version: int,
    flow_image: UploadFile | None = File(
        None, description="프론트가 캡처한 흐름도 이미지(PNG/JPEG, 선택) — 있으면 문서에 임베드"
    ),
    ...
):
    ...
    image_bytes: bytes | None = None
    if flow_image is not None:
        data = await flow_image.read(_MAX_FLOW_IMAGE_BYTES + 1)   # 8MB 상한
        # 크기·매직바이트 검증 (413 IMAGE_TOO_LARGE / 400 INVALID_IMAGE)
        image_bytes = data
    ...
    content = await run_in_threadpool(
        build_recommendation_docx, row.payload,
        session_id=..., version=..., source=..., exported_at=...,
        flow_image=image_bytes,
    )
```

### 렌더 함수 — `build_recommendation_docx()`

`app/services/recommendation_docx.py:83-165` (관련 부분만)

```python
def build_recommendation_docx(
    payload, *, session_id: str, version: int, source: str | None,
    exported_at: str, flow_image: bytes | None = None,
) -> bytes:
    ...
    doc.add_heading("추천 흐름", level=1)
    if flow_image:
        try:
            doc.add_picture(BytesIO(flow_image), width=Inches(6.3))
            doc.add_paragraph().add_run("흐름도 (편집 화면 기준)").italic = True
        except Exception:
            doc.add_paragraph("(흐름도 이미지를 표시할 수 없습니다.)")
    ...
```

이미지는 항상 **한 장**만 받고, `add_picture` 호출도 **한 번**뿐이다 — 여러 장을 순서대로
넣거나 그 사이에 페이지 나눔을 넣는 경로가 없다.

## 요청 사항 (TO-BE)

1. `flow_image`(단수, `UploadFile | None`) → **`flow_images`(복수, `list[UploadFile]`)** 로
   교체한다. 멀티파트에서 같은 필드명(`flow_images`)을 여러 번 보내면 FastAPI가 자동으로
   리스트에 모아준다 — 프론트는 캡처한 이미지 수만큼 `formData.append("flow_images", blob, ...)`를
   반복 호출하면 된다.
2. `build_recommendation_docx()`의 `flow_image: bytes | None` 파라미터를
   **`flow_images: list[bytes] | None`** 로 바꾼다.
3. "추천 흐름" 섹션에서 이미지를 **순서대로 모두 삽입**하되, **이미지와 이미지 사이에
   `doc.add_page_break()`를 넣어 각 장이 새 페이지에서 시작**하게 한다. 캡션("흐름도 (편집
   화면 기준)")은 마지막 이미지 뒤에 한 번만 붙이거나, 각 장마다 "흐름도 (n/N)"처럼 번호를
   붙여도 됨 — 프론트와 협의해 확정.
4. 이미지가 0장이면 기존과 동일하게 이미지 없이 데이터 문서로 동작(하위 호환 유지).
5. 이미지 1장 이상 N장 이하로 개수 상한을 둔다(권장: 20장 — 아래 에러 코드 참고). 각 장의
   개별 크기 제한(8MB, `_MAX_FLOW_IMAGE_BYTES`)과 PNG/JPEG 매직바이트 검증은 **장마다 동일하게
   적용**한다(기존 로직 재사용, 반복문으로만 감싸면 됨).
6. `GET .../export?format=docx`(이미지 없는 데이터 전용 경로)는 변경 없음 — 이미지 삽입은
   `POST .../export/docx` 경로에만 해당.

## API 계약 변경

### 요청 — `POST /api/sessions/{session_id}/recommendations/{version}/export/docx`

| 필드 | AS-IS | TO-BE |
|---|---|---|
| 흐름도 이미지 | `flow_image`: 단일 파일 파트(선택) | `flow_images`: 파일 파트 0~N개(같은 필드명 반복), 선택 |

요청 예시(TO-BE, curl 기준):

```bash
curl -X POST .../export/docx \
  -F "flow_images=@page1.png;type=image/png" \
  -F "flow_images=@page2.png;type=image/png" \
  -F "flow_images=@page3.png;type=image/png"
```

이미지를 아예 안 보내면(파트 0개) 기존과 동일하게 데이터 문서만 생성 — **바디 없이 POST하는
기존 프론트 코드(`fetchWithAuth(..., { method: "POST" })`, body 없음)는 그대로 호환된다.**

### 응답

변경 없음(`200`, `.docx` 바이너리) — 문서 안에 이미지가 여러 페이지로 나뉘어 들어간다는 점만
달라진다.

### 에러 코드

| HTTP | code | 상황 | 비고 |
|---|---|---|---|
| 413 | `IMAGE_TOO_LARGE` | 이미지 한 장이 8MB 초과 | 기존과 동일, 장마다 개별 검사 |
| 400 | `INVALID_IMAGE` | PNG/JPEG 매직바이트 아님 | 기존과 동일, 장마다 개별 검사 |
| 413 | `TOO_MANY_IMAGES` *(신규)* | 이미지 개수가 상한(예: 20장) 초과 | 메시지: `"흐름도 이미지는 최대 20장까지 첨부할 수 있습니다."` |

## 구현 체크리스트

- [ ] `app/api/sessions.py`: `export_recommendation_docx`의 `flow_image: UploadFile | None`
      파라미터를 `flow_images: list[UploadFile] = File(default=[])`로 교체
- [ ] 이미지 개수 상한(`_MAX_FLOW_IMAGE_COUNT = 20` 등 상수 추가) 검증 → 초과 시
      `413 TOO_MANY_IMAGES`
- [ ] 기존 크기(`_MAX_FLOW_IMAGE_BYTES`)·매직바이트(`_sniff_image_kind`) 검증 로직을 각 파일에
      반복 적용(리스트 컴프리헨션 또는 for 루프) — `UploadFile.read()`/`.close()` 패턴 그대로 재사용
- [ ] `build_recommendation_docx()` 시그니처를 `flow_images: list[bytes] | None = None`으로
      변경, 호출부(`app/api/sessions.py`)도 함께 수정
- [ ] "추천 흐름" 섹션 렌더 로직: 이미지 리스트를 순회하며 `add_picture` + 이미지 사이에만
      `add_page_break()`(마지막 장 뒤에는 넣지 않음 — 바로 이어지는 "1. {step}" 텍스트 섹션과
      한 페이지에 붙어도 무방)
- [ ] 개별 이미지 삽입 실패(깨진 이미지 등)해도 문서 생성 전체가 죽지 않게 이미지 단위로
      try/except 유지(기존 동작 유지, 실패한 장만 안내 문구로 대체)
- [ ] `tests/test_recommendation_export.py` 갱신:
      - `test_export_docx_post_embeds_flow_image`: `files={"flow_image": ...}` →
        `files=[("flow_images", ("flow1.png", ...)), ("flow_images", ("flow2.png", ...))]`
        형태로 바꾸고, `doc.inline_shapes` 개수가 보낸 장 수만큼인지, 두 이미지 사이에
        실제로 페이지 나눔이 들어갔는지(`doc.element.body`에서 `w:br[@w:type='page']` 존재
        확인, 또는 섹션/페이지 나눔 검사 헬퍼 추가) 검증하는 케이스 추가
      - `test_export_docx_post_without_image_is_data_doc`: 파트 0개(bodyless) 케이스 그대로 유지
      - `test_export_docx_post_rejects_non_image`: 여러 장 중 하나만 깨진 경우도 400인지 케이스
        추가
      - 신규: 상한(21장) 초과 시 413 `TOO_MANY_IMAGES` 케이스
- [ ] `app/services/recommendation_docx.py`의 `flow_image` 관련 docstring(RPA-296 참고 주석)
      갱신

## 프론트 연동 예고 (참고용 — 프론트에서 별도 작업)

백엔드 반영 후 프론트(`A360-Assistant-Frontend`)는 다음을 변경할 예정:

- `src/api/recommend.js`의 `downloadRecommendationDocx()`: `flow_image` 1개 blob 대신
  `flow_images` blob 배열을 받아 `FormData.append("flow_images", blob, ...)`를 반복 호출
- `src/flow-window/FlowWindowApp.vue`의 `downloadFlowDocx()`: 흐름도를 페이지 높이 단위로
  잘라 여러 장 캡처(현재의 "여러 컬럼 재배치" 컴팩트 레이아웃 대신, 원래 세로 한 줄 레이아웃을
  유지한 채 Y축으로 N등분해서 각 구간을 별도 캡처)
- 이 변경이 들어가면 `buildFlowGraphForExport`(컬럼 재배치 로직, `src/utils/flowLayout.js`)는
  더 이상 필요 없어져 제거 예정

**백엔드 작업은 이 프론트 변경과 독립적으로 먼저 진행 가능** — `flow_images`가 1장만 와도
정상 동작해야 하므로(리스트 길이 1), 프론트가 아직 안 바뀐 상태에서도 하위 호환된다.

## 작업 순서 제안

1. Jira 키 확보: 세션에 Atlassian MCP 도구가 있으면 새 이슈를 직접 생성(`projectKey: RPA`,
   이슈 유형 `작업`, 제목 예: "DOCX 내보내기 — 흐름도 이미지 여러 장(페이지 분할) 삽입
   지원"), 없으면 팀원에게 Jira 키를 요청한다 (`AGENTS.md` 7장 참고).
2. `dev`에서 `feat/RPA-N-docx-multi-page-flow-image` 브랜치 분기
3. 위 구현 체크리스트 순서대로 진행 — `app/api/sessions.py` → `recommendation_docx.py` →
   테스트
4. 커밋 메시지: `feat(export): DOCX 흐름도 이미지 여러 장·페이지 분할 삽입 지원 (RPA-N)`
   (컨벤션: `AGENTS.md` 참고, scope는 `export`)
5. PR은 `dev` 대상, `.github/PULL_REQUEST_TEMPLATE.md` 구조 준수, 이 문서를 PR 설명에
   링크하거나 요약 인용
