<script setup>
import { computed, defineAsyncComponent, h, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "./stores/auth";
import { useChatStore } from "./stores/chat";
import { usePipelineStore } from "./stores/pipeline";
import { useArchiveStore } from "./stores/archive";
import { useSettingsStore } from "./stores/settings";
import LoginPage from "./components/LoginPage.vue";
// 상단 헤더는 로그인 후 화면의 뼈대라 청크를 쪼개면 매 로그인마다 헤더가 한 박자 늦게
// 나타나며 본문이 밀린다. 무거운 의존성이 전혀 없으므로(스토어·i18n은 이미 메인 청크에 있다)
// 아래 패널들과 달리 정적 임포트로 둔다.
import AppHeader from "./components/AppHeader.vue";
import AppActionBar from "./components/AppActionBar.vue";
import { ANALYSIS_PANEL_ORDER_KEY, usePanelReorder } from "./composables/usePanelReorder";

// 로그인 전 방문(비로그인 최초 진입)이 가장 흔한 콜드 스타트 경로다 — LoginPage는 위처럼
// 정적 임포트로 메인 청크에 포함시켜 별도 로딩 라운드트립 없이 바로 그린다. 반대로 로그인
// 후에만 쓰는 화면(가입/튜토리얼/설정)과 분석 화면 본체(사이드바·업로드·분석·챗)는 로그인 전
// 첫 로딩(번들 크기·파싱 시간)에 전혀 필요 없으므로 별도 청크로 미룬다 — 특히 ChatWidget은
// markdown-it+dompurify를 끌고 와 무거워 비로그인 방문자에게 그 비용을 지우지 않는다.
const SignupPage = defineAsyncComponent(() => import("./components/SignupPage.vue"));
const TutorialOverlay = defineAsyncComponent(() => import("./components/TutorialOverlay.vue"));
const SettingsOverlay = defineAsyncComponent(() => import("./components/SettingsOverlay.vue"));

// 청크 로딩 중·실패 시 자체 폴백 UI를 렌더한다 — 없으면 그 자리가 그냥 빈 채로 남는데,
// 이 넷(사이드바/업로드/분석/챗)은 로그인 후 화면의 본체라 그러면 앱이 통째로 먹통처럼
// 보인다. 배포 직후 브라우저가 옛 index.html로 새 해시의 청크를 찾는 경우처럼 재요청으로
// 해결되는 실패도 있어 몇 번은 자동 재시도하고, 그래도 안 되면 새로고침을 안내한다.
function ChunkLoadingFallback() {
  return h(
    "div",
    { class: "chunk-fallback", role: "status", "aria-live": "polite", "aria-label": t("app.chunkLoading") },
    [h("div", { class: "analyzing-state__spinner" })],
  );
}

function ChunkErrorFallback() {
  return h("div", { class: "chunk-fallback chunk-fallback--error", role: "alert" }, [
    h("p", t("app.chunkLoadError")),
    h(
      "button",
      { type: "button", class: "btn btn--outline", onClick: () => window.location.reload() },
      t("app.chunkLoadRetry"),
    ),
  ]);
}

function lazyPanel(loader) {
  return defineAsyncComponent({
    loader,
    loadingComponent: ChunkLoadingFallback,
    errorComponent: ChunkErrorFallback,
    delay: 200,
    timeout: 15000,
    onError(error, retry, fail, attempts) {
      if (attempts <= 2) retry();
      else fail();
    },
  });
}

const AppSidebar = lazyPanel(() => import("./components/AppSidebar.vue"));
const UploadPanel = lazyPanel(() => import("./components/UploadPanel.vue"));
const AnalysisPanel = lazyPanel(() => import("./components/AnalysisPanel.vue"));
const ChatWidget = lazyPanel(() => import("./components/ChatWidget.vue"));

const auth = useAuthStore();
const chat = useChatStore();
const pipeline = usePipelineStore();
// archive는 TanStack useQuery를 쓰므로 반드시 컴포넌트 setup(주입 컨텍스트) 안에서 처음
// 생성돼야 한다. 지금까지는 AppSidebar가 먼저 setup되며 우연히 그 조건을 만족했지만,
// AppSidebar·ChatWidget 둘 다 비동기 컴포넌트라 해석 순서가 보장되지 않는다 —
// pipeline.solution(RPA-286)이 archive를 읽으므로 여기서 명시적으로 만들어 순서 의존을 끊는다.
useArchiveStore();
// 앱 부팅 시 locale/theme(다크모드)·에이전트 버전 목록 초기화 보장 — App.vue가 가장 이른 진입점
const settings = useSettingsStore();
const { t } = useI18n();

// 분석 화면 패널(업로드/분석 결과/도킹 챗봇) 배치 순서 — 헤더 그립 드래그로 변경.
// 이 컴포저블은 App.vue 루트에서 로그인 세션을 넘나들며 살아있으므로, 로그아웃 시
// resetToDefault()를 직접 호출해 초기화한다(아래 handleLogout).
const analysisPanels = usePanelReorder({
  storageKey: ANALYSIS_PANEL_ORDER_KEY,
  defaultOrder: ["upload", "analysis", "chat"],
  // 세 패널의 기본 폭 비율(사이드 3 : 분석 8 : 챗봇 4) — 경계를 드래그하면 이 비율이
  // 패널별로 바뀌어 저장되고, 사이드바 접힘/펼침에도 fr 비율이라 그대로 유지된다.
  defaultWeights: { upload: 3, analysis: 8, chat: 4 },
  // 버튼·뱃지·텍스트가 깨지지 않는 최소 폭 — 이 아래로는 드래그해도 줄어들지 않는다.
  minWidths: { upload: 240, analysis: 380, chat: 300 },
  // 챗봇이 최소화(도킹 해제)되면 그리드 열에서 빠지고, 다시 도킹하면 저장된 자리로 복귀
  isVisible: (key) => key !== "chat" || chat.chatDocked,
});

// 경계를 손으로 드래그/키보드로 조정할 때는 grid-template-columns에 transition을 걸지 않는다
// (매 프레임 값이 바뀌는데 애니메이션까지 겹치면 커서를 못 따라가고 늘어지는 느낌만 남는다).
// 챗봇 도킹/해제처럼 한 번에 훅 바뀌는 순간에만 잠깐 이 클래스를 붙여 그 전환만 부드럽게 한다.
const dockTransitioning = ref(false);
let dockTransitionTimer = null;
watch(
  () => chat.chatDocked,
  () => {
    dockTransitioning.value = true;
    clearTimeout(dockTransitionTimer);
    dockTransitionTimer = setTimeout(() => {
      dockTransitioning.value = false;
    }, 360);
  },
);

// 챗봇 턴은 파이프라인의 업로드·분석·추천과 같은 턴 컨트롤러를 공유한다(pipeline.js의
// startTurnController) — 이 중 하나가 진행 중일 때 메시지를 보내면 그 작업이 중간에 끊기고
// 챗 턴이 대신 시작돼 버린다. 그래서 챗 자체의 응답 대기(chat.isSending)뿐 아니라 업로드·
// 문서 파싱·분석·추천 생성 중에도 입력을 막아, 사용자가 그 경합을 만들 수 없게 한다.
const chatBlocked = computed(
  () =>
    chat.isSending ||
    pipeline.uploadStatus === "uploading" ||
    pipeline.analysisStatus === "analyzing" ||
    pipeline.recommendStatus === "generating" ||
    pipeline.visionStatus === "enriching" ||
    pipeline.sessionLoadStatus === "loading",
);

// 리사이즈 핸들 접근성 — 현재 좌우 폭 비율을 aria-valuenow로 노출하고(weights가 리액티브라
// 포인터 드래그·키보드 넛지 어느 쪽으로 바뀌어도 그대로 반영된다), 어느 패널 사이 핸들인지
// aria-label에서 구분되게 한다(전부 같은 라벨이면 스크린 리더로는 핸들끼리 구별이 안 된다).
const PANEL_TITLE_KEYS = {
  upload: "upload.title",
  analysis: "recommendDetail.title",
  chat: "chat.dockedTitleDefault",
};

function boundarySplitPercent(boundary) {
  const left = analysisPanels.weights[boundary.leftKey] ?? 0;
  const right = analysisPanels.weights[boundary.rightKey] ?? 0;
  const total = left + right;
  return total > 0 ? Math.round((left / total) * 100) : 50;
}

function boundaryLabel(boundary) {
  return t("common.resizeHandleBetween", {
    left: t(PANEL_TITLE_KEYS[boundary.leftKey] ?? boundary.leftKey),
    right: t(PANEL_TITLE_KEYS[boundary.rightKey] ?? boundary.rightKey),
  });
}

const showSignup = ref(false);
const justRegisteredEmail = ref("");

const showTutorial = ref(false);
const showSettings = ref(false);

// 계정별로 최초 1회만 자동 표시 — 같은 브라우저에서 다른 계정으로 로그인하면 다시 뜬다.
// (userEmail은 두 로그인 경로 모두 isLoggedIn보다 먼저 세팅된다)
function tutorialKey() {
  return `a360.tutorialSeen.${auth.userEmail ?? ""}`;
}

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    // 로그아웃하면 닫는다 — 투어를 켠 채 로그아웃한 뒤 다른 계정으로 로그인해도 남지 않게.
    showTutorial.value = loggedIn && !localStorage.getItem(tutorialKey());
  },
);

