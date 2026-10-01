import type { GenerationRunTrace, PromptContractReplayStatus } from '../../../../shared/types'
import { buildPromptContractReplay } from '../../../../services/PromptContractReplayService'

interface PromptContractReplayPanelProps {
  trace: GenerationRunTrace
}

function statusLabel(status: PromptContractReplayStatus): string {
  if (status === 'complete') return '顺序完整'
  if (status === 'needs_attention') return '需要关注'
  return '契约不完整'
}

export function PromptContractReplayPanel({ trace }: PromptContractReplayPanelProps) {
  const replay = buildPromptContractReplay(trace)

  return (
    <section className={`prompt-contract-replay status-${replay.status}`}>
      <div className="pipeline-card-title">
        <div>
          <h4>模型实际收到的指令</h4>
          <p className="muted">按最终 Prompt 顺序回放，不包含正文或完整 Prompt。</p>
        </div>
        <span className="prompt-contract-status">{statusLabel(replay.status)}</span>
      </div>

      <div className="prompt-contract-metrics" aria-label="Prompt 契约摘要">
        <span>{replay.includedBlocks.length} 个区块</span>
        <span>{replay.finalPromptTokenEstimate} token</span>
        <span>省略 {replay.omittedBlocks.length}</span>
        <span>未满足 {replay.unmetNeedCount}</span>
      </div>
      <p>{replay.summary}</p>

      {replay.issues.length ? (
        <ul className="prompt-contract-issues">
          {replay.issues.map((issue) => (
            <li key={`${issue.code}-${issue.message}`} className={`severity-${issue.severity}`}>
              <strong>{issue.message}</strong>
              {issue.evidence.length ? <span>{issue.evidence.slice(0, 3).join('；')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <details open={replay.status !== 'complete'}>
        <summary>查看最终区块顺序</summary>
        <ol className="prompt-contract-blocks">
          {replay.includedBlocks.map((block) => (
            <li key={`${block.position}-${block.id}`}>
              <div className="prompt-contract-block-title">
                <strong>{block.position}. {block.title}</strong>
                <span>{block.tokenEstimate} token · {block.tokenSharePercent}%</span>
              </div>
              <div className="prompt-contract-tags">
                <span>权威级 {block.authorityPriority}</span>
                <span>{block.source}</span>
                {block.forced ? <span className="is-forced">强制</span> : null}
                {block.compressed ? <span className="is-compressed">已压缩</span> : null}
              </div>
              <p className="muted">{block.reason}</p>
            </li>
          ))}
        </ol>
      </details>

      {replay.omittedBlocks.length ? (
        <details>
          <summary>查看未进入 Prompt 的区块</summary>
          <ul className="prompt-contract-omitted">
            {replay.omittedBlocks.map((block) => (
              <li key={block.id}>
                <strong>{block.title}</strong>
                <span>{block.omittedReason || '无可用内容。'}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
