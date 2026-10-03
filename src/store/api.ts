import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { CatalogBatch, CatalogEntry, Evidence } from "../types";

const KEY = "pair-wise-yf-49/court";
const CATALOG_KEY = "pair-wise-yf-49/catalog";
const FAIL_FLAG_KEY = "pair-wise-yf-49/catalog-fail-batch-1";
const BATCH_SIZE = 3;

const defaultCatalog: CatalogEntry[] = [
  { fileNo: "原告-003", summary: "项目验收会议纪要" },
  { fileNo: "原告-004", summary: "设备故障检测报告" },
  { fileNo: "被告-002", summary: "系统运行日志" },
  { fileNo: "原告-005", summary: "补充协议" },
  { fileNo: "被告-003", summary: "付款凭证" },
  { fileNo: "原告-007", summary: "出庭通知书" }
];

function loadCatalog(): CatalogEntry[] {
  const raw = localStorage.getItem(CATALOG_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as CatalogEntry[];
    } catch {
      /* fall through to default */
    }
  }
  localStorage.setItem(CATALOG_KEY, JSON.stringify(defaultCatalog));
  return defaultCatalog;
}

export const courtApi = createApi({
  reducerPath: "courtApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getEvidence: builder.query<Evidence[], void>({
      queryFn: async () => {
        const raw = localStorage.getItem(KEY);
        return { data: raw ? JSON.parse(raw).evidence : [] };
      }
    }),
    saveEvidence: builder.mutation<{ ok: true }, Evidence[]>({
      queryFn: async (payload) => {
        const raw = localStorage.getItem(KEY);
        const current = raw ? JSON.parse(raw) : {};
        localStorage.setItem(KEY, JSON.stringify({ ...current, evidence: payload }));
        return { data: { ok: true } };
      }
    }),
    getCatalogBatch: builder.query<CatalogBatch, { batch: string }>({
      queryFn: async ({ batch }) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const all = loadCatalog();
        const sorted = [...all].sort((a, b) => a.fileNo.localeCompare(b.fileNo, "zh"));
        const index = Number(batch);
        const start = index * BATCH_SIZE;
        const entries = sorted.slice(start, start + BATCH_SIZE);
        const nextBatch = start + BATCH_SIZE < sorted.length ? String(index + 1) : null;
        if (batch === "1" && localStorage.getItem(FAIL_FLAG_KEY) === "1") {
          return { error: { status: 500, data: "卷宗目录第 2 批拉取失败（模拟）" } };
        }
        return { data: { batch, entries, nextBatch } };
      }
    }),
    simulateCatalogChange: builder.mutation<{ ok: true }, string>({
      queryFn: async (fileNo) => {
        const all = loadCatalog();
        const target = all.find((entry) => entry.fileNo === fileNo);
        if (target) target.summary = `${target.summary}（修订）`;
        localStorage.setItem(CATALOG_KEY, JSON.stringify(all));
        return { data: { ok: true } };
      }
    }),
    setCatalogFailFlag: builder.mutation<{ ok: true }, boolean>({
      queryFn: async (fail) => {
        if (fail) localStorage.setItem(FAIL_FLAG_KEY, "1");
        else localStorage.removeItem(FAIL_FLAG_KEY);
        return { data: { ok: true } };
      }
    })
  })
});

export const {
  useGetEvidenceQuery,
  useSaveEvidenceMutation,
  useGetCatalogBatchQuery,
  useLazyGetCatalogBatchQuery,
  useSimulateCatalogChangeMutation,
  useSetCatalogFailFlagMutation
} = courtApi;
