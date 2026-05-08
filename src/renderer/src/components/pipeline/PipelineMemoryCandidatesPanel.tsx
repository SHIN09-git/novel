import type { MemoryUpdateCandidate } from '../../../../shared/types'
import { projectData } from '../../utils/projectData'

type ProjectDataSnapshot = ReturnType<typeof projectData>

function typeLabel(type: MemoryUpdateCandidate['type']) {
  if (type === 'character') return '角色'
  if (type === 'foreshadowing') return '伏笔'
  if (type === 'chapter_review') return '章节复盘'
  if (type === 'stage_summary') return '阶段摘要'
  if (type === 'timeline_event') return '时间线'
  return type
}

function renderMemoryPatchDetails(candidate: MemoryUpdateCandidate, scoped: ProjectDataSnapshot) {
  const patch = candidate.proposedPatch
  if (patch.kind === 'chapter_review_update') {
    return (
      <div className="patch-details">
        <p><strong>本章摘要：</strong>{patch.review.summary || '-'}</p>
        <p><strong>新增信息：</strong>{patch.review.newInformation || '-'}</p>
        <p><strong>角色变化：</strong>{patch.review.characterChanges || '-'}</p>
        <p><strong>新增伏笔：</strong>{patch.review.newForeshadowing || '-'}</p>
        <p><strong>已回收伏笔：</strong>{patch.review.resolvedForeshadowing || '-'}</p>
        <p><strong>结尾钩子：</strong>{patch.review.endingHook || '-'}</p>
        <p><strong>风险提醒：</strong>{patch.review.riskWarnings || '-'}</p>
        {patch.continuityBridgeSuggestion ? <p><strong>下一章衔接：</strong>{patch.continuityBridgeSuggestion.immediateNextBeat || patch.continuityBridgeSuggestion.mustContinueFrom || '-'}</p> : null}
      </div>
    )
  }
  if (patch.kind === 'character_state_update') {
    const character = scoped.characters.find((item) => item.id === patch.characterId)
    return (
      <div className="patch-details">
        <p><strong>角色：</strong>{character?.name ?? patch.characterId}</p>
        <p><strong>变化摘要：</strong>{patch.changeSummary || '-'}</p>
        <p><strong>新情绪状态：</strong>{patch.newCurrentEmotionalState || '-'}</p>
        <p><strong>与主角关系：</strong>{patch.newRelationshipWithProtagonist || '-'}</p>
        <p><strong>下一步行动倾向：</strong>{patch.newNextActionTendency || '-'}</p>
      </div>
    )
  }
  if (patch.kind === 'foreshadowing_create') {
    return (
      <div className="patch-details">
        <p><strong>标题：</strong>{patch.candidate.title || '-'}</p>
        <p><strong>描述：</strong>{patch.candidate.description || '-'}</p>
        <p><strong>权重：</strong>{patch.candidate.suggestedWeight}</p>
        <p><strong>预期回收：</strong>{patch.candidate.expectedPayoff || '-'}</p>
        <p><strong>相关角色：</strong>{patch.candidate.relatedCharacterIds.map((id) => scoped.characters.find((character) => character.id === id)?.name ?? id).join('、') || '-'}</p>
        <p><strong>备注：</strong>{patch.candidate.notes || '-'}</p>
      </div>
    )
  }
  if (patch.kind === 'foreshadowing_status_update') {
    const foreshadowing = scoped.foreshadowings.find((item) => item.id === patch.foreshadowingId)
    return (
      <div className="patch-details">
        <p><strong>伏笔：</strong>{foreshadowing?.title ?? patch.foreshadowingId}</p>
        <p><strong>建议状态：</strong>{patch.suggestedStatus}</p>
        <p><strong>推荐处理方式：</strong>{patch.recommendedTreatmentMode || '-'}</p>
        <p><strong>证据：</strong>{patch.evidenceText || '-'}</p>
        <p><strong>备注：</strong>{patch.notes || '-'}</p>
      </div>
    )
  }
  if (patch.kind === 'legacy_raw') {
    return (
      <div className="patch-details">
        {patch.parseError ? <p><strong>解析失败：</strong>{patch.parseError}</p> : null}
        <pre>{patch.rawText.slice(0, 900)}</pre>
      </div>
    )
  }
  return <pre>{JSON.stringify(patch, null, 2).slice(0, 900)}</pre>
}

export function PipelineMemoryCandidatesPanel({
  candidates,
  scoped,
  onAccept,
  onReject
}: {
  candidates: MemoryUpdateCandidate[]
  scoped: ProjectDataSnapshot
  onAccept: (candidate: MemoryUpdateCandidate) => void
  onReject: (candidate: MemoryUpdateCandidate) => void
}) {
  const pending = candidates.filter((candidate) => candidate.status === 'pending')
  const handled = candidates.filter((candidate) => candidate.status !== 'pending')
  const pendingByType = pending.reduce<Record<string, MemoryUpdateCandidate[]>>((groups, candidate) => {
    const key = candidate.type
    groups[key] = [...(groups[key] ?? []), candidate]
    return groups
  }, {})

  return (
    <section className="pipeline-card pipeline-memory-candidates">
      <div className="pipeline-card-title">
        <h3>记忆候选</h3>
        <span>{pending.length} 待确认</span>
      </div>
      <p className="muted">未确认不会写入长期记忆。请先处理高影响角色、伏笔和章节复盘候选。</p>
      {candidates.length === 0 ? <p className="muted">章节复盘、角色和伏笔候选会在流水线后半段出现。</p> : null}
      {Object.entries(pendingByType).map(([type, items]) => (
        <details key={type} open={type === 'character' || type === 'foreshadowing' || type === 'chapter_review'}>
          <summary>
            {typeLabel(type as MemoryUpdateCandidate['type'])} · {items.length} 条
          </summary>
          <div className="candidate-list compact-list">
            {items.map((candidate) => (
              <article key={candidate.id} className="candidate-card">
                <h3>{typeLabel(candidate.type)}</h3>
                <p>置信度 {Math.round(candidate.confidence * 100)}%</p>
                <p className="muted">{candidate.evidence || '暂无证据文本'}</p>
                {renderMemoryPatchDetails(candidate, scoped)}
                <div className="row-actions">
                  <button className="primary-button" onClick={() => onAccept(candidate)}>
                    接受
                  </button>
                  <button className="danger-button" onClick={() => onReject(candidate)}>
                    拒绝
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      ))}
      {handled.length ? (
        <details>
          <summary>已处理候选 {handled.length} 条</summary>
          <div className="candidate-list compact-list">
            {handled.map((candidate) => (
              <article key={candidate.id} className="candidate-card muted-card">
                <h3>{typeLabel(candidate.type)} · {candidate.status}</h3>
                <p>{candidate.evidence || '暂无证据文本'}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
