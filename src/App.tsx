import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, Message, Modal, Radio, Select, Space, Statistic, Switch, Table, Tag, Timeline } from "@arco-design/web-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { NavLink, Route, Routes } from "react-router-dom";
import { useSaveEvidenceMutation, useGetEvidenceQuery, useSimulateCatalogChangeMutation, useSetCatalogFailFlagMutation } from "./store/api";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { addObjection, completeEvidence, initialize, reconcile, reorder, resolveObjection, restore, reviewPassed, selectEvidence, setMode, setOnline, setPhase, showEvidence, snapshot, syncCatalog, retryCatalogBatch, tick, toggleSensitive } from "./store/courtSlice";
import type { Evidence, SessionPhase } from "./types";

const objectionSchema = z.object({ ground: z.string().min(2), explanation: z.string().min(6) });
type ObjectionForm = z.infer<typeof objectionSchema>;

function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

function draftReason(item: Evidence, catalog: { fileNo: string; summary: string }[]): string {
  if (!item.exhibitNo) return "卷宗号缺失";
  const catalogEntry = catalog.find((entry) => entry.fileNo === item.exhibitNo);
  if (!catalogEntry) return "目录中无此卷宗号";
  if (!item.summary) return "摘要缺失";
  if (item.summary !== catalogEntry.summary) return "摘要不一致";
  return "—";
}

