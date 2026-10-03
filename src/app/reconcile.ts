import type { CatalogBatch, DossierEntry, Evidence } from "../types";

export function normalizeSummary(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

export function buildCatalogMap(batches: Record<string, CatalogBatch>, order: string[]) {
  const map = new Map<string, DossierEntry>();
  for (const key of order) {
    const batch = batches[key];
    if (!batch) continue;
    for (const entry of batch.entries) map.set(entry.dossierNo, entry);
  }
  return map;
}

export type MatchResult = "match" | "mismatch" | "missing";

export function matchEvidence(item: Evidence, catalog: Map<string, DossierEntry>): MatchResult {
  if (!item.dossierNo) return "missing";
  const entry = catalog.get(item.dossierNo);
  if (!entry) return "missing";
  return normalizeSummary(item.summary) === normalizeSummary(entry.summary) ? "match" : "mismatch";
}

export function draftReason(item: Evidence, catalog: Map<string, DossierEntry>) {
  if (!item.dossierNo) return "缺正式卷宗号";
  if (!catalog.has(item.dossierNo)) return "目录无此卷宗号";
  if (!item.summary.trim()) return "摘要待回填";
  return "摘要与卷宗不一致";
}
