/* 冒烟测试：卷宗对账核心流程（node + tsx 运行，非应用代码） */
import assert from "node:assert";

// 模拟浏览器 localStorage，供 dossierSystem 使用
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear()
};

const { store } = await import("../src/store");
const actions = await import("../src/store/courtSlice");
const { syncCatalog } = await import("../src/store/sync");
const { updateRemoteSummary } = await import("../src/app/dossierSystem");

const dispatch = store.dispatch as (action: unknown) => unknown;
const state = () => store.getState().court;
const find = (id: string) => state().evidence.find((item) => item.id === id)!;

// 1. 首次同步：容量 4、10 条目录 → 3 个批次
await dispatch(syncCatalog());
assert.equal(state().catalog.order.length, 3, "目录应按卷宗号分批");
assert.equal(state().catalog.capacity, 4);
assert.ok(state().catalog.lastFullSyncAt, "完整同步后应记录时间");
assert.equal(find("e1").reconcile, "对账通过", "卷宗号+摘要一致才放行");
assert.equal(find("e2").reconcile, "草稿区", "摘要不一致停草稿区");
assert.equal(find("e3").reconcile, "草稿区", "临场补录缺卷宗号停草稿区");
assert.equal(find("e4").reconcile, "草稿区", "摘要缺失先停草稿区");

// 2. 旧数据回填：e4 有首次展示存档可补齐，e5 补不齐留草稿区
dispatch(actions.backfillSummaries());
assert.equal(find("e4").summary, "现场验收单扫描件（首次展示版）");
assert.equal(find("e4").reconcile, "对账通过", "回填后一致应对账通过");
assert.equal(find("e5").reconcile, "草稿区", "补不齐的留在草稿区");

// 3. 放行门槛：草稿区不得进公开屏
dispatch(actions.selectEvidence("e2"));
dispatch(actions.showEvidence());
assert.equal(find("e2").status, "待展示", "未对账证据不得展示");
assert.ok(state().timeline[0].action === "公开放行拦截");

// 4. 正常展示对账通过的 e1，公开屏出现画面
dispatch(actions.selectEvidence("e1"));
dispatch(actions.showEvidence());
assert.equal(find("e1").status, "展示中");
assert.equal(state().publicFrame?.evidenceId, "e1", "公开屏应展示已放行证据");

// 5. 卷宗摘要改动 → 重同步：已展示证据退回待复核并重算计时，公开屏冻结
updateRemoteSummary("ZJ-2026-0001", "项目验收会议纪要（2026 修订版）");
dispatch(actions.tick());
const frameBefore = state().publicFrame;
await dispatch(syncCatalog());
assert.equal(find("e1").reconcile, "待复核", "摘要变更应退回待复核");
assert.equal(find("e1").status, "待展示", "展示中的证据应撤回");
assert.equal(state().session.timerSeconds, 8 * 60, "计时应按时长重算");
assert.equal(state().publicFrame, frameBefore, "公开屏继续用上次完整同步画面");
assert.ok(state().timeline.some((entry) => entry.action === "卷宗摘要变更"));

// 6. 复核：采纳卷宗摘要后恢复放行
dispatch(actions.reviewEvidence({ id: "e1", adoptCatalogSummary: true }));
assert.equal(find("e1").reconcile, "对账通过");
assert.equal(find("e1").summary, "项目验收会议纪要（2026 修订版）");

// 7. 批次失败：留用上次结果，只重试该批
dispatch(actions.setFailNextBatch(true));
const entriesBefore = state().catalog.batches[state().catalog.order[0]].entries;
await dispatch(syncCatalog());
const failedKeys = state().catalog.order.filter((key) => state().catalog.batches[key].status === "失败");
assert.equal(failedKeys.length, 1, "注入故障应只失败一批");
assert.deepEqual(state().catalog.batches[failedKeys[0]].entries, entriesBefore, "失败批次留用上次结果");
assert.ok(state().catalog.lastFullSyncAt, "部分失败不清空上次完整同步时间");
const successAttempts = state().catalog.batches[state().catalog.order[1]].attempts;
await dispatch(syncCatalog({ onlyFailed: true }));
assert.ok(state().catalog.order.every((key) => state().catalog.batches[key].status === "成功"), "只重试失败批次后应全部成功");
assert.equal(state().catalog.batches[state().catalog.order[1]].attempts, successAttempts, "成功批次不应被重复拉取");

// 8. 临场补录：缺卷宗号直接进草稿区
dispatch(actions.addEvidence({ title: "当庭补充笔录", type: "书证", presenter: "原告", duration: 5, note: "庭审现场形成", dossierNo: "", summary: "" }));
const added = state().evidence[state().evidence.length - 1];
assert.equal(added.reconcile, "草稿区");
assert.equal(added.dossierNo, null);

console.log("✓ 全部对账流程断言通过");
