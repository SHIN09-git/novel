import { useMemo, useState } from 'react'
import type {
  AppData,
  CandidateDecisionAmendment,
  CandidateMemoryPatchAmendment,
  CharacterCardField,
  CharacterStateFactValue,
  ChapterContinuityBridgeSuggestion,
  ChapterReviewMemoryPatch,
  StateFactCategory
} from '../../../../shared/types'
import { previewCandidateDecisions } from '../../../../services/CandidateDecisionService'
import { CharacterStateService } from '../../../../services/CharacterStateService'
import { resolveApplicableMemoryPatch } from '../../../../services/MemoryCandidateService'
import type { DecisionInboxCandidateRef } from '../../../../services/DecisionInboxService'

const STATE_CATEGORIES: Array<{ value: StateFactCategory; label: string }> = [
  { value: 'resource', label: '资源' }, { value: 'inventory', label: '物品' }, { value: 'location', label: '位置' },
  { value: 'physical', label: '身体' }, { value: 'mental', label: '心理' }, { value: 'knowledge', label: '知识' },
  { value: 'relationship', label: '关系' }, { value: 'goal', label: '目标' }, { value: 'promise', label: '承诺' },
  { value: 'secret', label: '秘密' }, { value: 'ability', label: '能力' }, { value: 'status', label: '状态' },
  { value: 'custom', label: '自定义' }
]

const CARD_FIELDS: Array<{ value: CharacterCardField; label: string }> = [
  { value: 'roleFunction', label: '角色功能' }, { value: 'surfaceGoal', label: '表层目标' },
  { value: 'deepNeed', label: '深层需要' }, { value: 'coreFear', label: '核心恐惧' },
  { value: 'decisionLogic', label: '决策逻辑' }, { value: 'abilitiesAndResources', label: '能力与资源' },
  { value: 'weaknessAndCost', label: '弱点与代价' }, { value: 'relationshipTension', label: '关系张力' },
  { value: 'futureHooks', label: '后续钩子' }
]

const REVIEW_FIELDS = [
  ['summary', '章节摘要'], ['newInformation', '新增信息'], ['characterChanges', '角色变化'],
  ['newForeshadowing', '新增伏笔'], ['resolvedForeshadowing', '已回收伏笔'], ['endingHook', '章末钩子'],
  ['riskWarnings', '风险提示']
] as const

const BRIDGE_FIELDS = [
  ['lastSceneLocation', '上一场地点'], ['lastPhysicalState', '身体状态'], ['lastEmotionalState', '情绪状态'],
  ['lastUnresolvedAction', '未完成动作'], ['lastDialogueOrThought', '最后对白或想法'], ['immediateNextBeat', '紧接节拍'],
  ['mustContinueFrom', '必须承接'], ['mustNotReset', '不可重置'], ['openMicroTensions', '未解微张力']
] as const

const STAGE_FIELDS = [
  ['compressedPlotSummary', '压缩剧情'], ['irreversibleChanges', '不可逆变化'],
  ['endingCarryoverState', '结尾承接状态'], ['emotionalAftertaste', '情绪余韵'], ['pacingState', '节奏状态']
] as const

type TextMap = Record<string, string>

function changed(value: string, original: string | undefined): string | undefined {
  return value === (original ?? '') ? undefined : value
}

function fieldMap(entries: ReadonlyArray<readonly [string, string]>, source: object | null | undefined): TextMap {
  const values = source as Record<string, unknown> | null | undefined
  return Object.fromEntries(entries.map(([key]) => [key, typeof values?.[key] === 'string' ? values[key] : '']))
}