function CourtControl() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.court);
  const [mode, setLocalMode] = useState<"控制" | "预览">("控制");
  const [objectionOpen, setObjectionOpen] = useState(false);
  const current = state.evidence.find((item) => item.id === state.session.currentEvidenceId);
  const pending = state.objections.filter((item) => item.status === "待裁定");
  const draftList = state.evidence.filter((item) => item.reconcileStatus === "草稿");
  const reviewList = state.evidence.filter((item) => item.status === "待复核");
  const publicEvidence = state.lastSyncedScreen?.evidence ?? [];
  const publicCurrent = publicEvidence.find((item) => item.id === state.session.currentEvidenceId) ?? publicEvidence[0];
  const { control, handleSubmit, reset } = useForm<ObjectionForm>({ resolver: zodResolver(objectionSchema), defaultValues: { ground: "关联性异议", explanation: "" } });

  useEffect(() => { const timer = window.setInterval(() => dispatch(tick()), 1000); return () => window.clearInterval(timer); }, [dispatch]);
  const submitObjection = (values: ObjectionForm) => { if (!current) return; dispatch(addObjection({ evidenceId: current.id, ...values })); reset(); setObjectionOpen(false); Message.warning("异议已进入待裁定分支"); };

  return <div className="court-grid">
    <Card className="operator" title="证据操作台" extra={<Space><Tag color={state.online ? "green" : "red"}>{state.online ? "本地审计在线" : "离线恢复模式"}</Tag><Button size="small" onClick={() => dispatch(snapshot("手动存档"))}>保存快照</Button></Space>}>
      <div className="evidence-list">{state.evidence.map((item, index) => <article key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData("text/plain")); const items = [...state.evidence]; const [moved] = items.splice(from, 1); items.splice(index, 0, moved); dispatch(reorder(items)); }} className={current?.id === item.id ? "active" : ""}>
        <span>{index + 1}</span><div><b>{item.exhibitNo || "（无卷宗号）"} · {item.title}</b><small>{item.type} · {item.presenter} · {item.duration}分钟</small></div><Tag color={item.status === "已展示" ? "green" : item.status === "展示中" ? "orange" : item.status === "待复核" ? "purple" : "gray"}>{item.status}</Tag>{item.reconcileStatus === "草稿" && <Tag color="red">草稿</Tag>}<Button size="mini" onClick={() => dispatch(selectEvidence(item.id))}>选中</Button>
      </article>)}</div>
      <div className="control-strip"><Button type="primary" onClick={() => dispatch(showEvidence())} disabled={!current || current.status === "待复核"}>开始展示</Button><Button onClick={() => dispatch(completeEvidence())} disabled={!current}>完成并切换下一条</Button><Button status="warning" onClick={() => setObjectionOpen(true)} disabled={!current}>提出异议</Button><Button onClick={() => dispatch(toggleSensitive(current?.id ?? ""))} disabled={!current}>{current?.sensitive ? "恢复敏感内容" : "隐藏敏感内容"}</Button></div>
    </Card>
    <div className="side-stack">
      <Card title="公开屏预览（上次完整同步画面）" extra={<Select size="small" value={mode} onChange={(value) => { setLocalMode(value as "控制" | "预览"); dispatch(setMode(value === "预览" ? "公开屏预览" : "庭审控制")); }} options={[{value:"控制",label:"控制者视图"},{value:"预览",label:"公开屏"}]} />} className="preview-card">
        <div className="public-screen">{mode === "预览" ? <>{publicCurrent ? <><small>公开展示</small><h2>{publicCurrent.exhibitNo}</h2><h3>{publicCurrent.title}</h3>{publicCurrent.sensitive ? <div className="redaction"><b>敏感内容已遮罩</b><p>该证据包含不适宜公开的信息，庭审结束后统一入卷。</p></div> : <p>{publicCurrent.note}</p>}<footer>计时 {formatTime(state.session.timerSeconds)} · {state.session.phase}</footer></> : <><small>等待同步</small><h2>暂无公开画面</h2><p>卷宗目录同步完成后，公开屏将展示完整同步的证据画面。</p></>}</> : <><small>控制者私有视图</small><h2>敏感内容可预览</h2><p>{current?.sensitive ? "此证据将在公开屏遮罩客户名称，控制者可查看完整备注。" : "当前证据可完整公开。"}</p><Tag color="red">操作端专属</Tag></>}</div>
      </Card>
      {reviewList.length > 0 && <Card title="待复核（卷宗摘要已变更）" extra={<Tag color="purple">{reviewList.length}</Tag>}>{reviewList.map((item) => <div className="objection" key={item.id}><b>{item.exhibitNo} · {item.title}</b><p>卷宗摘要已变更，计时已重算并退回待复核。</p><Button size="mini" type="primary" onClick={() => dispatch(reviewPassed(item.id))}>复核通过并恢复</Button></div>)}</Card>}
      {draftList.length > 0 && <Card title="草稿区（未对账）" extra={<Tag color="red">{draftList.length}</Tag>}>{draftList.map((item) => <div className="objection" key={item.id}><b>{item.exhibitNo || "（无卷宗号）"} · {item.title}</b><p>{draftReason(item, state.catalog)}</p></div>)}</Card>}
      <Card title="待审异议" extra={<Tag color="red">{pending.length}</Tag>}>{pending.map((item) => <div className="objection" key={item.id}><b>{item.ground}</b><p>{item.explanation}</p><Space><Button size="mini" status="success" onClick={() => dispatch(resolveObjection({ id: item.id, status: "支持" }))}>支持并跳过</Button><Button size="mini" onClick={() => dispatch(resolveObjection({ id: item.id, status: "驳回" }))}>驳回继续</Button></Space></div>)}{!pending.length && <p>当前没有待裁定异议。</p>}</Card>
    </div>
    <Modal title="提出证据异议" visible={objectionOpen} onCancel={() => setObjectionOpen(false)} onOk={() => handleSubmit(submitObjection)()}><Form layout="vertical"><Form.Item label="异议类型"><Controller name="ground" control={control} render={({ field }) => <Select {...field} options={[{value:"关联性异议",label:"关联性异议"},{value:"真实性异议",label:"真实性异议"},{value:"合法性异议",label:"合法性异议"}]} />} /></Form.Item><Form.Item label="异议说明"><Controller name="explanation" control={control} render={({ field }) => <Input.TextArea {...field} placeholder="说明异议依据和希望法庭裁定的事项" />} /></Form.Item></Form></Modal>
    <Card title="庭审阶段" className="phase-card"><Radio.Group value={state.session.phase} onChange={(value) => dispatch(setPhase(value as SessionPhase))}><Radio value="开庭">开庭</Radio><Radio value="举证">举证</Radio><Radio value="质证">质证</Radio><Radio value="休庭">休庭</Radio><Radio value="结束">结束</Radio></Radio.Group></Card>
  </div>;
}

