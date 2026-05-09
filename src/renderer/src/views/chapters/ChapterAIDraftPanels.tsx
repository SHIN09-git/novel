import type {
  ChapterReviewDraft,
  Character,
  CharacterStateChangeSuggestion,
  CharacterStateSuggestion,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatus,
  ForeshadowingStatusChangeSuggestion,
  NextChapterSuggestions
} from '../../../../shared/types'
import { TextArea } from '../../components/FormFields'
import { statusLabel, weightLabel } from '../../utils/format'
import type { ReviewTextField } from './chapterViewTypes'

interface ChapterAIDraftPanelsProps {
  selectedOrder: number
  rawAIText: string
  reviewDraft: ChapterReviewDraft | null
  reviewFields: Array<{ key: ReviewTextField; label: string }>
  characters: Character[]
  characterSuggestions: CharacterStateSuggestion[]
  foreshadowings: Foreshadowing[]
  foreshadowingDraft: ForeshadowingExtractionResult | null
  nextSuggestions: NextChapterSuggestions | null
  onSetReviewDraft: (draft: ChapterReviewDraft) => void
  onApplyAllReviewDraft: () => void
  onApplyReviewField: (field: ReviewTextField) => void
  onSaveContinuityBridge: (suggestion: ChapterReviewDraft['continuityBridgeSuggestion']) => void
  onApplyCharacterSuggestion: (suggestion: CharacterStateSuggestion) => void
  onCreateStateChangeCandidate: (suggestion: CharacterStateChangeSuggestion) => void
  onApplyForeshadowingCandidate: (candidate: ForeshadowingCandidate, status?: ForeshadowingStatus) => void
  onApplyStatusChange: (change: ForeshadowingStatusChangeSuggestion) => void
  onSetNextSuggestions: (suggestions: NextChapterSuggestions) => void
  onApplyNextSuggestions: () => void
}