function startTutorial() {
  showTutorial.value = true;
}

function closeTutorial() {
  showTutorial.value = false;
  localStorage.setItem(tutorialKey(), "1");
}

// F5 새로고침 시에도 마지막 세션이 이어지도록(FR-15) — 로그인 확인 후에만 복원한다. 로그인
// 화면에서 직접 로그인하는 흐름(loginWithPassword)은 건드리지 않는다 — 그건 항상 빈 화면에서
// 시작하는 게 맞고, 여기는 새로고침으로 이미 로그인된 세션을 이어받는 경우만 다룬다.
onMounted(async () => {
  await auth.bootstrapAuth();
  if (auth.isLoggedIn) pipeline.restoreLastSession();
});

function handleSignupComplete(email) {
  justRegisteredEmail.value = email ?? "";
  showSignup.value = false;
}

function handleLogout() {
  showSignup.value = false;
  justRegisteredEmail.value = "";
  auth.logout();
  analysisPanels.resetToDefault();
}

function handleNewChat() {
  pipeline.resetUpload();
  chat.newChat();
}
</script>

<template>
  <div v-if="auth.authChecking" class="app-loading">{{ t("app.authChecking") }}</div>

  <template v-else-if="!auth.isLoggedIn">
    <LoginPage :prefill-email="justRegisteredEmail" @signup="showSignup = true" />
    <SignupPage v-if="showSignup" @login="handleSignupComplete" @close="showSignup = false" />
  </template>

  <div v-else class="app-shell">
    <AppHeader
      @logout="handleLogout"
      @tutorial="startTutorial"
      @open-settings="showSettings = true"
    />

    <div class="app-shell__body">
      <AppSidebar
        :active-session-id="pipeline.sessionId"
        :active-session-loading="pipeline.sessionLoadStatus === 'loading'"
        :active-session-busy="chatBlocked"
        @select-session="pipeline.loadSession"
        @new-chat="handleNewChat"
      />

      <div class="app-content">
        <main class="app-main" id="analysis">
        <TransitionGroup
          tag="div"
          name="panel-move"
          class="app-main__grid"
          :class="{ 'app-main__grid--dock-transition': dockTransitioning }"
          :style="analysisPanels.gridStyle"
          @pointerdown="analysisPanels.handleGridPointerDown"
        >
          <UploadPanel key="upload" v-bind="analysisPanels.panelProps('upload')" />
          <AnalysisPanel key="analysis" v-bind="analysisPanels.panelProps('analysis')" />
          <ChatWidget
            key="chat"
            v-bind="analysisPanels.panelProps('chat')"
            panel-key="chat"
            :panel-reorder="analysisPanels"
            :messages="chat.chatMessages"
            :history-loading="pipeline.sessionLoadStatus === 'loading'"
            :open="chat.chatOpen"
            :docked="chat.chatDocked"
            dock-zone-id="analysis"
            show-compact
            :compacting="chat.isCompacting"
            :sending="chatBlocked"
            :usage-gauge="pipeline.usageGauge"
            :solution="pipeline.solution"
            :solution-error="pipeline.solutionSaveError"
            :agent-versions="settings.agentVersions"
            :agent-version="settings.agentVersion"
            @select-version="settings.setAgentVersion"
            @toggle="chat.toggleChat"
            @close="chat.closeChat"
            @dock="chat.dockChat"
            @undock="chat.undockChat"
            @send="chat.sendChatMessage"
            @compact="chat.compactConversation"
            @revert-solution="pipeline.setSolution('a360')"
          />

          <div
            v-for="boundary in analysisPanels.boundaries"
            :key="boundary.key"
            class="panel-resize-handle"
            :class="{
              'panel-resize-handle--active': analysisPanels.resizingBoundary === boundary.key,
              'panel-resize-handle--collapsed': !boundary.interactive,
            }"
            :style="{ order: boundary.order }"
            role="separator"
            aria-orientation="vertical"
            :aria-label="boundaryLabel(boundary)"
            :aria-valuenow="boundarySplitPercent(boundary)"
            aria-valuemin="0"
            aria-valuemax="100"
            :tabindex="boundary.interactive ? 0 : -1"
            @pointerdown="analysisPanels.beginResize(boundary.leftKey, boundary.rightKey, $event)"
            @keydown.left="analysisPanels.nudgeResize(boundary.leftKey, boundary.rightKey, -24)"
            @keydown.right="analysisPanels.nudgeResize(boundary.leftKey, boundary.rightKey, 24)"
          ></div>
        </TransitionGroup>

        <div
          v-if="analysisPanels.dragGhostStyle"
          class="panel-drag-ghost"
          :style="analysisPanels.dragGhostStyle"
          v-html="analysisPanels.dragGhost.html"
          inert
          tabindex="-1"
          aria-hidden="true"
        ></div>

        <AppActionBar />
        </main>
      </div>
    </div>

    <TutorialOverlay v-if="showTutorial" @close="closeTutorial" />
    <SettingsOverlay v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