function valueKind(value: CharacterStateFactValue | null, preferred?: string): 'string' | 'number' | 'boolean' | 'list' {
  if (preferred === 'number' || preferred === 'boolean' || preferred === 'list') return preferred
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function categoryLabel(category: StateFactCategory | null): string {
  return STATE_CATEGORIES.find((item) => item.value === category)?.label ?? '未分类'
}

function linkedFieldLabels(fields: CharacterCardField[]): string {
  const labels = fields.map((field) => CARD_FIELDS.find((item) => item.value === field)?.label ?? field)
  return labels.length ? labels.join('、') : '无'
}

function snapshotText(snapshot: NonNullable<ReturnType<typeof previewCandidateDecisions>['items'][number]['amendmentPreview']>['before']): string {
  if (snapshot.kind === 'character_state') {
    return `${snapshot.label ?? '未命名状态'} · ${categoryLabel(snapshot.category)} · ${CharacterStateService.formatFactValue(snapshot.targetValue ?? '')} · 挂接：${linkedFieldLabels(snapshot.linkedCardFields)}`
  }
  const patch = snapshot.patch
  if (patch.kind === 'foreshadowing_create') return `${patch.candidate.title}：${patch.candidate.description}`
  if (patch.kind === 'foreshadowing_status_update') return `${patch.summary} · ${patch.suggestedStatus}`
  if (patch.kind === 'timeline_event_create') return `${patch.event.title ?? patch.summary}：${patch.event.result ?? ''}`
  if (patch.kind === 'stage_summary_create') return patch.stageSummary.compressedPlotSummary ?? patch.summary
  if (patch.kind === 'character_state_update') return patch.changeSummary || patch.summary
  return patch.summary
}

function ToggleList({
  options,
  value,
  onChange
}: {
  options: ReadonlyArray<{ value: string; label: string }>
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <div className="inbox-amendment-toggle-list">
      {options.map((option) => {
        const checked = value.includes(option.value)
        return (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((item) => item !== option.value) : [...value, option.value])}
            />
            <span>{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}

function TextFields({
  fields,
  values,
  onChange,
  multiline = true
}: {
  fields: ReadonlyArray<readonly [string, string]>
  values: TextMap
  onChange: (key: string, value: string) => void
  multiline?: boolean
}) {
  return <div className="inbox-amendment-field-grid">
    {fields.map(([key, label]) => (
      <label key={key} className="inbox-amendment-field">
        <span>{label}</span>
        {multiline
          ? <textarea rows={2} value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} />
          : <input value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} />}
      </label>
    ))}
  </div>
}

export function DecisionInboxAmendmentEditor({
  candidate,
  data,
  projectId,
  onAccept,
  onCancel,
  disabled
}: {
  candidate: DecisionInboxCandidateRef
  data: AppData
  projectId: string
  onAccept: (amendment: CandidateDecisionAmendment) => void
  onCancel: () => void
  disabled: boolean
}) {
  const memoryCandidate = candidate.kind === 'memory_update'
    ? data.memoryUpdateCandidates.find((item) => item.id === candidate.id) ?? null : null
  const stateCandidate = candidate.kind === 'character_state_change'
    ? data.characterStateChangeCandidates.find((item) => item.id === candidate.id) ?? null : null
  const memoryPatch = memoryCandidate ? resolveApplicableMemoryPatch(memoryCandidate).patch : null
  const statePreview = stateCandidate ? CharacterStateService.previewStateChangeCandidate(stateCandidate, data) : null
  const stateFact = statePreview?.proposed ?? statePreview?.existing ?? null

  const [summary, setSummary] = useState(memoryPatch?.summary ?? '')
  const [review, setReview] = useState<TextMap>(() => fieldMap(REVIEW_FIELDS, memoryPatch?.kind === 'chapter_review_update' ? memoryPatch.review : undefined))
  const [hasBridge, setHasBridge] = useState(memoryPatch?.kind === 'chapter_review_update' && memoryPatch.continuityBridgeSuggestion !== null)
  const [bridge, setBridge] = useState<TextMap>(() => fieldMap(BRIDGE_FIELDS,
    memoryPatch?.kind === 'chapter_review_update' ? memoryPatch.continuityBridgeSuggestion : undefined))
  const [characterPatch, setCharacterPatch] = useState(() => memoryPatch?.kind === 'character_state_update'
    ? {
        changeSummary: memoryPatch.changeSummary,
        newCurrentEmotionalState: memoryPatch.newCurrentEmotionalState,
        newRelationshipWithProtagonist: memoryPatch.newRelationshipWithProtagonist,
        newNextActionTendency: memoryPatch.newNextActionTendency
      } : null)
  const [foreshadowing, setForeshadowing] = useState(() => memoryPatch?.kind === 'foreshadowing_create'
    ? {
        title: memoryPatch.candidate.title,
        description: memoryPatch.candidate.description,
        suggestedWeight: memoryPatch.candidate.suggestedWeight,
        recommendedTreatmentMode: memoryPatch.candidate.recommendedTreatmentMode ?? '',
        expectedPayoff: memoryPatch.candidate.expectedPayoff,
        relatedCharacterIds: memoryPatch.candidate.relatedCharacterIds,
        notes: memoryPatch.candidate.notes
      } : null)
  const [foreshadowingStatus, setForeshadowingStatus] = useState(() => memoryPatch?.kind === 'foreshadowing_status_update'
    ? {
        suggestedStatus: memoryPatch.suggestedStatus,
        recommendedTreatmentMode: memoryPatch.recommendedTreatmentMode ?? '',
        evidenceText: memoryPatch.evidenceText,
        notes: memoryPatch.notes
      } : null)
  const [stage, setStage] = useState<TextMap>(() => fieldMap(STAGE_FIELDS,
    memoryPatch?.kind === 'stage_summary_create' ? memoryPatch.stageSummary as Record<string, string | undefined> : undefined))
  const [timeline, setTimeline] = useState(() => memoryPatch?.kind === 'timeline_event_create'
    ? {
        title: memoryPatch.event.title ?? '', storyTime: memoryPatch.event.storyTime ?? '',
        participantCharacterIds: memoryPatch.event.participantCharacterIds ?? [], result: memoryPatch.event.result ?? '',
        downstreamImpact: memoryPatch.event.downstreamImpact ?? ''
      } : null)
  const initialStateValue = statePreview?.nextValue ?? stateCandidate?.afterValue ?? ''
  const [stateLabel, setStateLabel] = useState(stateFact?.label ?? '')
  const [stateCategory, setStateCategory] = useState<StateFactCategory>(stateFact?.category ?? 'custom')
  const [stateLinkedFields, setStateLinkedFields] = useState<string[]>(stateFact?.linkedCardFields ?? [])
  const stateValueKind = valueKind(initialStateValue, stateFact?.valueType)
  const [stateTextValue, setStateTextValue] = useState(() => typeof initialStateValue === 'string' ? initialStateValue : '')
  const [stateNumberValue, setStateNumberValue] = useState(() => typeof initialStateValue === 'number' ? String(initialStateValue) : '')
  const [stateBooleanValue, setStateBooleanValue] = useState(() => typeof initialStateValue === 'boolean' ? initialStateValue : false)
  const [stateListItems, setStateListItems] = useState(() => Array.isArray(initialStateValue)
    ? initialStateValue.map((value, index) => ({ id: `initial-${index}`, value })) : [])

  const amendment = useMemo<CandidateDecisionAmendment | null>(() => {
    if (memoryPatch) {
      let patch: CandidateMemoryPatchAmendment
      if (memoryPatch.kind === 'chapter_review_update') {
        const reviewChanges = Object.fromEntries(REVIEW_FIELDS.map(([key]) => [key, changed(review[key] ?? '', memoryPatch.review[key])])
          .filter(([, value]) => value !== undefined)) as Partial<ChapterReviewMemoryPatch['review']>
        const nextBridge: ChapterContinuityBridgeSuggestion | null | undefined = hasBridge
          ? {
              lastSceneLocation: bridge.lastSceneLocation ?? '', lastPhysicalState: bridge.lastPhysicalState ?? '',
              lastEmotionalState: bridge.lastEmotionalState ?? '', lastUnresolvedAction: bridge.lastUnresolvedAction ?? '',
              lastDialogueOrThought: bridge.lastDialogueOrThought ?? '', immediateNextBeat: bridge.immediateNextBeat ?? '',
              mustContinueFrom: bridge.mustContinueFrom ?? '', mustNotReset: bridge.mustNotReset ?? '',
              openMicroTensions: bridge.openMicroTensions ?? ''
            }
          : memoryPatch.continuityBridgeSuggestion ? null : undefined
        const bridgeChanges = nextBridge !== undefined && JSON.stringify(nextBridge) !== JSON.stringify(memoryPatch.continuityBridgeSuggestion)
          ? nextBridge : undefined
        patch = {
          kind: memoryPatch.kind,
          ...(changed(summary, memoryPatch.summary) !== undefined ? { summary } : {}),
          ...(Object.keys(reviewChanges).length ? { review: reviewChanges } : {}),
          ...(bridgeChanges !== undefined ? { continuityBridgeSuggestion: bridgeChanges } : {})
        }
      } else if (memoryPatch.kind === 'character_state_update' && characterPatch) {
        patch = {
          kind: memoryPatch.kind,
          ...(changed(summary, memoryPatch.summary) !== undefined ? { summary } : {}),
          ...(changed(characterPatch.changeSummary, memoryPatch.changeSummary) !== undefined ? { changeSummary: characterPatch.changeSummary } : {}),
          ...(changed(characterPatch.newCurrentEmotionalState, memoryPatch.newCurrentEmotionalState) !== undefined ? { newCurrentEmotionalState: characterPatch.newCurrentEmotionalState } : {}),
          ...(changed(characterPatch.newRelationshipWithProtagonist, memoryPatch.newRelationshipWithProtagonist) !== undefined ? { newRelationshipWithProtagonist: characterPatch.newRelationshipWithProtagonist } : {}),
          ...(changed(characterPatch.newNextActionTendency, memoryPatch.newNextActionTendency) !== undefined ? { newNextActionTendency: characterPatch.newNextActionTendency } : {})
        }
      } else if (memoryPatch.kind === 'foreshadowing_create' && foreshadowing) {
        const candidateChanges = {
          ...(changed(foreshadowing.title, memoryPatch.candidate.title) !== undefined ? { title: foreshadowing.title } : {}),
          ...(changed(foreshadowing.description, memoryPatch.candidate.description) !== undefined ? { description: foreshadowing.description } : {}),
          ...(foreshadowing.suggestedWeight !== memoryPatch.candidate.suggestedWeight ? { suggestedWeight: foreshadowing.suggestedWeight } : {}),
          ...(foreshadowing.recommendedTreatmentMode !== (memoryPatch.candidate.recommendedTreatmentMode ?? '') && foreshadowing.recommendedTreatmentMode
            ? { recommendedTreatmentMode: foreshadowing.recommendedTreatmentMode as NonNullable<typeof memoryPatch.candidate.recommendedTreatmentMode> } : {}),
          ...(changed(foreshadowing.expectedPayoff, memoryPatch.candidate.expectedPayoff) !== undefined ? { expectedPayoff: foreshadowing.expectedPayoff } : {}),
          ...(JSON.stringify(foreshadowing.relatedCharacterIds) !== JSON.stringify(memoryPatch.candidate.relatedCharacterIds)
            ? { relatedCharacterIds: foreshadowing.relatedCharacterIds } : {}),
          ...(changed(foreshadowing.notes, memoryPatch.candidate.notes) !== undefined ? { notes: foreshadowing.notes } : {})
        }
        patch = { kind: memoryPatch.kind, ...(changed(summary, memoryPatch.summary) !== undefined ? { summary } : {}),
          ...(Object.keys(candidateChanges).length ? { candidate: candidateChanges } : {}) }
      } else if (memoryPatch.kind === 'foreshadowing_status_update' && foreshadowingStatus) {
        patch = {
          kind: memoryPatch.kind,
          ...(changed(summary, memoryPatch.summary) !== undefined ? { summary } : {}),
          ...(foreshadowingStatus.suggestedStatus !== memoryPatch.suggestedStatus ? { suggestedStatus: foreshadowingStatus.suggestedStatus } : {}),
          ...(foreshadowingStatus.recommendedTreatmentMode !== (memoryPatch.recommendedTreatmentMode ?? '') && foreshadowingStatus.recommendedTreatmentMode
            ? { recommendedTreatmentMode: foreshadowingStatus.recommendedTreatmentMode as NonNullable<typeof memoryPatch.recommendedTreatmentMode> } : {}),
          ...(changed(foreshadowingStatus.evidenceText, memoryPatch.evidenceText) !== undefined ? { evidenceText: foreshadowingStatus.evidenceText } : {}),
          ...(changed(foreshadowingStatus.notes, memoryPatch.notes) !== undefined ? { notes: foreshadowingStatus.notes } : {})
        }
      } else if (memoryPatch.kind === 'stage_summary_create') {
        const stageChanges = Object.fromEntries(STAGE_FIELDS.map(([key]) => [key, changed(stage[key] ?? '', memoryPatch.stageSummary[key as keyof typeof memoryPatch.stageSummary] as string | undefined)])
          .filter(([, value]) => value !== undefined))
        patch = { kind: memoryPatch.kind, ...(changed(summary, memoryPatch.summary) !== undefined ? { summary } : {}),
          ...(Object.keys(stageChanges).length ? { stageSummary: stageChanges } : {}) }
      } else if (memoryPatch.kind === 'timeline_event_create' && timeline) {
        const eventChanges = {
          ...(changed(timeline.title, memoryPatch.event.title) !== undefined ? { title: timeline.title } : {}),
          ...(changed(timeline.storyTime, memoryPatch.event.storyTime) !== undefined ? { storyTime: timeline.storyTime } : {}),
          ...(JSON.stringify(timeline.participantCharacterIds) !== JSON.stringify(memoryPatch.event.participantCharacterIds ?? [])
            ? { participantCharacterIds: timeline.participantCharacterIds } : {}),
          ...(changed(timeline.result, memoryPatch.event.result) !== undefined ? { result: timeline.result } : {}),
          ...(changed(timeline.downstreamImpact, memoryPatch.event.downstreamImpact) !== undefined ? { downstreamImpact: timeline.downstreamImpact } : {})
        }
        patch = { kind: memoryPatch.kind, ...(changed(summary, memoryPatch.summary) !== undefined ? { summary } : {}),
          ...(Object.keys(eventChanges).length ? { event: eventChanges } : {}) }
      } else return null
      return Object.keys(patch).length > 1 ? { kind: 'memory', patch } : null
    }
    if (!stateCandidate || !stateFact) return null
    const targetValue: CharacterStateFactValue | null = stateValueKind === 'number'
      ? (stateNumberValue.trim() && Number.isFinite(Number(stateNumberValue)) ? Number(stateNumberValue) : null)
      : stateValueKind === 'boolean' ? stateBooleanValue
        : stateValueKind === 'list' ? stateListItems.map((item) => item.value) : stateTextValue
    if (stateValueKind === 'number' && targetValue === null) return null
    const stateAmendment: CandidateDecisionAmendment = {
      kind: 'character_state',
      ...(stateLabel !== stateFact.label ? { label: stateLabel } : {}),
      ...(stateCategory !== stateFact.category ? { category: stateCategory } : {}),
      ...(JSON.stringify(targetValue) !== JSON.stringify(initialStateValue) ? { targetValue } : {}),
      ...(JSON.stringify(stateLinkedFields) !== JSON.stringify(stateFact.linkedCardFields) ? { linkedCardFields: stateLinkedFields as CharacterCardField[] } : {})
    }
    return Object.keys(stateAmendment).length > 1 ? stateAmendment : null
  }, [bridge, characterPatch, foreshadowing, foreshadowingStatus, hasBridge, initialStateValue, memoryPatch, review, stage,
    stateBooleanValue, stateCandidate, stateCategory, stateFact, stateLabel, stateLinkedFields, stateListItems, stateNumberValue,
    stateTextValue, stateValueKind, summary, timeline])

  const editedPreview = useMemo(() => {
    if (!amendment) return { item: null, error: null }
    try {
      const preview = previewCandidateDecisions(data, {
        projectId,
        decisions: [{ kind: candidate.kind === 'memory_update' ? 'memory' : 'character_state', candidateId: candidate.id, decision: 'accept', amendment }]
      })
      return { item: preview.items[0] ?? null, error: null }
    } catch (error) {
      return { item: null, error: error instanceof Error ? error.message : '无法预览编辑后的变化。' }
    }
  }, [amendment, candidate.id, candidate.kind, data, projectId])

  if (!memoryPatch && !stateFact) {
    return <div className="inbox-amendment-editor"><p className="inbox-amendment-error">此候选没有可编辑的作者字段。</p><button className="ghost-button" type="button" onClick={onCancel}>取消</button></div>
  }

  const characters = data.characters.filter((character) => character.projectId === projectId)
    .map((character) => ({ value: character.id, label: character.name }))
  const updateMap = (setter: (value: TextMap) => void, values: TextMap) => (key: string, value: string) => setter({ ...values, [key]: value })

  return (
    <section className="inbox-amendment-editor" aria-label="编辑后接受">
      <header><strong>编辑后接受</strong><span>只会在确认接受后写入；原候选和证据不会提前改动。</span></header>
      {memoryPatch ? <>
        <label className="inbox-amendment-field inbox-amendment-full"><span>变更摘要</span><textarea rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        {memoryPatch.kind === 'chapter_review_update' ? <>
          <fieldset><legend>章节复盘</legend><TextFields fields={REVIEW_FIELDS} values={review} onChange={updateMap(setReview, review)} /></fieldset>
          <fieldset><legend>章节衔接</legend>
            <label className="inbox-amendment-switch"><input type="checkbox" checked={hasBridge} onChange={(event) => setHasBridge(event.target.checked)} /><span>写入章节衔接</span></label>
            {hasBridge ? <TextFields fields={BRIDGE_FIELDS} values={bridge} onChange={updateMap(setBridge, bridge)} /> : null}
          </fieldset>
        </> : null}
        {memoryPatch.kind === 'character_state_update' && characterPatch ? <TextFields fields={[
          ['changeSummary', '变化说明'], ['newCurrentEmotionalState', '当前情绪'], ['newRelationshipWithProtagonist', '与主角关系'], ['newNextActionTendency', '下一步倾向']
        ]} values={characterPatch} onChange={(key, value) => setCharacterPatch({ ...characterPatch, [key]: value })} /> : null}
        {memoryPatch.kind === 'foreshadowing_create' && foreshadowing ? <fieldset><legend>伏笔内容</legend>
          <TextFields fields={[['title', '标题'], ['description', '描述'], ['expectedPayoff', '预期回收'], ['notes', '备注']]} values={{ title: foreshadowing.title, description: foreshadowing.description, expectedPayoff: foreshadowing.expectedPayoff, notes: foreshadowing.notes }} onChange={(key, value) => setForeshadowing({ ...foreshadowing, [key]: value })} />
          <div className="inbox-amendment-field-grid"><label className="inbox-amendment-field"><span>权重</span><select value={foreshadowing.suggestedWeight} onChange={(event) => setForeshadowing({ ...foreshadowing, suggestedWeight: event.target.value as typeof foreshadowing.suggestedWeight })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="payoff">回收</option></select></label>
          <label className="inbox-amendment-field"><span>处理方式</span><select value={foreshadowing.recommendedTreatmentMode} onChange={(event) => setForeshadowing({ ...foreshadowing, recommendedTreatmentMode: event.target.value })}><option value="">未指定</option><option value="hidden">隐藏</option><option value="hint">暗示</option><option value="advance">推进</option><option value="mislead">误导</option><option value="pause">暂停</option><option value="payoff">回收</option></select></label></div>
          <div className="inbox-amendment-attachment"><span>关联角色</span><ToggleList options={characters} value={foreshadowing.relatedCharacterIds} onChange={(relatedCharacterIds) => setForeshadowing({ ...foreshadowing, relatedCharacterIds })} /></div>
        </fieldset> : null}
        {memoryPatch.kind === 'foreshadowing_status_update' && foreshadowingStatus ? <fieldset><legend>伏笔状态</legend>
          <div className="inbox-amendment-field-grid"><label className="inbox-amendment-field"><span>状态</span><select value={foreshadowingStatus.suggestedStatus} onChange={(event) => setForeshadowingStatus({ ...foreshadowingStatus, suggestedStatus: event.target.value as typeof foreshadowingStatus.suggestedStatus })}><option value="unresolved">未回收</option><option value="partial">部分回收</option><option value="resolved">已回收</option><option value="abandoned">废弃</option></select></label>
          <label className="inbox-amendment-field"><span>处理方式</span><select value={foreshadowingStatus.recommendedTreatmentMode} onChange={(event) => setForeshadowingStatus({ ...foreshadowingStatus, recommendedTreatmentMode: event.target.value })}><option value="">未指定</option><option value="hidden">隐藏</option><option value="hint">暗示</option><option value="advance">推进</option><option value="mislead">误导</option><option value="pause">暂停</option><option value="payoff">回收</option></select></label></div>
          <TextFields fields={[['evidenceText', '证据文本'], ['notes', '备注']]} values={foreshadowingStatus} onChange={(key, value) => setForeshadowingStatus({ ...foreshadowingStatus, [key]: value })} />
        </fieldset> : null}
        {memoryPatch.kind === 'stage_summary_create' ? <fieldset><legend>阶段摘要</legend><TextFields fields={STAGE_FIELDS} values={stage} onChange={updateMap(setStage, stage)} /></fieldset> : null}
        {memoryPatch.kind === 'timeline_event_create' && timeline ? <fieldset><legend>时间线事件</legend>
          <TextFields fields={[['title', '事件标题'], ['storyTime', '故事时间'], ['result', '事件结果'], ['downstreamImpact', '后续影响']]} values={{ title: timeline.title, storyTime: timeline.storyTime, result: timeline.result, downstreamImpact: timeline.downstreamImpact }} onChange={(key, value) => setTimeline({ ...timeline, [key]: value })} />
          <div className="inbox-amendment-attachment"><span>参与角色</span><ToggleList options={characters} value={timeline.participantCharacterIds} onChange={(participantCharacterIds) => setTimeline({ ...timeline, participantCharacterIds })} /></div>
        </fieldset> : null}
      </> : null}
      {stateFact ? <fieldset><legend>角色状态</legend>
        <div className="inbox-amendment-field-grid"><label className="inbox-amendment-field"><span>状态标签</span><input value={stateLabel} onChange={(event) => setStateLabel(event.target.value)} /></label>
        <label className="inbox-amendment-field"><span>类别</span><select value={stateCategory} onChange={(event) => setStateCategory(event.target.value as StateFactCategory)}>{STATE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        <div className="inbox-amendment-field inbox-amendment-full"><span>目标值</span>
          {stateValueKind === 'boolean' ? <label className="inbox-amendment-switch"><input type="checkbox" checked={stateBooleanValue} onChange={(event) => setStateBooleanValue(event.target.checked)} /><span>{stateBooleanValue ? '是' : '否'}</span></label> : null}
          {stateValueKind === 'number' ? <input type="number" value={stateNumberValue} onChange={(event) => setStateNumberValue(event.target.value)} /> : null}
          {stateValueKind === 'string' && (stateFact.category === 'physical' || stateFact.valueType === 'text') ? <textarea rows={3} value={stateTextValue} onChange={(event) => setStateTextValue(event.target.value)} /> : null}
          {stateValueKind === 'string' && stateFact.category !== 'physical' && stateFact.valueType !== 'text' ? <input value={stateTextValue} onChange={(event) => setStateTextValue(event.target.value)} /> : null}
          {stateValueKind === 'list' ? <div className="inbox-amendment-list">{stateListItems.map((item, index) => <div key={item.id}><input aria-label={`列表第 ${index + 1} 项`} value={item.value} onChange={(event) => setStateListItems(stateListItems.map((current) => current.id === item.id ? { ...current, value: event.target.value } : current))} /><button type="button" className="ghost-button" onClick={() => setStateListItems(stateListItems.filter((current) => current.id !== item.id))}>移除</button></div>)}<button type="button" className="ghost-button" onClick={() => setStateListItems([...stateListItems, { id: crypto.randomUUID(), value: '' }])}>添加一项</button></div> : null}
        </div>
        <div className="inbox-amendment-attachment"><span>挂接角色卡</span><ToggleList options={CARD_FIELDS} value={stateLinkedFields} onChange={setStateLinkedFields} /></div>
      </fieldset> : null}
      <div className="inbox-amendment-preview" aria-live="polite">
        {editedPreview.item ? <><strong>变更预览</strong>
          {editedPreview.item.amendmentPreview ? <><span>修改前：{snapshotText(editedPreview.item.amendmentPreview.before)}</span><span>修改后：{snapshotText(editedPreview.item.amendmentPreview.after)}</span></> : null}
          <span>将写入：{editedPreview.item.summary}</span>{editedPreview.item.warnings.length ? <small>{editedPreview.item.warnings.join(' ')}</small> : null}</> : null}
        {editedPreview.error ? <p className="inbox-amendment-error">{editedPreview.error}</p> : null}
        {!amendment ? <span>修改一个字段后，将在这里显示真实预览。</span> : null}
      </div>
      <div className="inbox-amendment-actions"><button className="ghost-button" type="button" disabled={disabled} onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={disabled || !editedPreview.item} onClick={() => amendment && onAccept(amendment)}>预览后接受</button></div>
    </section>
  )
}