function ReconcilePage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.court);
  const [simulateChange] = useSimulateCatalogChangeMutation();
  const [setFailFlag] = useSetCatalogFailFlagMutation();
  const batchEntries = Object.entries(state.catalogBatchStatus).sort(([a], [b]) => Number(a) - Number(b));
  const allBatchesSucceeded = batchEntries.length > 0 && batchEntries.every(([, info]) => info.status === "succeeded");
  const hasFailedBatch = batchEntries.some(([, info]) => info.status === "failed");

  const resync = async () => { await dispatch(syncCatalog()); dispatch(reconcile()); };
  const onSimulateChange = async () => { await simulateChange("原告-003"); await resync(); Message.info("已模拟卷宗摘要变更并重新对账"); };
  const onToggleFail = async () => {
    if (hasFailedBatch) {
      await setFailFlag(false);
      await dispatch(retryCatalogBatch("1")).unwrap();
      await resync();
      Message.success("已重试第 2 批并继续拉取后续批次");
    } else {
      await setFailFlag(true);
      await dispatch(syncCatalog());
      Message.warning("已模拟第 2 批拉取失败，仅保留上次结果");
    }
  };

  const columns = [
    { title: "卷宗号", dataIndex: "exhibitNo", width: 120 },
    { title: "标题", dataIndex: "title" },
    { title: "本地摘要", dataIndex: "summary", render: (value: string) => value || <Tag color="red">缺失</Tag> },
    { title: "卷宗目录摘要", render: (_: unknown, row: Evidence) => state.catalog.find((entry) => entry.fileNo === row.exhibitNo)?.summary ?? <Tag color="red">无此卷宗号</Tag> },
    { title: "对账", dataIndex: "reconcileStatus", render: (value: string) => <Tag color={value === "公开" ? "green" : "red"}>{value}</Tag> },
    { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "已展示" ? "green" : value === "展示中" ? "orange" : value === "待复核" ? "purple" : "gray"}>{value}</Tag> },
    { title: "操作", render: (_: unknown, row: Evidence) => row.status === "待复核" ? <Button size="mini" type="primary" onClick={() => dispatch(reviewPassed(row.id))}>复核通过</Button> : null }
  ];

  return <div className="reconcile-grid">
    <Card title="卷宗目录同步" extra={<Space><Tag color={state.catalogSyncing ? "orange" : allBatchesSucceeded ? "green" : "red"}>{state.catalogSyncing ? "同步中" : allBatchesSucceeded ? "全部批次已同步" : hasFailedBatch ? "存在失败批次" : "未同步"}</Tag><Button size="small" onClick={resync} loading={state.catalogSyncing}>重新对账</Button></Space>}>
      <p>目录超过容量时按卷宗号分批拉取；失败后留用上次结果，仅重试失败批次。</p>
      <div className="batch-list">{batchEntries.map(([batch, info]) => <div className="batch" key={batch}><b>第 {Number(batch) + 1} 批</b><Tag color={info.status === "succeeded" ? "green" : info.status === "failed" ? "red" : info.status === "loading" ? "orange" : "gray"}>{info.status === "succeeded" ? "已同步" : info.status === "failed" ? "失败" : info.status === "loading" ? "拉取中" : "空闲"}</Tag>{info.status === "failed" && <Button size="mini" type="primary" onClick={onToggleFail}>重试该批</Button>}</div>)}{!batchEntries.length && <p>尚未开始同步。</p>}</div>
      <Space style={{ marginTop: 12 }}><Button size="small" onClick={onSimulateChange}>模拟卷宗摘要变更</Button><Button size="small" status="warning" onClick={onToggleFail}>{hasFailedBatch ? "清除失败标记并重试第 2 批" : "模拟第 2 批拉取失败"}</Button></Space>
    </Card>
    <Card title="本地证据对账明细"><Table rowKey="id" columns={columns} data={state.evidence} pagination={false} size="small" /></Card>
    <Card title="草稿区说明"><p>卷宗号与内容摘要一致的证据才进公开屏；对不上的先停草稿区。旧数据按首次展示版本回填摘要，补不齐的留在草稿区。</p><ul>{state.evidence.filter((item) => item.reconcileStatus === "草稿").map((item) => <li key={item.id}><b>{item.exhibitNo || "（无卷宗号）"}</b> {item.title} — {draftReason(item, state.catalog)}</li>)}{!state.evidence.some((item) => item.reconcileStatus === "草稿") && <li>当前没有草稿证据。</li>}</ul></Card>
  </div>;
}

