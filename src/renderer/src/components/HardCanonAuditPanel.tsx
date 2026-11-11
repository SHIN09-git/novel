import { useMemo, useState } from 'react'
import type { HardCanonAuditFinding, HardCanonAuditResult } from '../../../shared/types'
import { hardCanonEvidenceContext } from '../../../shared/hardCanonEvidence'
import { hardCanonAuditMatchesBody } from '../../../services/qualityGate/hardCanonQuality'
import { StatusBadge } from './UI'

const headings = {
  draft: '当前草稿 · 硬设定核查',
  chapter: '当前章节 · 硬设定核查',
  historical_version: '历史正文 · 按现行规则核对',
  report_snapshot: '审稿当时的硬设定核查'
}

export interface HardCanonAuditPanelProps {
  audit: HardCanonAuditResult | null
  scope?: keyof typeof headings
  /** Optional selected text, used only to show the sentence surrounding a matched span. */
  body?: string
}

function evidenceText(item: HardCanonAuditFinding, body?: string) {
  const context = hardCanonEvidenceContext(item, body)
  return context ? <>{context.before}<mark>{item.excerpt}</mark>{context.after}</> : item.excerpt
}

function EvidenceList({ findings, body }: { findings: HardCanonAuditFinding[]; body?: string }) {
  const [limit, setLimit] = useState(12)
  return <>
    <ol className="hard-canon-evidence">
      {findings.slice(0, limit).map((item, index) => <li key={`${item.ruleId}:${item.start}:${index}`}>
        <div><StatusBadge tone={item.severity === 'block' ? 'danger' : 'warning'}>
          {item.severity === 'block' ? '确证违反' : '仅供复核'}
        </StatusBadge> <strong>{item.ruleTitle}</strong></div>
        <span>{item.reason}</span>
        {item.excerpt && <blockquote>{evidenceText(item, body)}</blockquote>}
        <small title="位置按原文的 UTF-16 偏移换算，从 1 起计。">
          {item.end > item.start ? `正文第 ${item.start + 1} 至 ${item.end} 位 · ` : ''}
          规则 {item.ruleId} · 版本 {item.ruleVersion}
        </small>
      </li>)}
    </ol>
    {limit < findings.length && <button className="ghost-button" onClick={() => setLimit(limit + 12)}>
      查看更多证据（剩余 {findings.length - limit} 处）
    </button>}
  </>
}

export function HardCanonAuditPanel({ audit, scope = 'draft', body }: HardCanonAuditPanelProps) {
  const matchesText = useMemo(() => audit && body !== undefined ? hardCanonAuditMatchesBody(audit, body) : null, [audit, body])
  const { findings, blocks, titles } = useMemo(() => {
    const blocking: HardCanonAuditFinding[] = [], hints: HardCanonAuditFinding[] = []
    const titles = new Map<string, string>()
    for (const item of audit?.findings ?? []) {
      if (item.severity === 'block') blocking.push(item)
      else hints.push(item)
      titles.set(item.ruleId, item.ruleTitle)
    }
    return { findings: [...blocking, ...hints], blocks: blocking.length, titles }
  }, [audit])
  return (
    <section className="hard-canon-audit" aria-label={headings[scope]}>
      <h4>{headings[scope]}</h4>
      {matchesText === false && scope !== 'report_snapshot' ? <p>正文已变化，请重新核查后查看原句。</p>
      : !audit ? <p className="muted">{scope === 'report_snapshot' ? '该报告没有保存硬设定核查记录。' : '没有可显示的硬设定核查结果。'}</p> : <>
        <p>第 {audit.chapterOrder} 章 · {audit.checkedRuleIds.length ? `核对 ${audit.checkedRuleIds.length} 条规则，${blocks} 处确证违反，${findings.length - blocks} 处待复核。` : '本章没有适用的可执行规则。'}</p>
        {findings.length > 0 && <EvidenceList key={`${audit.rulesFingerprint}:${audit.rawBodyFingerprint}`}
          findings={findings} body={matchesText ? body : undefined} />}
        {audit.counts.length > 0 && <div>
          <h5>用语次数</h5>
          <ul className="hard-canon-counts">
            {audit.counts.map((item) => <li key={item.ruleId}>
              <strong>{titles.get(item.ruleId) ?? item.ruleId}</strong>
              <span>本章 {item.chapterCount} 次；已采纳全书 {item.bookCount} 次；采纳此稿后 {item.projectedBookCount} 次（变化 {item.delta > 0 ? '+' : ''}{item.delta} 次）。</span>
            </li>)}
          </ul>
        </div>}
        <details>
          <summary>核查依据</summary>
          <p>正文指纹：<code>{audit.draftContentHash}</code></p>
          <p>原文定位指纹：<code>{audit.rawBodyFingerprint}</code></p>
          <p>规则指纹：<code>{audit.rulesFingerprint}</code></p>
          <p>核对的规则：{audit.checkedRuleIds.join('、') || '无'}</p>
        </details>
      </>}
    </section>
  )
}
