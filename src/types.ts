export type Party = "原告" | "被告" | "审判庭";
export type EvidenceStatus = "待展示" | "展示中" | "已展示" | "已跳过";
export type SessionPhase = "开庭" | "举证" | "质证" | "休庭" | "结束";
export type ReconcileStatus = "待对账" | "对账通过" | "待复核" | "草稿区";

export interface Evidence {
  id: string;
  exhibitNo: string;
  title: string;
  type: "书证" | "物证" | "电子数据" | "证人";
  duration: number;
  presenter: Party;
  sensitive: boolean;
  status: EvidenceStatus;
  note: string;
  dossierNo: string | null;
  summary: string;
  reconcile: ReconcileStatus;
  firstShownSummary: string | null;
}

export interface DossierEntry {
  dossierNo: string;
  summary: string;
  version: number;
  updatedAt: string;
}

export interface CatalogBatch {
  key: string;
  from: string;
  to: string;
  status: "待拉取" | "拉取中" | "成功" | "失败";
  entries: DossierEntry[];
  attempts: number;
  message: string | null;
}

export interface PublicFrame {
  evidenceId: string | null;
  exhibitNo: string;
  title: string;
  note: string;
  sensitive: boolean;
  timerSeconds: number;
  phase: SessionPhase;
  syncedAt: string;
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