function TimelinePage() {
  const state = useAppSelector((root) => root.court);
  const dispatch = useAppDispatch();
  return <div className="timeline-grid"><Card title="庭审时间线"><Timeline>{state.timeline.map((item) => <Timeline.Item key={item.id} label={new Date(item.time).toLocaleTimeString("zh-CN", { hour12: false })}><b>{item.action}</b> <Tag>{item.actor}</Tag><p>{item.detail}</p></Timeline.Item>)}</Timeline></Card><Card title="本地恢复点"><p>每次手动存档或关键操作都会保留当前证据顺序和阶段。</p>{state.snapshots.map((item) => <div className="snapshot" key={item.id}><b>{item.label}</b><small>{new Date(item.time).toLocaleString("zh-CN")}</small><Button size="mini" onClick={() => dispatch(restore(item.id))}>恢复</Button></div>)}</Card></div>;
}

function EvidencePage() {
  const state = useAppSelector((root) => root.court);
  const dispatch = useAppDispatch();
  return <Card title="证据目录与公开属性"><div className="catalog">{state.evidence.map((item) => <article key={item.id}><div><b>{item.exhibitNo} {item.title}</b><p>{item.note}</p></div><Space><Tag color={item.reconcileStatus === "公开" ? "green" : "red"}>{item.reconcileStatus}</Tag><Tag>{item.type}</Tag></Space><div className="switch-line"><span>公开屏敏感遮罩</span><Switch checked={item.sensitive} onChange={() => dispatch(toggleSensitive(item.id))} /></div></article>)}</div></Card>;
}

export default function App() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.court);
  const { data = [] } = useGetEvidenceQuery();
  const [save] = useSaveEvidenceMutation();
  const { t, i18n } = useTranslation();
  useEffect(() => { if (data.length) dispatch(initialize(data)); }, [data, dispatch]);
  useEffect(() => { dispatch(syncCatalog()); }, [dispatch]);
  useEffect(() => { if (state.catalog.length) dispatch(reconcile()); }, [state.catalog, dispatch]);
  useEffect(() => { const timer = window.setTimeout(() => void save(state.evidence), 300); return () => window.clearTimeout(timer); }, [state.evidence, save]);
  const metrics = useMemo(() => ({ shown: state.evidence.filter((item) => item.status === "已展示").length, sensitive: state.evidence.filter((item) => item.sensitive).length, objections: state.objections.length, draft: state.evidence.filter((item) => item.reconcileStatus === "草稿").length, review: state.evidence.filter((item) => item.status === "待复核").length }), [state]);
  return <div className="shell"><aside><div className="brand"><b>COURT</b><span>庭审控制</span></div><nav><NavLink to="/">{t("control")}</NavLink><NavLink to="/evidence">证据目录</NavLink><NavLink to="/reconcile">对账中心{metrics.draft > 0 && <Tag color="red" size="small">{metrics.draft}</Tag>}{metrics.review > 0 && <Tag color="purple" size="small">{metrics.review}</Tag>}</NavLink><NavLink to="/timeline">{t("timeline")}</NavLink></nav><Button onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}>{i18n.language === "zh" ? "EN" : "中文"}</Button></aside><main><header><div><small>案件号 2026-民初-1084 · 全流程审计开启</small><h1>{t("title")}</h1></div><div className="top-tools"><label>本地恢复 <Switch checked={!state.online} onChange={(value) => dispatch(setOnline(!value))} /></label><Tag color={state.online ? "green" : "orange"}>{state.online ? "协作同步" : "离线操作"}</Tag></div></header><section className="metrics"><Card><Statistic title="证据总数" value={state.evidence.length} /></Card><Card><Statistic title="已完成质证" value={metrics.shown} /></Card><Card><Statistic title="草稿证据" value={metrics.draft} /></Card><Card><Statistic title="待复核" value={metrics.review} /></Card><Card><Statistic title="异议记录" value={metrics.objections} /></Card></section><Routes><Route path="/" element={<CourtControl />} /><Route path="/evidence" element={<EvidencePage />} /><Route path="/reconcile" element={<ReconcilePage />} /><Route path="/timeline" element={<TimelinePage />} /></Routes></main></div>;
}
