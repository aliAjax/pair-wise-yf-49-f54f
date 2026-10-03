import type { AppDispatch, RootState } from ".";
import { fetchCatalogBatch, fetchCatalogIndex } from "../app/dossierSystem";
import { batchFailed, batchLoaded, batchStarted, consumeFailNextBatch, reconcileWithCatalog, syncPlanned } from "./courtSlice";

export const syncCatalog = (options: { onlyFailed?: boolean } = {}) => async (dispatch: AppDispatch, getState: () => RootState) => {
  const { onlyFailed = false } = options;
  const index = await fetchCatalogIndex();
  dispatch(syncPlanned({ batches: index.batches, total: index.total, capacity: index.capacity }));
  const state = getState().court;
  const failedKeys = state.catalog.order.filter((key) => state.catalog.batches[key]?.status === "失败");
  const keys = onlyFailed ? failedKeys : state.catalog.order;
  for (const key of keys) {
    dispatch(batchStarted(key));
    const shouldFail = getState().court.catalog.failNextBatch;
    if (shouldFail) dispatch(consumeFailNextBatch());
    try {
      const entries = await fetchCatalogBatch(key, { fail: shouldFail });
      dispatch(batchLoaded({ key, entries }));
    } catch (error) {
      dispatch(batchFailed({ key, message: error instanceof Error ? error.message : "卷宗批次拉取失败" }));
    }
  }
  dispatch(reconcileWithCatalog());
};
