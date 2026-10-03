import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { buildCatalogMap, matchEvidence } from "../app/reconcile";
import type { BatchPlan } from "../app/dossierSystem";
import type { CatalogBatch, DossierEntry, Evidence, Objection, PublicFrame, SessionPhase, SessionState, TimelineEntry } from "../types";

const seedEvidence: Evidence[] = [
  { id: "e1", exhibitNo: "原告-003", title: "项目验收会议纪要", type: "书证", duration: 8, presenter: "原告", sensitive: false, status: "待展示", note: "第4页涉及合同补充约定", dossierNo: "ZJ-2026-0001", summary: "项目验收会议纪要（含补充约定）", reconcile: "待对账", firstShownSummary: null },
  { id: "e2", exhibitNo: "原告-004", title: "设备故障检测报告", type: "书证", duration: 10, presenter: "原告", sensitive: true, status: "待展示", note: "含第三方客户名称，公开屏需遮罩", dossierNo: "ZJ-2026-0002", summary: "设备故障检测报告（客户版）", reconcile: "待对账", firstShownSummary: null },
  { id: "e3", exhibitNo: "被告-002", title: "系统运行日志", type: "电子数据", duration: 12, presenter: "被告", sensitive: false, status: "待展示", note: "重点展示 14:20 至 14:45", dossierNo: null, summary: "系统运行日志关键时段摘录", reconcile: "待对账", firstShownSummary: null },
  { id: "e4", exhibitNo: "原告-005", title: "现场验收单扫描件", type: "书证", duration: 6, presenter: "原告", sensitive: false, status: "待展示", note: "历史数据，摘要缺失待回填", dossierNo: "ZJ-2026-0004", summary: "", reconcile: "待对账", firstShownSummary: null },
  { id: "e5", exhibitNo: "被告-005", title: "历史维修记录汇总", type: "书证", duration: 5, presenter: "被告", sensitive: false, status: "待展示", note: "历史数据，无首次展示存档", dossierNo: "ZJ-2026-0005", summary: "", reconcile: "待对账", firstShownSummary: null }
];
const seedSession: SessionState = { phase: "举证", currentEvidenceId: "e1", timerSeconds: 8 * 60, operatorMode: "庭审控制" };

interface Snapshot {
  id: string;
  label: string;
  time: string;
  evidence: Evidence[];
  phase: SessionPhase;
  currentEvidenceId: string | null;
}

interface CatalogState {
  order: string[];
  batches: Record<string, CatalogBatch>;
  capacity: number;
  total: number;
  lastFullSyncAt: string | null;
  syncing: boolean;
  failNextBatch: boolean;
}

interface State {
  initialized: boolean;
  evidence: Evidence[];
  objections: Objection[];
  timeline: TimelineEntry[];
  snapshots: Snapshot[];
  session: SessionState;
  catalog: CatalogState;
  publicFrame: PublicFrame | null;
  online: boolean;
}

const seedSnapshot: Snapshot = {
  id: "snap-seed-1",
  label: "首次展示存档（历史）",
  time: "2026-09-27T08:30:00.000Z",
  evidence: [{ ...seedEvidence[3], summary: "现场验收单扫描件（首次展示版）", firstShownSummary: "现场验收单扫描件（首次展示版）", status: "展示中" }],
  phase: "举证",
  currentEvidenceId: "e4"
};

const initialState: State = {
  initialized: false,
  evidence: seedEvidence,
  objections: [{ id: "o1", evidenceId: "e2", ground: "关联性异议", explanation: "检测报告来源和保管链尚未说明。", status: "待裁定", createdAt: new Date().toISOString() }],
  timeline: [{ id: "t1", time: new Date().toISOString(), actor: "书记员", action: "庭审开始", detail: "核对到庭人员并宣布法庭纪律" }],
  snapshots: [seedSnapshot],
  session: seedSession,
  catalog: { order: [], batches: {}, capacity: 4, total: 0, lastFullSyncAt: null, syncing: false, failNextBatch: false },
  publicFrame: null,
  online: true
};

function addEntry(state: State, actor: TimelineEntry["actor"], action: string, detail: string) {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, detail });
}

function isFrameLive(state: State) {
  return !state.evidence.some((item) => item.reconcile === "待复核") && !Object.values(state.catalog.batches).some((batch) => batch.status === "失败");
}

function captureFrame(state: State) {
  const current = state.evidence.find((item) => item.id === state.session.currentEvidenceId);
  if (current && current.reconcile !== "对账通过") return;
  state.publicFrame = {
    evidenceId: current?.id ?? null,
    exhibitNo: current?.exhibitNo ?? "",
    title: current?.title ?? "",
    note: current?.note ?? "",
    sensitive: current?.sensitive ?? false,
    timerSeconds: state.session.timerSeconds,
    phase: state.session.phase,
    syncedAt: new Date().toISOString()
  };
}

