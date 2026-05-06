import { useEffect, useMemo, useState } from 'react'
import type {
  AppData,
  ID,
  Project,
  QualityGateIssue,
  RevisionRequest,
  RevisionRequestType,
  RevisionSession,
  RevisionVersion
} from '../../../shared/types'
import { AIService } from '../../../services/AIService'
import { EmptyState, Field, SelectField, TextArea } from '../components/FormFields'
import { Header } from '../components/Layout'
import { ActionToolbar, SectionCard } from '../components/UI'
import { newId, now, statusLabel, weightLabel } from '../utils/format'
import { projectData } from '../utils/projectData'
import { upsertGenerationRunTraceByJobId } from '../utils/runTrace'
import { LocalRevisionMergeError, looksLikeFullChapterRevision, mergeLocalRevisionSafely } from '../utils/revisionMerge'
import { applyAcceptedRevisionWriteback, resolveDraftLinkedChapter } from '../utils/revisionWriteback'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: AppData) => Promise<void>
  prefill?: { chapterId: ID | null; draftId: ID | null; requestId: ID } | null
  onPrefillConsumed?: () => void
}

const revisionTypeOptions: Array<{ value: RevisionRequestType; label: string }> = [
  { value: 'reduce_ai_tone', label: '去 AI 味' },
  { value: 'strengthen_conflict', label: '加强冲突' },
  { value: 'polish_style', label: '润色文风' },
  { value: 'improve_dialogue', label: '优化对白' },
  { value: 'compress_pacing', label: '压缩节奏' },
  { value: 'enhance_emotion', label: '增强情绪' },
  { value: 'fix_ooc', label: '修复 OOC' },
  { value: 'fix_continuity', label: '修复连续性' },
  { value: 'fix_worldbuilding', label: '修复设定冲突' },
  { value: 'fix_character_knowledge', label: '修复角色知识越界' },
  { value: 'fix_foreshadowing', label: '修复伏笔误用' },
  { value: 'fix_plot_logic', label: '修复剧情逻辑' },
  { value: 'improve_continuity', label: '加强章节衔接' },
  { value: 'reduce_redundancy', label: '减少冗余' },
  { value: 'compress_description', label: '压缩描写' },
  { value: 'remove_repeated_explanation', label: '删除重复解释' },
  { value: 'strengthen_chapter_transition', label: '强化转场承接' },
  { value: 'rewrite_section', label: '重写局部段落' },
  { value: 'custom', label: '自定义指令' }
]

function revisionTypeName(type: RevisionRequestType): string {
  return revisionTypeOptions.find((option) => option.value === type)?.label ?? '修订'
}

function issueToRevisionType(issue: QualityGateIssue): RevisionRequestType {
  const text = `${issue.type} ${issue.description}`.toLowerCase()
  if (text.includes('continuity') || text.includes('transition') || text.includes('衔接') || text.includes('承接')) return 'improve_continuity'
  if (text.includes('redundancy') || text.includes('repeated') || text.includes('重复') || text.includes('冗余')) return 'reduce_redundancy'
  if (text.includes('description') || text.includes('描写')) return 'compress_description'
  if (text.includes('explanation') || text.includes('解释')) return 'remove_repeated_explanation'
  if (text.includes('ooc') || text.includes('character') || text.includes('角色')) return 'fix_ooc'
  if (text.includes('foreshadow') || text.includes('伏笔')) return 'fix_foreshadowing'
  if (text.includes('pacing') || text.includes('节奏') || text.includes('拖')) return 'compress_pacing'
  if (text.includes('dialogue') || text.includes('对白')) return 'improve_dialogue'
  if (text.includes('ai') || text.includes('套话') || text.includes('style') || text.includes('文风')) return 'reduce_ai_tone'
  return 'custom'
}

