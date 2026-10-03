import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { courtApi } from "./api";
import type { RootState, AppDispatch } from "./index";
import type { CatalogBatchState, CatalogEntry, Evidence, Objection, SessionPhase, SessionState, TimelineEntry } from "../types";

const seedEvidence: Evidence[] = [
  { id: "e1", exhibitNo: "原告-003", summary: "项目验收会议纪要", title: "项目验收会议纪要", type: "书证", duration: 8, presenter: "原告", sensitive: false, status: "待展示", note: "第4页涉及合同补充约定", reconcileStatus: "公开" },
  { id: "e2", exhibitNo: "原告-004", summary: "设备故障检测报告", title: "设备故障检测报告", type: "书证", duration: 10, presenter: "原告", sensitive: true, status: "待展示", note: "含第三方客户名称，公开屏需遮罩", reconcileStatus: "公开" },
  { id: "e3", exhibitNo: "被告-002", summary: "系统运行日志", title: "系统运行日志", type: "电子数据", duration: 12, presenter: "被告", sensitive: false, status: "待展示", note: "重点展示 14:20 至 14:45", reconcileStatus: "公开" },
  { id: "e4", exhibitNo: "原告-005", summary: "", title: "补充协议", type: "书证", duration: 6, presenter: "原告", sensitive: false, status: "待展示", note: "当庭补录，摘要待回填", reconcileStatus: "草稿" },
  { id: "e5", exhibitNo: "被告-003", summary: "付款凭证-旧版", title: "付款凭证", type: "书证", duration: 7, presenter: "被告", sensitive: false, status: "待展示", note: "本地摘要与卷宗目录不一致", reconcileStatus: "草稿" },
  { id: "e6", exhibitNo: "原告-006", summary: "出庭通知书", title: "出庭通知书", type: "书证", duration: 3, presenter: "原告", sensitive: false, status: "待展示", note: "卷宗目录中无此卷宗号", reconcileStatus: "草稿" }
];
const seedSession: SessionState = { phase: "举证", currentEvidenceId: "e1", timerSeconds: 8 * 60, operatorMode: "庭审控制" };

interface State {
  initialized: boolean;
  evidence: Evidence[];
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: { id: string; label: string; time: string; evidence: Evidence[]; phase: SessionPhase; currentEvidenceId: string | null }[];
  session: SessionState;
  online: boolean;
  catalog: CatalogEntry[];
  catalogBatchStatus: Record<string, CatalogBatchState>;
  catalogSyncing: boolean;
  syncedSummary: Record<string, string>;
  lastSyncedScreen: { evidence: Evidence[]; syncedAt: string } | null;
  lastReconcileAt: string | null;
}

const initialState: State = {
  initialized: false,
  evidence: seedEvidence,
  objections: [{ id: "o1", evidenceId: "e2", ground: "关联性异议", explanation: "检测报告来源和保管链尚未说明。", status: "待裁定", createdAt: new Date().toISOString() }],
  timeline: [{ id: "t1", time: new Date().toISOString(), actor: "书记员", action: "庭审开始", detail: "核对到庭人员并宣布法庭纪律" }],
  snapshots: [],
  session: seedSession,
  online: true,
  catalog: [],
  catalogBatchStatus: {},
  catalogSyncing: false,
  syncedSummary: {},
  lastSyncedScreen: null,
  lastReconcileAt: null
};

function addEntry(state: State, actor: TimelineEntry["actor"], action: string, detail: string) {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, detail });
}

function migrate(raw: Partial<Evidence>[]): Evidence[] {
  return raw.map((item) => ({
    id: item.id ?? crypto.randomUUID(),
    exhibitNo: item.exhibitNo ?? "",
    summary: item.summary ?? "",
    title: item.title ?? "未命名证据",
    type: item.type ?? "书证",
    duration: item.duration ?? 5,
    presenter: item.presenter ?? "审判庭",
    sensitive: item.sensitive ?? false,
    status: item.status ?? "待展示",
    note: item.note ?? "",
    reconcileStatus: item.reconcileStatus ?? "草稿",
    firstShownSummary: item.firstShownSummary
  }));
}

export const syncCatalog = createAsyncThunk<
  { entries: CatalogEntry[]; batchStatus: Record<string, CatalogBatchState> },
  void,
  { state: RootState; dispatch: AppDispatch }
