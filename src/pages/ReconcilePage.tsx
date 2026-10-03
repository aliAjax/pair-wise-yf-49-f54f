import { useMemo, useState } from "react";
import { Button, Card, Form, Input, Message, Modal, Select, Space, Switch, Tag } from "@arco-design/web-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { buildCatalogMap, draftReason, normalizeSummary } from "../app/reconcile";
import { updateRemoteSummary } from "../app/dossierSystem";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { backfillSummaries, reviewEvidence, setFailNextBatch, updateEvidenceMeta, addEvidence } from "../store/courtSlice";
import { syncCatalog } from "../store/sync";
import type { Evidence, ReconcileStatus } from "../types";

const reconcileColor: Record<ReconcileStatus, string> = { 对账通过: "green", 待复核: "orange", 草稿区: "gray", 待对账: "blue" };
const batchColor: Record<string, string> = { 成功: "green", 失败: "red", 拉取中: "orange", 待拉取: "gray" };

const addSchema = z.object({
  title: z.string().min(2, "请填写证据名称"),
  type: z.enum(["书证", "物证", "电子数据", "证人"]),
  presenter: z.enum(["原告", "被告", "审判庭"]),
  duration: z.number().min(1).max(120),
  note: z.string().min(2, "请填写备注"),
  dossierNo: z.string().optional(),
  summary: z.string().optional()
});
type AddForm = z.infer<typeof addSchema>;

function DraftRow({ item, reason }: { item: Evidence; reason: string }) {
  const dispatch = useAppDispatch();
  const [dossierNo, setDossierNo] = useState(item.dossierNo ?? "");
  const [summary, setSummary] = useState(item.summary);
  return <article className="draft-row">
    <div><b>{item.exhibitNo} · {item.title}</b><small>{item.type} · {item.presenter}</small></div>
    <Tag color="gray">{reason}</Tag>
    <Input size="small" placeholder="正式卷宗号，如 ZJ-2026-0003" value={dossierNo} onChange={setDossierNo} />
    <Input size="small" placeholder="内容摘要（与卷宗目录一致）" value={summary} onChange={setSummary} />
    <Button size="mini" type="outline" onClick={() => { dispatch(updateEvidenceMeta({ id: item.id, dossierNo, summary })); Message.success("已修订并重新对账"); }}>保存并重新对账</Button>
  </article>;
}

