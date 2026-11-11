import { useEffect, useId, useRef, useState } from 'react'
import { ChartNoAxesColumn, ChevronDown, Pencil, RefreshCw } from 'lucide-react'
import type { ProjectUsageReport, UsagePhase, UsageTotals } from '../../../../shared/projectUsage'
import type { Project } from '../../../../shared/types'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { getNovelDirectorDataApi } from '../../platform/novelDirectorBridge'
import { ProjectRateEditor } from './ProjectRateEditor'
import { formatUsageAmount } from './usageEstimateText'
import '../../styles/views/project-usage.css'

type Props = { project: Project; saveData: SaveDataHandler }
const phaseNames: Record<UsagePhase, string> = { planning: '规划', writing: '写作', review: '审稿', revision: '修订', extraction: '提取', other: '其他' }
const count = (n: number | null) => n === null ? '未知' : n.toLocaleString('zh-CN')
const recordedAt = (v: string | null) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '未知'

function UsageRow({ label, row }: { label: string; row: UsageTotals }) {
  const t = row.tokens
  return <tr>
    <th scope="row">{label}</th>
    <td>{count(row.requests)} 次<small>失败 {count(row.failedRequests)}</small></td>
    <td>输入 {count(t.promptTokens)}<small>输出 {count(t.completionTokens)}</small></td>
    <td>总计 {count(t.totalTokens)}<small>含缓存 {count(t.cachedPromptTokens)} · 推理 {count(t.reasoningTokens)}</small></td>
    <td>未知 {count(row.unknownUsageRequests)}<small>部分已知 {count(row.partialUsageRequests)}</small></td>
    <td>{row.costs.length ? row.costs.map(c => <span className="usage-currency" key={c.currency}>
      <strong>{c.currency} {formatUsageAmount(c.amount)}</strong>（{count(c.pricedRequests)} 次）</span>) : '无可折算金额'}
      <small>未定价 {count(row.unpricedRequests)} · 订阅 {count(row.subscriptionRequests)}</small></td>
  </tr>
}

function Report({ report }: { report: ProjectUsageReport }) {
  const c = report.coverage
  return <>
    <div className="usage-table-scroll" role="region" aria-label="各环节用量" tabIndex={0}>
      <table className="usage-table"><thead><tr>
        <th>环节</th><th>实际请求</th><th>已知输入 / 输出</th><th>已知 token</th><th>用量回执（次）</th><th>按当前价目折算</th>
      </tr></thead><tbody>
        <UsageRow label="全书" row={report.totals} />
        {report.byPhase.map(row => <UsageRow key={row.phase} label={phaseNames[row.phase]} row={row} />)}
      </tbody></table>
    </div>
    <p>仅汇总已知 token 和可定价回执（含去重的旧回执）。金额按币种分列，不是账单；账户余额未知。</p>
    <details className="usage-coverage"><summary>记录覆盖与缺项</summary>
      <p>记录起止：{recordedAt(c.firstRecordedAt)} 至 {recordedAt(c.lastRecordedAt)}。</p>
      <p>旧逻辑调用 {count(c.legacyCalls)} 次，不计入实际请求数。无用量的旧运行 {count(c.legacyJobsWithoutUsage)} 个；无效记录 {count(c.invalidRecords)} 条。</p>
      <p>作品 JSON 导出不含逐次用量。迁移本地书库时，请一并备份数据文件旁的同名 .usage 文件夹。</p>
    </details>
    {c.unreportedRequests > 0 && <p className="usage-warning">旧重试中有 {count(c.unreportedRequests)} 次未报告实耗，不能按零计算。</p>}
    {report.warnings.length > 0 && <ul className="usage-warnings">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
  </>
}

function OpenPanel({ project, saveData }: Props) {
  const [state, setState] = useState<{ report?: ProjectUsageReport; error?: string }>({})
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  function reload() { setState({}); setRefresh(n => n + 1) }
  useEffect(() => {
    let cancelled = false
    async function read() {
      try {
        const report = await getNovelDirectorDataApi().getProjectUsage(project.id)
        if (report.projectId !== project.id) throw new Error('报表与当前项目不匹配。')
        if (!cancelled) setState({ report })
      } catch {
        if (!cancelled) setState({ error: '未能读取本书用量，请刷新重试。' })
      }
    }
    void read()
    return () => { cancelled = true }
  }, [project.id, refresh])

  return <div className="usage-open">
    <div className="usage-tools">
      <span>本书价目 {count(project.modelRates?.length ?? 0)} 条</span>
      <button type="button" ref={editButton} className="ghost-button" aria-expanded={editing}
        onClick={() => setEditing(v => !v)}><Pencil size={14} />编辑价目</button>
      <button type="button" className="usage-icon" title="刷新用量" aria-label="刷新用量"
        onClick={reload}><RefreshCw size={15} /></button>
    </div>
    {editing && <ProjectRateEditor project={project} saveData={saveData}
      onClose={saved => { setEditing(false); editButton.current?.focus(); if (saved) reload() }} />}
    {state.error ? <p role="alert">{state.error}</p> : state.report ? <Report report={state.report} /> : <p role="status">正在读取本书用量…</p>}
  </div>
}

export function ProjectUsagePanel(props: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <section className="project-usage" aria-label="全书模型用量">
    <h2><button className="usage-disclosure" type="button" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(v => !v)}><ChartNoAxesColumn size={17} />全书模型用量<ChevronDown size={15} /></button></h2>
    <div id={id} hidden={!open}>{open && <OpenPanel key={props.project.id} {...props} />}</div>
  </section>
}
