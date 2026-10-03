import type { DossierEntry } from "../types";

const REMOTE_KEY = "pair-wise-yf-49/dossier-remote";
export const BATCH_CAPACITY = 4;

const seedRemote: DossierEntry[] = [
  { dossierNo: "ZJ-2026-0001", summary: "项目验收会议纪要（含补充约定）", version: 1, updatedAt: "2026-09-28T09:00:00.000Z" },
  { dossierNo: "ZJ-2026-0002", summary: "设备故障检测报告（遮罩版）", version: 2, updatedAt: "2026-09-29T02:30:00.000Z" },
  { dossierNo: "ZJ-2026-0003", summary: "系统运行日志（14:20-14:45 节选）", version: 1, updatedAt: "2026-09-28T09:00:00.000Z" },
  { dossierNo: "ZJ-2026-0004", summary: "现场验收单扫描件（首次展示版）", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" },
  { dossierNo: "ZJ-2026-0005", summary: "历史维修记录汇总", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" },
  { dossierNo: "ZJ-2026-0006", summary: "合同原件扫描件", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" },
  { dossierNo: "ZJ-2026-0007", summary: "付款凭证汇总", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" },
  { dossierNo: "ZJ-2026-0008", summary: "往来邮件公证记录", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" },
  { dossierNo: "ZJ-2026-0009", summary: "证人询问笔录", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" },
  { dossierNo: "ZJ-2026-0010", summary: "鉴定意见补正说明", version: 1, updatedAt: "2026-09-27T08:00:00.000Z" }
];

function load(): DossierEntry[] {
  try {
    const raw = localStorage.getItem(REMOTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { entries?: DossierEntry[] };
      if (Array.isArray(parsed.entries) && parsed.entries.length) return parsed.entries;
    }
  } catch {
    // 本地模拟卷宗系统损坏时回退到初始目录
  }
  return seedRemote.map((entry) => ({ ...entry }));
}

function save(entries: DossierEntry[]) {
  localStorage.setItem(REMOTE_KEY, JSON.stringify({ entries }));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface BatchPlan {
  key: string;
  from: string;
  to: string;
}

export function planBatches(entries: DossierEntry[], capacity = BATCH_CAPACITY): BatchPlan[] {
  const numbers = entries.map((entry) => entry.dossierNo).sort((a, b) => a.localeCompare(b));
  const plans: BatchPlan[] = [];
  for (let index = 0; index < numbers.length; index += capacity) {
    const slice = numbers.slice(index, index + capacity);
    plans.push({ key: `${slice[0]}~${slice[slice.length - 1]}`, from: slice[0], to: slice[slice.length - 1] });
  }
  return plans;
}

export async function fetchCatalogIndex() {
  await delay(200);
  const entries = load();
  return { total: entries.length, capacity: BATCH_CAPACITY, batches: planBatches(entries) };
}

export async function fetchCatalogBatch(key: string, options: { fail?: boolean } = {}): Promise<DossierEntry[]> {
  await delay(320 + Math.random() * 240);
  if (options.fail) throw new Error(`批次 ${key} 拉取失败：卷宗系统连接中断`);
  const [from, to] = key.split("~");
  return load()
    .filter((entry) => entry.dossierNo >= from && entry.dossierNo <= to)
    .sort((a, b) => a.dossierNo.localeCompare(b.dossierNo));
}

export function updateRemoteSummary(dossierNo: string, summary: string) {
  const entries = load();
  const hit = entries.find((entry) => entry.dossierNo === dossierNo);
  if (!hit) return null;
  hit.summary = summary;
  hit.version += 1;
  hit.updatedAt = new Date().toISOString();
  save(entries);
  return hit;
}