>("court/syncCatalog", async (_args, { dispatch }) => {
  const batchStatus: Record<string, CatalogBatchState> = {};
  const entries: CatalogEntry[] = [];
  let batch: string | null = "0";
  while (batch !== null) {
    const currentBatch: string = batch;
    batchStatus[currentBatch] = { status: "loading", attempt: 0 };
    try {
      const res = await dispatch(courtApi.endpoints.getCatalogBatch.initiate({ batch: currentBatch })).unwrap();
      entries.push(...res.entries);
      batchStatus[currentBatch] = { status: "succeeded", attempt: 0 };
      batch = res.nextBatch;
    } catch {
      batchStatus[currentBatch] = { status: "failed", attempt: 0 };
      break;
    }
  }
  return { entries, batchStatus };
});

export const retryCatalogBatch = createAsyncThunk<
  { batch: string; entries: CatalogEntry[]; nextBatch: string | null },
  string,
  { state: RootState; dispatch: AppDispatch }
>("court/retryCatalogBatch", async (batch, { dispatch }) => {
  const res = await dispatch(courtApi.endpoints.getCatalogBatch.initiate({ batch }, { forceRefetch: true })).unwrap();
  return { batch, entries: res.entries, nextBatch: res.nextBatch };
});

const slice = createSlice({
  name: "court",
  initialState,
  reducers: {
    initialize(state, action: PayloadAction<Evidence[]>) {
      if (!state.initialized) {
        state.evidence = action.payload.length ? migrate(action.payload) : seedEvidence;
        state.initialized = true;
      }
    },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },
    setMode(state, action: PayloadAction<SessionState["operatorMode"]>) { state.session.operatorMode = action.payload; },
    reorder(state, action: PayloadAction<Evidence[]>) { state.evidence = action.payload; addEntry(state, "书记员", "调整证据顺序", "已更新举证顺序"); },
    selectEvidence(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      if (!item) return;
      state.session.currentEvidenceId = item.id;
      state.session.timerSeconds = item.duration * 60;
      addEntry(state, item.presenter, "切换展示证据", `${item.exhibitNo} ${item.title}`);
    },
    showEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      if (item.status === "待复核") return;
      item.status = "展示中";
      if (!item.firstShownSummary) item.firstShownSummary = item.summary || item.title;
      state.session.phase = "质证";
      addEntry(state, item.presenter, "开始展示", item.title);
    },
    completeEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      item.status = "已展示";
      const next = state.evidence.find((entry) => entry.status === "待展示");
      state.session.currentEvidenceId = next?.id ?? null;
      state.session.timerSeconds = (next?.duration ?? 0) * 60;
      state.session.phase = next ? "举证" : "休庭";
      addEntry(state, "审判庭", "完成质证", item.title);
    },
    toggleSensitive(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      if (!item) return;
      item.sensitive = !item.sensitive;
      addEntry(state, "审判庭", item.sensitive ? "隐藏敏感内容" : "恢复公开内容", item.title);
    },
    addObjection(state, action: PayloadAction<{ evidenceId: string; ground: string; explanation: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.evidenceId);
      state.objections.unshift({ ...action.payload, id: crypto.randomUUID(), status: "待裁定", createdAt: new Date().toISOString() });
      state.session.phase = "质证";
      addEntry(state, item?.presenter ?? "审判庭", "提出异议", `${item?.exhibitNo ?? ""} ${action.payload.ground}`);
    },
    resolveObjection(state, action: PayloadAction<{ id: string; status: "支持" | "驳回" }>) {
      const objection = state.objections.find((entry) => entry.id === action.payload.id);
      if (!objection) return;
      objection.status = action.payload.status;
      const item = state.evidence.find((entry) => entry.id === objection.evidenceId);
      if (action.payload.status === "支持" && item) {
        item.status = "已跳过";
        addEntry(state, "审判庭", "异议成立", `${item.exhibitNo} 暂不展示`);
      } else {
        addEntry(state, "审判庭", "异议驳回", item?.title ?? "继续质证");
      }
    },
    snapshot(state, action: PayloadAction<string>) {
      state.snapshots.unshift({ id: crypto.randomUUID(), label: action.payload, time: new Date().toISOString(), evidence: structuredClone(state.evidence), phase: state.session.phase, currentEvidenceId: state.session.currentEvidenceId });
      state.snapshots = state.snapshots.slice(0, 10);
    },
    restore(state, action: PayloadAction<string>) {
      const snapshot = state.snapshots.find((entry) => entry.id === action.payload);
      if (!snapshot) return;
      state.evidence = structuredClone(snapshot.evidence);
      state.session.phase = snapshot.phase;
      state.session.currentEvidenceId = snapshot.currentEvidenceId;
      addEntry(state, "审判庭", "恢复庭审快照", snapshot.label);
    },
    tick(state) { if (state.session.phase === "质证" && state.session.timerSeconds > 0) state.session.timerSeconds -= 1; },
    setPhase(state, action: PayloadAction<SessionPhase>) { state.session.phase = action.payload; addEntry(state, "审判庭", "切换庭审阶段", action.payload); },
    reconcile(state) {
      const catalogByNo = new Map(state.catalog.map((entry) => [entry.fileNo, entry]));
      let changedDisplayed = false;
      for (const item of state.evidence) {
        if (item.status === "待复核") { item.reconcileStatus = "公开"; continue; }
        if (!item.exhibitNo) { item.reconcileStatus = "草稿"; continue; }
        const catalogEntry = catalogByNo.get(item.exhibitNo);
        if (!catalogEntry) { item.reconcileStatus = "草稿"; continue; }
        if (!item.summary) {
          if (item.firstShownSummary && item.firstShownSummary === catalogEntry.summary) {
            item.summary = item.firstShownSummary;
            item.reconcileStatus = "公开";
          } else {
            item.reconcileStatus = "草稿";
          }
          continue;
        }
        const prevSummary = state.syncedSummary[item.exhibitNo];
        if (prevSummary !== undefined && prevSummary !== catalogEntry.summary && (item.status === "已展示" || item.status === "展示中")) {
          item.status = "待复核";
          item.reconcileStatus = "公开";
          changedDisplayed = true;
          continue;
        }
        if (item.summary !== catalogEntry.summary) {
          item.reconcileStatus = "草稿";
          continue;
        }
        item.reconcileStatus = "公开";
      }
      if (changedDisplayed) {
        const current = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
        if (current && current.status === "待复核") state.session.timerSeconds = current.duration * 60;
      }
      state.syncedSummary = Object.fromEntries(state.catalog.map((entry) => [entry.fileNo, entry.summary]));
      state.lastSyncedScreen = { evidence: state.evidence.filter((entry) => entry.reconcileStatus === "公开").map((entry) => ({ ...entry })), syncedAt: new Date().toISOString() };
      state.lastReconcileAt = new Date().toISOString();
    },
    reviewPassed(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      if (!item) return;
      const catalogEntry = state.catalog.find((entry) => entry.fileNo === item.exhibitNo);
      if (catalogEntry) {
        item.summary = catalogEntry.summary;
        state.syncedSummary[item.exhibitNo] = catalogEntry.summary;
      }
      item.status = "待展示";
      item.reconcileStatus = "公开";
      state.session.timerSeconds = item.duration * 60;
      addEntry(state, "审判庭", "复核通过", `${item.exhibitNo} 已按卷宗摘要更新并恢复计时`);
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(syncCatalog.pending, (state) => { state.catalogSyncing = true; })
      .addCase(syncCatalog.fulfilled, (state, action) => {
        state.catalog = action.payload.entries;
        state.catalogBatchStatus = action.payload.batchStatus;
        state.catalogSyncing = false;
      })
      .addCase(syncCatalog.rejected, (state) => { state.catalogSyncing = false; })
      .addCase(retryCatalogBatch.pending, (state, action) => {
        const batch = action.meta.arg;
        state.catalogBatchStatus[batch] = { status: "loading", attempt: (state.catalogBatchStatus[batch]?.attempt ?? 0) + 1 };
      })
      .addCase(retryCatalogBatch.fulfilled, (state, action) => {
        const merged = new Map(state.catalog.map((entry) => [entry.fileNo, entry]));
        for (const entry of action.payload.entries) merged.set(entry.fileNo, entry);
        state.catalog = Array.from(merged.values());
        state.catalogBatchStatus[action.payload.batch] = { status: "succeeded", attempt: state.catalogBatchStatus[action.payload.batch]?.attempt ?? 1 };
      })
      .addCase(retryCatalogBatch.rejected, (state, action) => {
        const batch = action.meta.arg;
        state.catalogBatchStatus[batch] = { status: "failed", attempt: state.catalogBatchStatus[batch]?.attempt ?? 1 };
      });
  }
});

export const {
  initialize, setOnline, setMode, reorder, selectEvidence, showEvidence, completeEvidence,
  toggleSensitive, addObjection, resolveObjection, snapshot, restore, tick, setPhase,
  reconcile, reviewPassed
} = slice.actions;
export default slice.reducer;