export function RevisionStudioView({ data, project, saveData, prefill, onPrefillConsumed }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const drafts = [...scoped.generatedChapterDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const [sourceKind, setSourceKind] = useState<'chapter' | 'draft'>('chapter')
  const [selectedChapterId, setSelectedChapterId] = useState<ID | null>(chapters[0]?.id ?? null)
  const [selectedDraftId, setSelectedDraftId] = useState<ID | null>(drafts[0]?.id ?? null)
  const [revisionType, setRevisionType] = useState<RevisionRequestType>('reduce_ai_tone')
  const [targetRange, setTargetRange] = useState('')
  const [instruction, setInstruction] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState<ID | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  useEffect(() => {
    if (!prefill) return
    const request = data.revisionRequests.find((item) => item.id === prefill.requestId)
    if (prefill.chapterId) setSelectedChapterId(prefill.chapterId)
    if (prefill.draftId) {
      setSourceKind('draft')
      setSelectedDraftId(prefill.draftId)
    } else {
      setSourceKind('chapter')
    }
    if (request) {
      setRevisionType(request.type)
      setTargetRange(request.targetRange)
      setInstruction(request.instruction)
    }
    onPrefillConsumed?.()
  }, [prefill, data.revisionRequests, onPrefillConsumed])

  useEffect(() => {
    if (!selectedChapterId && chapters[0]) setSelectedChapterId(chapters[0].id)
  }, [chapters, selectedChapterId])

  useEffect(() => {
    if (!selectedDraftId && drafts[0]) setSelectedDraftId(drafts[0].id)
  }, [drafts, selectedDraftId])

  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null
  const linkedDraftChapter = sourceKind === 'draft' ? resolveDraftLinkedChapter(selectedDraft, chapters) : null
  const selectedChapter =
    sourceKind === 'draft'
      ? linkedDraftChapter
      : chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0] ?? null
  const sourceTitle = sourceKind === 'draft' ? selectedDraft?.title ?? '' : selectedChapter?.title ?? ''
  const sourceBody = sourceKind === 'draft' ? selectedDraft?.body ?? '' : selectedChapter?.body ?? ''
  const sourceDraftId = sourceKind === 'draft' ? selectedDraft?.id ?? null : null
  const activeSessions = scoped.revisionSessions.filter((session) =>
    sourceDraftId ? session.sourceDraftId === sourceDraftId : session.chapterId === selectedChapter?.id && session.sourceDraftId === null
  )
  const sessionIds = new Set(activeSessions.map((session) => session.id))
  const versions = scoped.revisionVersions
    .filter((version) => sessionIds.has(version.sessionId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? versions[0] ?? null
  const latestQualityReports = scoped.qualityGateReports
    .filter((report) =>
      sourceKind === 'draft'
        ? report.draftId === selectedDraft?.id || (selectedChapter ? report.chapterId === selectedChapter.id : false)
        : report.chapterId === selectedChapter?.id
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  function buildRevisionContext(): string {
    const bible = scoped.bible
    const recentChapters = chapters
      .filter((chapter) => !selectedChapter || chapter.order <= selectedChapter.order)
      .slice(-3)
      .map((chapter) => `第 ${chapter.order} 章《${chapter.title || '未命名'}》：${chapter.summary || '暂无摘要'}`)
      .join('\n')
    const characters = scoped.characters
      .filter((character) => character.isMain)
      .map((character) => `${character.name}｜${character.role || '未设定'}｜情绪：${character.emotionalState || '未记录'}｜关系：${character.protagonistRelationship || '未记录'}`)
      .join('\n')
    const foreshadowing = scoped.foreshadowings
      .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned' && (item.weight === 'high' || item.weight === 'payoff'))
      .map((item) => `${item.title}｜${statusLabel(item.status)}｜${weightLabel(item.weight)}｜${item.description}`)
      .join('\n')
    const continuityBridge = selectedChapter
      ? scoped.chapterContinuityBridges.find((bridge) => bridge.toChapterOrder === selectedChapter.order) ??
        scoped.chapterContinuityBridges.find((bridge) => bridge.fromChapterId === selectedChapter.id)
      : null
    const redundancyReport = selectedDraft
      ? scoped.redundancyReports.find((report) => report.draftId === selectedDraft.id) ?? null
      : selectedChapter
        ? scoped.redundancyReports.find((report) => report.chapterId === selectedChapter.id) ?? null
        : null
    return [
      `项目：${project.name}`,
      `题材：${project.genre || '暂无'}`,
      `简介：${project.description || '暂无'}`,
      `核心爽点：${project.coreAppeal || '暂无'}`,
      `整体风格：${project.style || '暂无'}`,
      `叙事基调：${bible?.narrativeTone || '暂无'}`,
      `文风样例：${bible?.styleSample || '暂无'}`,
      `不可违背设定：${bible?.immutableFacts || '暂无'}`,
      `最近章节：\n${recentChapters || '暂无'}`,
      `主要角色状态：\n${characters || '暂无'}`,
      `高权重伏笔：\n${foreshadowing || '暂无'}`,
      `章节衔接要求：\n${
        continuityBridge
          ? [
              `必须接住：${continuityBridge.immediateNextBeat || continuityBridge.mustContinueFrom || '待补充'}`,
              `身体状态：${continuityBridge.lastPhysicalState || '待补充'}`,
              `情绪状态：${continuityBridge.lastEmotionalState || '待补充'}`,
              `禁止重置：${continuityBridge.mustNotReset || '不要重新介绍已有环境和设定'}`
            ].join('\n')
          : '暂无'
      }`,
      `冗余压缩参考：\n${
        redundancyReport
          ? [
              `冗余分：${redundancyReport.overallRedundancyScore}`,
              `重复词组：${redundancyReport.repeatedPhrases.join('、') || '暂无'}`,
              `压缩建议：${redundancyReport.compressionSuggestions.join('；') || '暂无'}`
            ].join('\n')
          : '暂无'
      }`
    ].join('\n')
  }

  function getOrCreateSession(timestamp: string): RevisionSession {
    const existing = activeSessions.find((session) => session.status === 'active') ?? activeSessions[0]
    if (existing) return existing
    return {
      id: newId(),
      projectId: project.id,
      chapterId: selectedChapter?.id ?? '',
      sourceDraftId,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  async function generateRevisionFromCurrent(override?: { type?: RevisionRequestType; instruction?: string; targetRange?: string; sourceText?: string }) {
    if (sourceKind === 'chapter' && !selectedChapter) {
      setMessage('请先创建或选择一个章节。')
      return
    }
    if (sourceKind === 'draft' && !selectedDraft) {
      setMessage('请先选择一个草稿。')
      return
    }
    const hasOverrideSourceText = typeof override?.sourceText === 'string'
    const rawTarget = hasOverrideSourceText ? '' : override?.targetRange ?? targetRange
    const fullChapterText = hasOverrideSourceText ? override?.sourceText ?? '' : sourceBody
    const isLocalRevision = Boolean(rawTarget.trim()) && !hasOverrideSourceText
    const targetText = isLocalRevision ? rawTarget.trim() : fullChapterText
    if (!targetText.trim()) {
      setMessage('当前没有可修订的正文。')
      return
    }
    const type = override?.type ?? revisionType
    const finalInstruction = override?.instruction ?? instruction
    setLoading(true)
    setMessage('')
    try {
      const context = buildRevisionContext()
      const requestPayload = {
        type,
        targetRange: isLocalRevision ? rawTarget.trim() : undefined,
        instruction: finalInstruction,
        revisionScope: isLocalRevision ? ('local' as const) : ('full' as const),
        fullChapterText
      }
      const result = await aiService.generateRevision(requestPayload, context)
      if (!result.data) {
        setMessage(result.error || '修订生成失败。')
        return
      }
      if (!result.data.revisedText.trim()) {
        setMessage(result.error || '修订生成失败：AI 返回的 revisedText 为空。')
        return
      }
      if (isLocalRevision && looksLikeFullChapterRevision(fullChapterText, rawTarget, result.data.revisedText)) {
        setMessage('AI 返回内容像完整章节而不是局部片段，已阻止保存。请重试或缩小局部修订范围。')
        return
      }
      const timestamp = now()
      const session = getOrCreateSession(timestamp)
      const request: RevisionRequest = {
        id: newId(),
        sessionId: session.id,
        type,
        targetRange: rawTarget.trim(),
        instruction: finalInstruction,
        createdAt: timestamp
      }
      const finalBody = isLocalRevision
        ? mergeLocalRevisionSafely(fullChapterText, rawTarget, result.data.revisedText)
        : result.data.revisedText
      const version: RevisionVersion = {
        id: newId(),
        sessionId: session.id,
        requestId: request.id,
        title: `${sourceTitle || (selectedChapter ? `第 ${selectedChapter.order} 章` : '未关联章节草稿')} · ${revisionTypeName(type)}`,
        body: finalBody,
        changedSummary: result.data.changedSummary,
        risks: result.data.risks,
        preservedFacts: result.data.preservedFacts,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp
      }
      const sessionExists = data.revisionSessions.some((item) => item.id === session.id)
      await saveData({
        ...data,
        revisionSessions: sessionExists
          ? data.revisionSessions.map((item) => (item.id === session.id ? { ...item, status: 'active', updatedAt: timestamp } : item))
          : [session, ...data.revisionSessions],
        revisionRequests: [request, ...data.revisionRequests],
        revisionVersions: [version, ...data.revisionVersions]
      })
      setSelectedVersionId(version.id)
      setMessage(result.error || (result.usedAI ? '修订版本已生成，接受前请对照检查。' : '未配置 API Key，已生成本地安全模板。'))
    } catch (error) {
      if (error instanceof LocalRevisionMergeError) {
        setMessage('局部修订目标未能在原文中唯一匹配，请从正文中重新复制目标段落。')
      } else {
        setMessage(error instanceof Error ? error.message : '修订生成失败。')
      }
    } finally {
      setLoading(false)
    }
  }

  async function acceptVersion(version: RevisionVersion) {
    if (version.status !== 'pending') return
    if (sourceKind === 'chapter' && !selectedChapter) return
    if (sourceKind === 'draft' && !selectedDraft) {
      setMessage('请先选择一个草稿。')
      return
    }
    const lowScoreReport = latestQualityReports.find((report) => !report.pass)
    if (lowScoreReport && !confirm(`该章节最近质量门禁为 ${lowScoreReport.overallScore} 分且未通过，仍要接受修订版本吗？`)) return
    const confirmMessage =
      sourceKind === 'chapter'
        ? '确定接受该修订版本并写回章节正文吗？旧正文会先进入版本历史。'
        : linkedDraftChapter
          ? '确定接受该修订版本并同步更新草稿和关联章节吗？旧章节正文会先进入版本历史。'
          : '确定接受该修订版本并更新草稿吗？该草稿尚未关联章节，本次不会写入任何已有章节。'
    if (!confirm(confirmMessage)) return
    const timestamp = now()
    const writebackSource =
      sourceKind === 'draft' && selectedDraft
        ? { kind: 'draft' as const, draft: selectedDraft, linkedChapter: linkedDraftChapter }
        : { kind: 'chapter' as const, chapter: selectedChapter! }
    const writeback = applyAcceptedRevisionWriteback(data, project.id, writebackSource, version, timestamp)
    let nextData: AppData = writeback.data
    const sourceSession = data.revisionSessions.find((session) => session.id === version.sessionId)
    const sourceDraft = sourceSession?.sourceDraftId
      ? data.generatedChapterDrafts.find((draft) => draft.id === sourceSession.sourceDraftId)
      : null
    if (sourceDraft?.jobId && sourceSession) {
      const existingTrace = data.generationRunTraces.find((trace) => trace.jobId === sourceDraft.jobId)
      nextData = upsertGenerationRunTraceByJobId(nextData, sourceDraft.jobId, {
        revisionSessionIds: [...new Set([...(existingTrace?.revisionSessionIds ?? []), sourceSession.id])],
        acceptedRevisionVersionId: version.id
      })
    }
    await saveData(nextData)
    setMessage(writeback.message)
  }

  async function rejectVersion(version: RevisionVersion) {
    if (version.status !== 'pending') return
    await saveData({
      ...data,
      revisionVersions: data.revisionVersions.map((item) =>
        item.id === version.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    })
    setMessage('已拒绝该修订版本。')
  }

  async function copyRevisionVersion(version: RevisionVersion) {
    await window.novelDirector.clipboard.writeText(version.body)
    setMessage('已复制修订版本正文。')
  }

  async function startFromQualityIssue(issue: QualityGateIssue) {
    const type = issueToRevisionType(issue)
    setRevisionType(type)
    setInstruction(issue.suggestedFix || issue.description)
    await generateRevisionFromCurrent({
      type,
      instruction: issue.suggestedFix || issue.description,
      targetRange: issue.evidence || ''
    })
  }

  return (
    <>
      <Header
        title="修订工作台"
        description="把普通草稿打磨成更有张力的章节。修订版本不会直接覆盖原文，接受前会保存旧正文快照。"
        actions={
          <ActionToolbar>
            <button className="ghost-button" disabled={!sourceBody.trim()} onClick={() => copyRevisionVersion({ body: sourceBody } as RevisionVersion)}>
              复制原文
            </button>
            <button className="primary-button" disabled={loading || !sourceBody.trim()} onClick={() => generateRevisionFromCurrent()}>
              {loading ? '修订中...' : '生成修订版本'}
            </button>
          </ActionToolbar>
        }
      />
      <section className="revision-studio-layout">
        <aside className="revision-sidebar">
          <SectionCard title="修订来源" description="可选择章节正文，也可选择流水线生成草稿。">
            <div className="segmented-control">
              <button className={sourceKind === 'chapter' ? 'active' : ''} onClick={() => setSourceKind('chapter')}>章节</button>
              <button className={sourceKind === 'draft' ? 'active' : ''} onClick={() => setSourceKind('draft')}>草稿</button>
            </div>
            {sourceKind === 'chapter' ? (
              <Field label="选择章节">
                <select value={selectedChapter?.id ?? ''} onChange={(event) => setSelectedChapterId(event.target.value)}>
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章 {chapter.title || '未命名'}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                <Field label="选择草稿">
                  <select value={selectedDraft?.id ?? ''} onChange={(event) => setSelectedDraftId(event.target.value)}>
                    {drafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>{draft.title || '未命名草稿'} · {draft.status}</option>
                    ))}
                  </select>
                </Field>
                <Field label="写回章节">
                  {selectedDraft?.chapterId ? (
                    <select value={linkedDraftChapter?.id ?? ''} disabled>
                      {linkedDraftChapter ? (
                        <option value={linkedDraftChapter.id}>第 {linkedDraftChapter.order} 章 {linkedDraftChapter.title || '未命名'}</option>
                      ) : (
                        <option value="">关联章节已丢失</option>
                      )}
                    </select>
                  ) : (
                    <p className="muted">该草稿尚未关联章节；接受修订只会更新草稿，不会写入任何已有章节。</p>
                  )}
                </Field>
              </>
            )}
            <SelectField<RevisionRequestType>
              label="修订类型"
              value={revisionType}
              onChange={setRevisionType}
              options={revisionTypeOptions}
            />
            <TextArea
              label="局部修订文本（可选）"
              value={targetRange}
              rows={6}
              placeholder="把要局部修订的段落粘贴到这里；留空则全文修订。"
              onChange={setTargetRange}
            />
            <TextArea
              label="自定义修订指令"
              value={instruction}
              rows={5}
              placeholder="例如：保留事实，但让对话更有潜台词，减少解释。"
              onChange={setInstruction}
            />
          </SectionCard>
          <SectionCard title="质量门禁问题" description="点击 issue 可发起定向修订。">
            {latestQualityReports.length === 0 ? (
              <p className="muted">当前章节暂无质量门禁报告。</p>
            ) : (
              <div className="quality-issue-list">
                {latestQualityReports[0].issues.map((issue, index) => (
                  <button key={`${issue.type}-${index}`} className={`quality-issue ${issue.severity}`} onClick={() => startFromQualityIssue(issue)}>
                    <strong>{issue.type}</strong>
                    <span>{issue.description || issue.suggestedFix}</span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </aside>
        <main className="revision-compare">
          <SectionCard title="原文" description={`${sourceBody.replace(/\s/g, '').length.toLocaleString()} 字`}>
            {sourceBody.trim() ? (
              <textarea className="revision-textarea original" value={sourceBody} readOnly />
            ) : (
              <EmptyState title="暂无可修订正文" description="请选择已有章节或带正文的生成草稿。" />
            )}
          </SectionCard>
          <SectionCard
            title="修订版本"
            description={selectedVersion ? `${revisionTypeName(data.revisionRequests.find((request) => request.id === selectedVersion.requestId)?.type ?? revisionType)} · ${selectedVersion.status}` : '生成后在这里对照'}
          >
            <div className="version-tabs">
              {versions.map((version) => (
                <button key={version.id} className={version.id === selectedVersion?.id ? 'active' : ''} onClick={() => setSelectedVersionId(version.id)}>
                  {revisionTypeName(data.revisionRequests.find((request) => request.id === version.requestId)?.type ?? 'custom')}
                  <small>{version.status}</small>
                </button>
              ))}
            </div>
            {selectedVersion ? (
              <>
                <textarea className="revision-textarea revised" value={selectedVersion.body} readOnly />
                <div className="revision-version-meta">
                  <p><strong>修改摘要：</strong>{selectedVersion.changedSummary || '暂无'}</p>
                  <p><strong>风险提示：</strong>{selectedVersion.risks || '暂无'}</p>
                  <p><strong>保留事实：</strong>{selectedVersion.preservedFacts || '暂无'}</p>
                </div>
                <div className="row-actions">
                  <button className="ghost-button" onClick={() => copyRevisionVersion(selectedVersion)}>复制版本</button>
                  <button className="ghost-button" disabled={loading} onClick={() => generateRevisionFromCurrent({ sourceText: selectedVersion.body, instruction: `在该修订版本基础上继续修改：${instruction || selectedVersion.changedSummary}` })}>
                    继续修改
                  </button>
                  <button className="primary-button" disabled={selectedVersion.status === 'accepted'} onClick={() => acceptVersion(selectedVersion)}>接受版本</button>
                  <button className="danger-button" disabled={selectedVersion.status === 'rejected'} onClick={() => rejectVersion(selectedVersion)}>拒绝版本</button>
                </div>
              </>
            ) : (
              <EmptyState title="暂无修订版本" description="选择修订类型后生成一个版本，可以继续生成多个版本并比较。" />
            )}
          </SectionCard>
        </main>
      </section>
      {message ? <div className="notice revision-message">{message}</div> : null}
    </>
  )
}
