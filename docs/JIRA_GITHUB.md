# Jira ↔ GitHub 연동 가이드 (프론트엔드)

> Jira 사이트: `metanetfinal.atlassian.net` / 프로젝트 키: **RPA** (백엔드와 같은 프로젝트 사용)
> 연동 원리·전체 설정 절차의 원본 기록은 **백엔드 리포 `docs/JIRA_GITHUB.md`** 다.
> 이 문서는 프론트엔드 리포 관점에서 "무엇이 그대로 되고, 무엇이 추가로 필요한지"만 기록한다.

## 설정 없이 이미 동작하는 것

GitHub for Jira 앱이 `Metanet-Final-01` **조직 단위**로 연결되어 있어서, 이 리포에서도:

1. 브랜치명/커밋 메시지/PR 제목에 `RPA-N`이 있으면 → Jira 이슈의 **개발 패널**에 자동 링크
2. 스마트 커밋 (`#comment`, `#time`, `#done`) 사용 가능
3. **규칙 A**: 브랜치 생성 → Jira 이슈 In Progress 자동 전환
4. **규칙 B**: PR 머지 → Jira 이슈 Done 자동 전환

규칙 A/B는 Jira 프로젝트 레벨 Automation이라 리포를 구분하지 않는다 — 추가 설정 불필요.

> 확인 사항: Jira 설정 → 앱 → GitHub 에서 조직 연결이 "All repositories"인지 확인.
> 특정 리포만 선택되어 있다면 `A360-Assistant-Frontend`를 추가해야 위 1~4가 동작한다.

## 추가 설정이 필요한 것 — GitHub 미러 이슈 (규칙 C/D)

규칙 C(Jira 이슈 생성 → GitHub 이슈 생성)와 규칙 D(Jira Done → GitHub 이슈 닫기)는
웹 요청 URL에 **백엔드 리포가 하드코딩**되어 있다. 같은 RPA 프로젝트에서
백/프론트 이슈를 함께 쓰므로, **미러를 어느 리포에 만들지 라벨로 구분**한다.

### 라우팅 규칙

- Jira 이슈에 라벨 **`frontend`** 가 있으면 → 미러를 `A360-Assistant-Frontend`에 생성/닫기
- 라벨이 없으면 → 기존대로 `A360-Assistant-Backend`에 생성/닫기

### 1. GitHub 토큰 확인

- **Classic PAT (`repo` scope) 사용 중**: 토큰 자체는 계정이 접근 가능한 모든 리포에 적용되므로 수정 불필요.
  토큰 소유 계정이 `A360-Assistant-Frontend`에 쓰기 접근 권한이 있는지만 확인한다.
- Fine-grained PAT로 교체하는 경우에만 Repository access에 프론트 리포를 추가한다 (Issues → Read and write).

### 2. 규칙 C — If/Else 분기 추가 (규칙 1개 유지)

Trigger(`업무 항목 만들어짐`)와 기존 웹 요청 사이에 `업무 항목 필드 조건`(If)을 추가한다.
**기존 백엔드 액션들이 If의 참(true) 경로에 이미 놓여 있으므로, 조건은 "frontend가 없으면"으로 잡는다** —
그러면 기존 액션을 옮길 필요가 없다.

**If 조건 설정**:

- 필드: `레이블`
- 조건: **포함하지 않음** 계열 옵션 (예: "다음 중 어느 것도 포함하지 않음")
- 값: `frontend`

**참 경로 (조건 통과 = 백엔드 이슈)** — 기존 액션 그대로:

- 웹 요청 POST → `.../A360-Assistant-Backend/issues`
- 업무 항목 필드 편집 → `GitHub Issue Number` = `{{webResponse.body.number}}`

**Else 분기 추가 (frontend 라벨 이슈)**:

1. If 카드에서 **Else 추가** (If 카드 선택 시 나오는 분기 추가 버튼 또는 카드 아래 `+`)
2. Else 안에 기존 웹 요청 카드를 **복제**(카드의 복사 아이콘)해서 넣고 URL만 변경:
   `https://api.github.com/repos/Metanet-Final-01/A360-Assistant-Frontend/issues`
   (Method/Headers/Body/"Delay execution..." 체크는 백엔드 것과 동일)
3. `업무 항목 필드 편집`(GitHub Issue Number 저장)도 복제해서 Else 안 웹 요청 뒤에 배치

### 3. 규칙 D — 동일한 If/Else 패턴

- Trigger(`Done으로 전환`)와 `GitHub Issue Number` 비어있지 않음 조건은 그대로
- 그 뒤에 If(`레이블` 포함하지 않음 `frontend`) 추가 → 기존 백엔드 PATCH가 참 경로에 남음
- **Else 추가** → PATCH 웹 요청 복제 후 URL 변경:
  `https://api.github.com/repos/Metanet-Final-01/A360-Assistant-Frontend/issues/{{issue.GitHub Issue Number}}`

## 운영 흐름 요약 (프론트엔드 작업)

```
Jira 이슈 생성 (RPA-15, 라벨: frontend)
  └→ [규칙 C·frontend 분기] 이 리포에 GitHub 이슈 #N 자동 생성
브랜치 생성: feat/RPA-15-chat-message-list
  └→ [규칙 A] Jira: In Progress
커밋: "feat(chat): 메시지 목록 렌더링 (RPA-15)"
  └→ Jira 개발 패널에 커밋 링크
PR 생성 (제목에 RPA-15, 본문에 Closes #N, base: dev)
  └→ Jira 개발 패널에 PR 링크
PR 머지
  ├→ [규칙 B] Jira: Done
  ├→ [규칙 D·frontend 분기] GitHub 이슈 #N 닫힘
  └→ GitHub 네이티브: Closes #N로도 닫힘
```

## 트러블슈팅

- **미러 이슈가 백엔드 리포에 생겼다**: Jira 이슈에 `frontend` 라벨을 빼먹은 경우. 라벨을 추가해도 이미 생성된 미러는 옮겨지지 않으므로, 백엔드 미러를 수동으로 닫고 필요 시 프론트에 다시 만든다
- **웹 요청 401/403**: 토큰에 프론트 리포 권한이 없는 경우. Automation → Audit log에서 응답 코드 확인
- **개발 패널에 안 뜸**: Jira 키 대소문자 확인 (`RPA-15`, 소문자는 인식 안 될 수 있음)
- 그 외 공통 이슈는 백엔드 리포 `docs/JIRA_GITHUB.md` 트러블슈팅 참고