export function ChapterAIDraftPanels({
  selectedOrder,
  rawAIText,
  reviewDraft,
  reviewFields,
  characters,
  characterSuggestions,
  foreshadowings,
  foreshadowingDraft,
  nextSuggestions,
  onSetReviewDraft,
  onApplyAllReviewDraft,
  onApplyReviewField,
  onSaveContinuityBridge,
  onApplyCharacterSuggestion,
  onCreateStateChangeCandidate,
  onApplyForeshadowingCandidate,
  onApplyStatusChange,
  onSetNextSuggestions,
  onApplyNextSuggestions
}: ChapterAIDraftPanelsProps) {
  return (
    <>
      {rawAIText ? (
        <div className="panel ai-draft-panel">
          <h2>AI 原始返回</h2>
          <p className="muted">解析失败时保留原始文本，方便手动复制。</p>
          <textarea className="prompt-editor" value={rawAIText} readOnly />
        </div>
      ) : null}

      {reviewDraft ? (
        <div className="panel ai-draft-panel">
          <div className="panel-title-row">
            <h2>章节复盘草稿预览</h2>
            <button className="primary-button" onClick={onApplyAllReviewDraft}>
              应用到章节复盘
            </button>
          </div>
          <div className="form-grid">
            {reviewFields.map((field) => (
              <div key={field.key} className="draft-field">
                <TextArea
                  label={field.label}
                  value={reviewDraft[field.key]}
                  onChange={(value) => onSetReviewDraft({ ...reviewDraft, [field.key]: value })}
                />
                <div className="row-actions">
                  <button className="primary-button" onClick={() => onApplyReviewField(field.key)}>
                    应用
                  </button>
                  <button className="ghost-button" onClick={() => onSetReviewDraft({ ...reviewDraft, [field.key]: '' })}>
                    忽略
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="panel continuity-mini-panel">
            <h3>下一章衔接建议</h3>
            <div className="form-grid">
              <TextArea
                label="结尾位置"
                value={reviewDraft.continuityBridgeSuggestion.lastSceneLocation}
                onChange={(lastSceneLocation) =>
                  onSetReviewDraft({
                    ...reviewDraft,
                    continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastSceneLocation }
                  })
                }
              />
              <TextArea
                label="身体状态"
                value={reviewDraft.continuityBridgeSuggestion.lastPhysicalState}
                onChange={(lastPhysicalState) =>
                  onSetReviewDraft({
                    ...reviewDraft,
                    continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastPhysicalState }
                  })
                }
              />
              <TextArea
                label="情绪状态"
                value={reviewDraft.continuityBridgeSuggestion.lastEmotionalState}
                onChange={(lastEmotionalState) =>
                  onSetReviewDraft({
                    ...reviewDraft,
                    continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastEmotionalState }
                  })
                }
              />
              <TextArea
                label="未完成动作"
                value={reviewDraft.continuityBridgeSuggestion.lastUnresolvedAction}
                onChange={(lastUnresolvedAction) =>
                  onSetReviewDraft({
                    ...reviewDraft,
                    continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastUnresolvedAction }
                  })
                }
              />
              <TextArea
                label="下一章必须接住"
                value={reviewDraft.continuityBridgeSuggestion.immediateNextBeat}
                onChange={(immediateNextBeat) =>
                  onSetReviewDraft({
                    ...reviewDraft,
                    continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, immediateNextBeat }
                  })
                }
              />
              <TextArea
                label="禁止重置"
                value={reviewDraft.continuityBridgeSuggestion.mustNotReset}
                onChange={(mustNotReset) =>
                  onSetReviewDraft({
                    ...reviewDraft,
                    continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, mustNotReset }
                  })
                }
              />
            </div>
            <button className="primary-button" onClick={() => onSaveContinuityBridge(reviewDraft.continuityBridgeSuggestion)}>
              保存为下一章衔接状态
            </button>
          </div>
          {reviewDraft.characterStateChangeSuggestions.length > 0 ? (
            <div className="panel continuity-mini-panel">
              <h3>角色状态变化候选</h3>
              <p className="muted">这些变化不会自动写入状态账本。加入候选后，可在角色页确认应用。</p>
              <div className="candidate-list">
                {reviewDraft.characterStateChangeSuggestions.map((suggestion) => {
                  const character = characters.find((item) => item.id === suggestion.characterId)
                  return (
                    <article key={`${suggestion.characterId}-${suggestion.key}-${suggestion.evidence}`} className="candidate-card">
                      <h3>{character?.name ?? '未知角色'} · {suggestion.label}</h3>
                      <p>{String(suggestion.beforeValue ?? '未记录')} → {String(suggestion.afterValue ?? '未记录')}</p>
                      <p>{suggestion.evidence || '暂无证据文本'}</p>
                      <p>类别：{suggestion.category} · 风险：{suggestion.riskLevel} · 置信度：{Math.round(suggestion.confidence * 100)}%</p>
                      <button className="primary-button" onClick={() => onCreateStateChangeCandidate(suggestion)}>
                        加入待确认状态候选
                      </button>
                    </article>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {characterSuggestions.length > 0 ? (
        <div className="panel ai-draft-panel">
          <h2>角色状态候选变更</h2>
          <div className="candidate-list">
            {characterSuggestions.map((suggestion) => {
              const character = characters.find((item) => item.id === suggestion.characterId)
              if (!character) return null
              return (
                <article key={`${suggestion.characterId}-${suggestion.changeSummary}`} className="candidate-card">
                  <h3>{character.name}</h3>
                  <p>
                    <strong>变化原因：</strong>
                    {suggestion.changeSummary}
                  </p>
                  <p>
                    <strong>原情绪状态：</strong>
                    {character.emotionalState || '待补充'}
                  </p>
                  <p>
                    <strong>建议情绪状态：</strong>
                    {suggestion.newCurrentEmotionalState || '不变'}
                  </p>
                  <p>
                    <strong>原关系状态：</strong>
                    {character.protagonistRelationship || '待补充'}
                  </p>
                  <p>
                    <strong>建议关系状态：</strong>
                    {suggestion.newRelationshipWithProtagonist || '不变'}
                  </p>
                  <p>
                    <strong>建议行动倾向：</strong>
                    {suggestion.newNextActionTendency || '不变'}
                  </p>
                  <p>
                    <strong>关联章节：</strong>第 {selectedOrder} 章 · 置信度 {Math.round(suggestion.confidence * 100)}%
                  </p>
                  <button className="primary-button" onClick={() => onApplyCharacterSuggestion(suggestion)}>
                    应用到角色卡并记录日志
                  </button>
                </article>
              )
            })}
          </div>
        </div>
      ) : null}

      {foreshadowingDraft ? (
        <div className="panel ai-draft-panel">
          <h2>伏笔提取候选</h2>
          <div className="candidate-list">
            {foreshadowingDraft.newForeshadowingCandidates.map((candidate) => (
              <article key={`${candidate.title}-${candidate.description}`} className="candidate-card">
                <h3>{candidate.title}</h3>
                <p>{candidate.description}</p>
                <p>
                  <strong>首次出现：</strong>第 {candidate.firstChapterOrder ?? selectedOrder} 章
                </p>
                <p>
                  <strong>建议权重：</strong>
                  {weightLabel(candidate.suggestedWeight)}
                </p>
                <p>
                  <strong>预计回收：</strong>
                  {candidate.expectedPayoff || '待补充'}
                </p>
                <p>
                  <strong>注意事项：</strong>
                  {candidate.notes || '无'}
                </p>
                <button className="primary-button" onClick={() => onApplyForeshadowingCandidate(candidate)}>
                  加入伏笔账本
                </button>
              </article>
            ))}
            {foreshadowingDraft.abandonedForeshadowingCandidates.map((candidate) => (
              <article key={`abandoned-${candidate.title}-${candidate.description}`} className="candidate-card">
                <h3>{candidate.title}（废弃候选）</h3>
                <p>{candidate.description}</p>
                <button className="ghost-button" onClick={() => onApplyForeshadowingCandidate(candidate, 'abandoned')}>
                  加入为废弃伏笔
                </button>
              </article>
            ))}
            {foreshadowingDraft.statusChanges.map((change) => {
              const item = foreshadowings.find((foreshadowing) => foreshadowing.id === change.foreshadowingId)
              if (!item) return null
              return (
                <article key={`${change.foreshadowingId}-${change.suggestedStatus}`} className="candidate-card">
                  <h3>{item.title}</h3>
                  <p>
                    <strong>当前状态：</strong>
                    {statusLabel(item.status)}
                  </p>
                  <p>
                    <strong>建议新状态：</strong>
                    {statusLabel(change.suggestedStatus)}
                  </p>
                  <p>
                    <strong>证据文本：</strong>
                    {change.evidenceText || '待补充'}
                  </p>
                  <p>
                    <strong>置信度：</strong>
                    {Math.round(change.confidence * 100)}%
                  </p>
                  <button className="primary-button" onClick={() => onApplyStatusChange(change)}>
                    应用状态变更
                  </button>
                </article>
              )
            })}
          </div>
        </div>
      ) : null}

      {nextSuggestions ? (
        <div className="panel ai-draft-panel">
          <h2>下一章风险提醒草稿</h2>
          <div className="form-grid">
            <TextArea
              label="下一章目标"
              value={nextSuggestions.nextChapterGoal}
              onChange={(nextChapterGoal) => onSetNextSuggestions({ ...nextSuggestions, nextChapterGoal })}
            />
            <TextArea
              label="必须推进的冲突"
              value={nextSuggestions.conflictToPush}
              onChange={(conflictToPush) => onSetNextSuggestions({ ...nextSuggestions, conflictToPush })}
            />
            <TextArea
              label="必须保留的悬念"
              value={nextSuggestions.suspenseToKeep}
              onChange={(suspenseToKeep) => onSetNextSuggestions({ ...nextSuggestions, suspenseToKeep })}
            />
            <TextArea
              label="可轻推伏笔"
              value={nextSuggestions.foreshadowingToHint}
              onChange={(foreshadowingToHint) => onSetNextSuggestions({ ...nextSuggestions, foreshadowingToHint })}
            />
            <TextArea
              label="不要提前揭示"
              value={nextSuggestions.foreshadowingNotToReveal}
              onChange={(foreshadowingNotToReveal) => onSetNextSuggestions({ ...nextSuggestions, foreshadowingNotToReveal })}
            />
            <TextArea
              label="建议结尾钩子"
              value={nextSuggestions.suggestedEndingHook}
              onChange={(suggestedEndingHook) => onSetNextSuggestions({ ...nextSuggestions, suggestedEndingHook })}
            />
            <TextArea
              label="读者情绪目标"
              value={nextSuggestions.readerEmotionTarget}
              onChange={(readerEmotionTarget) => onSetNextSuggestions({ ...nextSuggestions, readerEmotionTarget })}
            />
          </div>
          <button className="primary-button" onClick={onApplyNextSuggestions}>
            应用到本章风险提醒
          </button>
        </div>
      ) : null}
    </>
  )
}