export default function ReconcilePage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.court);
  const catalog = useMemo(() => buildCatalogMap(state.catalog.batches, state.catalog.order), [state.catalog]);
  const [editing, setEditing] = useState<{ dossierNo: string; summary: string } | null>(null);
  const { control, handleSubmit, reset } = useForm<AddForm>({ resolver: zodResolver(addSchema), defaultValues: { title: "", type: "书证", presenter: "原告", duration: 5, note: "", dossierNo: "", summary: "" } });

  const batches = state.catalog.order.map((key) => state.catalog.batches[key]).filter(Boolean);
  const failedCount = batches.filter((batch) => batch.status === "失败").length;
  const pendingReview = state.evidence.filter((item) => item.reconcile === "待复核");
  const drafts = state.evidence.filter((item) => item.reconcile === "草稿区");
  const passed = state.evidence.filter((item) => item.reconcile === "对账通过");
  const entries = [...catalog.values()].sort((a, b) => a.dossierNo.localeCompare(b.dossierNo));

  const runSync = (onlyFailed: boolean) => {
    if (!state.online) { Message.warning("离线模式：留用上次同步结果，恢复在线后再拉取"); return; }
    void dispatch(syncCatalog({ onlyFailed }));
  };
  const submitAdd = (values: AddForm) => {
    dispatch(addEvidence({ ...values, dossierNo: values.dossierNo ?? "", summary: values.summary ?? "" }));
    reset();
    Message.success(values.dossierNo ? "已补录并参与对账" : "已补录，缺正式卷宗号，先停草稿区");
  };

  return <div className="reconcile-grid">
    <div className="side-stack">
      <Card title="卷宗目录同步" extra={<Tag color={state.online ? "green" : "red"}>{state.online ? "在线" : "离线"}</Tag>}>
        <div className="sync-bar">
          <Button type="primary" loading={state.catalog.syncing} disabled={!state.online} onClick={() => runSync(false)}>全量同步</Button>
          <Button status="warning" disabled={!state.online || !failedCount} loading={state.catalog.syncing} onClick={() => runSync(true)}>仅重试失败批次（{failedCount}）</Button>
          <label className="fail-toggle"><Switch size="small" checked={state.catalog.failNextBatch} onChange={(value) => dispatch(setFailNextBatch(value))} />模拟下一批拉取失败</label>
        </div>
        <p className="sync-meta">目录 {state.catalog.total} 条 · 容量 {state.catalog.capacity} 条/批 · 共 {batches.length} 批 · 最近完整同步 {state.catalog.lastFullSyncAt ? new Date(state.catalog.lastFullSyncAt).toLocaleTimeString("zh-CN", { hour12: false }) : "尚未完成"}</p>
        <div className="batch-list">{batches.map((batch) => <div className="batch-row" key={batch.key}>
          <b>{batch.key}</b>
          <Tag color={batchColor[batch.status]}>{batch.status}</Tag>
          <small>{batch.entries.length} 条 · 尝试 {batch.attempts} 次{batch.status === "失败" && batch.entries.length ? " · 已留用上次结果" : ""}</small>
          {batch.message && <small className="batch-error">{batch.message}</small>}
        </div>)}</div>
      </Card>
      <Card title="卷宗目录（对账基准）">
        <div className="batch-list">{entries.map((entry) => <div className="batch-row" key={entry.dossierNo}>
          <b>{entry.dossierNo}</b><span>{entry.summary}</span>
          <small>v{entry.version} · {new Date(entry.updatedAt).toLocaleDateString("zh-CN")}</small>
          <Button size="mini" onClick={() => setEditing({ dossierNo: entry.dossierNo, summary: entry.summary })}>模拟摘要改动</Button>
        </div>)}</div>
      </Card>
      <Card title="临场补录">
        <Form layout="vertical" onSubmit={handleSubmit(submitAdd)}>
          <Form.Item label="证据名称"><Controller name="title" control={control} render={({ field }) => <Input {...field} placeholder="如：补充质证笔录" />} /></Form.Item>
          <div className="form-pair">
            <Form.Item label="类型"><Controller name="type" control={control} render={({ field }) => <Select {...field} options={["书证", "物证", "电子数据", "证人"].map((value) => ({ value, label: value }))} />} /></Form.Item>
            <Form.Item label="举证方"><Controller name="presenter" control={control} render={({ field }) => <Select {...field} options={["原告", "被告", "审判庭"].map((value) => ({ value, label: value }))} />} /></Form.Item>
            <Form.Item label="时长(分)"><Controller name="duration" control={control} render={({ field }) => <Input type="number" value={String(field.value)} onChange={(value) => field.onChange(Number(value) || 0)} onBlur={field.onBlur} name={field.name} />} /></Form.Item>
          </div>
          <Form.Item label="备注"><Controller name="note" control={control} render={({ field }) => <Input {...field} placeholder="公开屏备注" />} /></Form.Item>
          <Form.Item label="正式卷宗号（临场可空缺）"><Controller name="dossierNo" control={control} render={({ field }) => <Input {...field} placeholder="留空则先停草稿区" />} /></Form.Item>
          <Form.Item label="内容摘要"><Controller name="summary" control={control} render={({ field }) => <Input {...field} placeholder="与卷宗目录摘要保持一致" />} /></Form.Item>
          <Button htmlType="submit" type="primary" long>补录并立即对账</Button>
        </Form>
      </Card>
    </div>
    <div className="side-stack">
      <Card title="待复核（卷宗摘要已变更）" extra={<Tag color="orange">{pendingReview.length}</Tag>}>
        {pendingReview.map((item) => {
          const entry = item.dossierNo ? catalog.get(item.dossierNo) : undefined;
          const localMatches = entry ? normalizeSummary(item.summary) === normalizeSummary(entry.summary) : false;
          return <div className="review-row" key={item.id}>
            <b>{item.exhibitNo} · {item.title}</b>
            <div className="diff"><small>本地摘要</small><p>{item.summary || "（空）"}</p><small>卷宗摘要 {item.dossierNo}</small><p>{entry?.summary ?? "（目录缺失）"}</p></div>
            <Space>
              <Button size="mini" type="primary" disabled={!entry} onClick={() => dispatch(reviewEvidence({ id: item.id, adoptCatalogSummary: true }))}>采纳卷宗摘要并复核通过</Button>
              <Button size="mini" disabled={!localMatches} onClick={() => dispatch(reviewEvidence({ id: item.id, adoptCatalogSummary: false }))}>按本地摘要复核通过</Button>
            </Space>
          </div>;
        })}
        {!pendingReview.length && <p>没有待复核证据。</p>}
      </Card>
      <Card title="草稿区（对不上，不进公开屏）" extra={<Space><Tag color="gray">{drafts.length}</Tag><Button size="mini" onClick={() => { dispatch(backfillSummaries()); Message.success("已按首次展示版本回填，补不齐的留在草稿区"); }}>旧数据回填</Button></Space>}>
        {drafts.map((item) => <DraftRow key={item.id} item={item} reason={draftReason(item, catalog)} />)}
        {!drafts.length && <p>草稿区为空，全部证据均已对账。</p>}
      </Card>
      <Card title="对账通过（可进公开屏）" extra={<Tag color="green">{passed.length}</Tag>}>
        <div className="batch-list">{passed.map((item) => <div className="batch-row" key={item.id}>
          <b>{item.exhibitNo}</b><span>{item.title}</span><small>{item.dossierNo}</small><Tag color={reconcileColor[item.reconcile]}>{item.reconcile}</Tag>
        </div>)}</div>
      </Card>
    </div>
    <Modal title={`模拟卷宗摘要改动 · ${editing?.dossierNo ?? ""}`} visible={!!editing} onCancel={() => setEditing(null)} onOk={() => {
      if (!editing) return;
      updateRemoteSummary(editing.dossierNo, editing.summary);
      setEditing(null);
      Message.warning("卷宗系统摘要已变更，重新同步后已展示证据将退回待复核");
    }}>
      <Form layout="vertical"><Form.Item label="卷宗摘要"><Input.TextArea value={editing?.summary ?? ""} onChange={(value) => setEditing((prev) => prev ? { ...prev, summary: value } : prev)} /></Form.Item></Form>
    </Modal>
  </div>;
}
