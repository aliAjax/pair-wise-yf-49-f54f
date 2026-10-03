export type Party = "原告" | "被告" | "审判庭";
export type EvidenceStatus = "待展示" | "展示中" | "已展示" | "已跳过" | "待复核";
export type SessionPhase = "开庭" | "举证" | "质证" | "休庭" | "结束";
export type ReconcileStatus = "公开" | "草稿";

export interface CatalogEntry {
  fileNo: string;
  summary: string;
}

export interface CatalogBatch {
  batch: string;
  entries: CatalogEntry[];
  nextBatch: string | null;
}

export type BatchStatus = "idle" | "loading" | "succeeded" | "failed";

export interface CatalogBatchState {
  status: BatchStatus;
  attempt: number;
}

export interface Evidence {
  id: string;
  exhibitNo: string;
  summary: string;
  title: string;
  type: "书证" | "物证" | "电子数据" | "证人";
  duration: number;
  presenter: Party;
  sensitive: boolean;
  status: EvidenceStatus;
  note: string;
  reconcileStatus: ReconcileStatus;
  firstShownSummary?: string;
}

export interface Objection {
  id: string;
  evidenceId: string;
  ground: string;
  explanation: string;
  status: "待裁定" | "支持" | "驳回";
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  time: string;
  actor: Party | "书记员";
  action: string;
  detail: string;
}

export interface SessionState {
  phase: SessionPhase;
  currentEvidenceId: string | null;
  timerSeconds: number;
  operatorMode: "庭审控制" | "公开屏预览";
}