function reconcileState(state: State) {
  const catalog = buildCatalogMap(state.catalog.batches, state.catalog.order);
  for (const item of state.evidence) {
    const result = matchEvidence(item, catalog);
    if (result === "match") {
      if (item.reconcile !== "待复核") item.reconcile = "对账通过";
      continue;
    }
    const wasDisplayed = item.reconcile === "对账通过" && (item.status === "展示中" || item.status === "已展示");
    if (result === "mismatch" && wasDisplayed) {
      item.reconcile = "待复核";
      if (item.status === "展示中") item.status = "待展示";
      const retimed = state.session.currentEvidenceId === item.id;
      if (retimed) state.session.timerSeconds = item.duration * 60;
      addEntry(state, "审判庭", "卷宗摘要变更", `${item.exhibitNo} 与卷宗 ${item.dossierNo} 摘要不一致，退回待复核${retimed ? "，展示计时已重算" : ""}`);
    } else if (item.reconcile !== "待复核") {
      item.reconcile = "草稿区";
    }
  }
}

type PersistedEvidence = Omit<Evidence, "dossierNo" | "summary" | "reconcile" | "firstShownSummary"> & Partial<Evidence>;

const slice = createSlice({
  name: "court",
  initialState,
  reducers: {
    initialize(state, action: PayloadAction<PersistedEvidence[]>) {
      if (state.initialized) return;
      const incoming = action.payload.length ? action.payload : seedEvidence;
      state.evidence = incoming.map((raw) => ({ dossierNo: null, summary: "", reconcile: "待对账" as const, firstShownSummary: null, ...raw }));
      state.initialized = true;
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
      if (isFrameLive(state)) captureFrame(state);
    },
    showEvidence(state) {
      const item = state.evidence.find((entry) => entry.id === state.session.currentEvidenceId);
      if (!item) return;
      if (item.reconcile !== "对账通过") {
        addEntry(state, "审判庭", "公开放行拦截", `${item.exhibitNo} 未通过卷宗对账（${item.reconcile}），不得进入公开屏`);
        return;
      }
      item.status = "展示中";
      if (!item.firstShownSummary) item.firstShownSummary = item.summary;
      state.session.phase = "质证";
      addEntry(state, item.presenter, "开始展示", item.title);
      if (isFrameLive(state)) captureFrame(state);
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
      if (isFrameLive(state)) captureFrame(state);
    },
    toggleSensitive(state, action: PayloadAction<string>) {
      const item = state.evidence.find((entry) => entry.id === action.payload);
      if (!item) return;
      item.sensitive = !item.sensitive;
      addEntry(state, "审判庭", item.sensitive ? "隐藏敏感内容" : "恢复公开内容", item.title);
      if (isFrameLive(state)) captureFrame(state);
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
      if (action.payload.status === "支持" && item) { item.status = "已跳过"; addEntry(state, "审判庭", "异议成立", `${item.exhibitNo} 暂不展示`); } else { addEntry(state, "审判庭", "异议驳回", item?.title ?? "继续质证"); }
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
      if (isFrameLive(state)) captureFrame(state);
    },
    tick(state) {
      if (state.session.phase === "质证" && state.session.timerSeconds > 0) {
        state.session.timerSeconds -= 1;
        if (isFrameLive(state) && state.publicFrame) state.publicFrame.timerSeconds = state.session.timerSeconds;
      }
    },
    setPhase(state, action: PayloadAction<SessionPhase>) {
      state.session.phase = action.payload;
      addEntry(state, "审判庭", "切换庭审阶段", action.payload);
      if (isFrameLive(state)) captureFrame(state);
    },
    syncPlanned(state, action: PayloadAction<{ batches: BatchPlan[]; total: number; capacity: number }>) {
      state.catalog.syncing = true;
      state.catalog.total = action.payload.total;
      state.catalog.capacity = action.payload.capacity;
      state.catalog.order = action.payload.batches.map((plan) => plan.key);
      for (const plan of action.payload.batches) {
        const existing = state.catalog.batches[plan.key];
        if (!existing) state.catalog.batches[plan.key] = { key: plan.key, from: plan.from, to: plan.to, status: "待拉取", entries: [], attempts: 0, message: null };
        else { existing.from = plan.from; existing.to = plan.to; }
      }
    },
    batchStarted(state, action: PayloadAction<string>) {
      const batch = state.catalog.batches[action.payload];
      if (batch) batch.status = "拉取中";
    },
    batchLoaded(state, action: PayloadAction<{ key: string; entries: DossierEntry[] }>) {
      const batch = state.catalog.batches[action.payload.key];
      if (!batch) return;
      batch.status = "成功";
      batch.entries = action.payload.entries;
      batch.attempts += 1;
      batch.message = null;
    },
    batchFailed(state, action: PayloadAction<{ key: string; message: string }>) {
      const batch = state.catalog.batches[action.payload.key];
      if (!batch) return;
      batch.status = "失败";
      batch.attempts += 1;
      batch.message = action.payload.message;
    },
    reconcileWithCatalog(state) {
      reconcileState(state);
      const failed = Object.values(state.catalog.batches).some((batch) => batch.status === "失败");
      state.catalog.syncing = false;
      if (!failed) state.catalog.lastFullSyncAt = new Date().toISOString();
    },
    setFailNextBatch(state, action: PayloadAction<boolean>) { state.catalog.failNextBatch = action.payload; },
    consumeFailNextBatch(state) { state.catalog.failNextBatch = false; },
    reviewEvidence(state, action: PayloadAction<{ id: string; adoptCatalogSummary: boolean }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.id);
      if (!item || item.reconcile !== "待复核" || !item.dossierNo) return;
      const catalog = buildCatalogMap(state.catalog.batches, state.catalog.order);
      const entry = catalog.get(item.dossierNo);
      if (!entry) return;
      if (action.payload.adoptCatalogSummary) item.summary = entry.summary;
      if (matchEvidence(item, catalog) === "match") {
        item.reconcile = "对账通过";
        addEntry(state, "审判庭", "复核通过", `${item.exhibitNo} 与卷宗 ${item.dossierNo} 摘要一致，恢复公开放行`);
        if (isFrameLive(state)) captureFrame(state);
      }
    },
    backfillSummaries(state) {
      let filled = 0;
      let stuck = 0;
      for (const item of state.evidence) {
        if (item.summary.trim()) continue;
        let source = item.firstShownSummary?.trim() ?? "";
        if (!source) {
          for (let index = state.snapshots.length - 1; index >= 0; index -= 1) {
            const hit = state.snapshots[index].evidence.find((entry) => entry.id === item.id);
            if (hit && hit.summary.trim()) { source = hit.summary.trim(); break; }
          }
        }
        if (source) { item.summary = source; filled += 1; } else { item.reconcile = "草稿区"; stuck += 1; }
      }
      reconcileState(state);
      addEntry(state, "书记员", "旧数据回填", `按首次展示版本补齐 ${filled} 条摘要，${stuck} 条补不齐留在草稿区`);
    },
    addEvidence(state, action: PayloadAction<{ title: string; type: Evidence["type"]; presenter: Evidence["presenter"]; duration: number; note: string; dossierNo: string; summary: string }>) {
      const item: Evidence = {
        id: crypto.randomUUID(),
        exhibitNo: `补录-${String(state.evidence.length + 1).padStart(3, "0")}`,
        title: action.payload.title,
        type: action.payload.type,
        presenter: action.payload.presenter,
        duration: action.payload.duration,
        sensitive: false,
        status: "待展示",
        note: action.payload.note,
        dossierNo: action.payload.dossierNo.trim() ? action.payload.dossierNo.trim() : null,
        summary: action.payload.summary,
        reconcile: "待对账",
        firstShownSummary: null
      };
      state.evidence.push(item);
      reconcileState(state);
      addEntry(state, "书记员", "临场补录", `${item.exhibitNo} ${item.title}${item.dossierNo ? "" : "（缺正式卷宗号，先停草稿区）"}`);
    },
    updateEvidenceMeta(state, action: PayloadAction<{ id: string; dossierNo: string; summary: string }>) {
      const item = state.evidence.find((entry) => entry.id === action.payload.id);
      if (!item) return;
      item.dossierNo = action.payload.dossierNo.trim() ? action.payload.dossierNo.trim() : null;
      item.summary = action.payload.summary;
      reconcileState(state);
      addEntry(state, "书记员", "修订对账信息", `${item.exhibitNo} 卷宗号 ${item.dossierNo ?? "（空）"}`);
    }
  }
});

export const { initialize, setOnline, setMode, reorder, selectEvidence, showEvidence, completeEvidence, toggleSensitive, addObjection, resolveObjection, snapshot, restore, tick, setPhase, syncPlanned, batchStarted, batchLoaded, batchFailed, reconcileWithCatalog, setFailNextBatch, consumeFailNextBatch, reviewEvidence, backfillSummaries, addEvidence, updateEvidenceMeta } = slice.actions;
export default slice.reducer;
