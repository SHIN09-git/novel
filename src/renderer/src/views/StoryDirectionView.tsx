import { useCallback, useMemo, useState } from 'react'
import type {
  StoryDirectionChapterBeat,
  StoryDirectionGenerationResult,
  StoryDirectionGuide
} from '../../../shared/types'
import { normalizeStoryDirectionBeat, normalizeStoryDirectionGuide } from '../../../shared/normalizers/storyDirection'
import {
  assertStoryDirectionBeats, DEFAULT_STORY_DIRECTION_CHAPTERS, inspectStoryDirectionRange,
  isChapterOrder, MAX_STORY_DIRECTION_CHAPTERS, type StoryDirectionRange
} from '../../../shared/storyDirectionRange'
import { StoryDirectionService } from '../../../services/StoryDirectionService'
import { EmptyState, NumberInput, SelectField, TextArea, TextInput } from '../components/FormFields'
import { Header } from '../components/Layout'
import { newId, now } from '../utils/format'
import { useProjectData } from '../hooks/useProjectData'
import type { ProjectProps } from './viewTypes'
import '../styles/views/story-direction.css'
import { updateProjectTimestamp } from './viewTypes'

function createDraft(
  projectId: string,
  range: StoryDirectionRange,
  userRawIdea: string,
  userPolishedIdea: string,
  result?: StoryDirectionGenerationResult,
  stageSummaryIds: string[] = [],
  chapterIds: string[] = []
): StoryDirectionGuide {
  if (result) assertStoryDirectionBeats(result.chapterBeats, range, true)
  return normalizeStoryDirectionGuide({
    ...result,
    ...range,
    id: newId(),
    projectId,
    title: result?.title || `第 ${range.startChapterOrder}-${range.endChapterOrder} 章剧情导向`,
    status: 'draft',
    source: result ? (userRawIdea.trim() && userPolishedIdea.trim() ? 'mixed' : 'ai_generated') : 'user_polished',
    userRawIdea,
    userPolishedIdea,
    chapterBeats: result?.chapterBeats ?? Array.from({ length: range.horizonChapters }, (_, i) => ({ chapterOffset: i + 1 })),
    generatedFromStageSummaryIds: stageSummaryIds,
    generatedFromChapterIds: chapterIds
  })
}

export function StoryDirectionView(props: ProjectProps) {
  return <StoryDirectionEditor key={props.project.id} {...props} />
}

function StoryDirectionEditor({ data, project, saveData }: ProjectProps) {
  const scoped = useProjectData(data, project.id)
  const chapters = useMemo(() => [...scoped.chapters].sort((a, b) => a.order - b.order), [scoped.chapters])
  const stageSummaries = useMemo(() => [...scoped.stageSummaries].sort((a, b) => a.chapterStart - b.chapterStart), [scoped.stageSummaries])
  const latestChapterOrder = chapters.at(-1)?.order ?? 0
  const [draftGuide, setDraftGuide] = useState(() => StoryDirectionService.getActiveGuideForChapter(scoped.storyDirectionGuides, project.id, latestChapterOrder + 1))
  const [userRawIdea, setUserRawIdea] = useState(draftGuide?.userRawIdea ?? '')
  const [userPolishedIdea, setUserPolishedIdea] = useState(draftGuide?.userPolishedIdea ?? '')
  const [startChapterOrder, setStartChapterOrder] = useState<number | null>(draftGuide?.startChapterOrder ?? latestChapterOrder + 1)
  const [endChapterOrder, setEndChapterOrder] = useState<number | null>(draftGuide?.endChapterOrder ?? latestChapterOrder + DEFAULT_STORY_DIRECTION_CHAPTERS)
  const { range, error: rangeError } = inspectStoryDirectionRange(startChapterOrder, endChapterOrder)
  const guideForStart = isChapterOrder(startChapterOrder)
    ? StoryDirectionService.getActiveGuideForChapter(scoped.storyDirectionGuides, project.id, startChapterOrder) : null
  const activeGuide = guideForStart ?? scoped.storyDirectionGuides.find(guide => guide.status === 'active')
  const changedRange = !!draftGuide && !!range && (draftGuide.startChapterOrder !== range.startChapterOrder || draftGuide.endChapterOrder !== range.endChapterOrder)
  const removedBeats = changedRange ? draftGuide.chapterBeats.filter(beat => beat.chapterOrder === null ||
    beat.chapterOrder < range.startChapterOrder || beat.chapterOrder > range.endChapterOrder).length : 0
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const getAiService = useCallback(async () => {
    const { AIService } = await import('../../../services/AIService')
    return new AIService(data.settings, { projectId: project.id })
  }, [data.settings, project.id])
  const stageReview = StoryDirectionService.formatStageSummaryReview(stageSummaries)

  function openGuide(id: string) {
    const guide = scoped.storyDirectionGuides.find(item => item.id === id) ?? null
    setDraftGuide(guide)
    setUserRawIdea(guide?.userRawIdea ?? '')
    setUserPolishedIdea(guide?.userPolishedIdea ?? '')
    setStartChapterOrder(guide?.startChapterOrder ?? latestChapterOrder + 1)
    setEndChapterOrder(guide?.endChapterOrder ?? latestChapterOrder + DEFAULT_STORY_DIRECTION_CHAPTERS)
    setMessage('')
  }

  function applyDraftRange() {
    if (!range || !draftGuide || !changedRange) return
    const retained = draftGuide.chapterBeats.filter(beat => beat.chapterOrder !== null &&
      beat.chapterOrder >= range.startChapterOrder && beat.chapterOrder <= range.endChapterOrder)
    const previous = new Map(retained.map(beat => [beat.chapterOrder, beat]))
    if (previous.size !== retained.length) {
      setMessage('保留章段内有重复节拍，未调整草稿。请先修正重复章号。')
      return
    }
    updateGuide({ ...range, chapterBeats: Array.from({ length: range.horizonChapters }, (_, i) => {
      const chapterOrder = range.startChapterOrder + i
      return normalizeStoryDirectionBeat({ ...(previous.get(chapterOrder) ?? { id: newId() }), chapterOffset: i + 1, chapterOrder })
    }) })
    setMessage('已调整草稿章段，尚未保存。')
  }

  async function polishIdea() {
    setIsBusy(true)
    setMessage('')
    try {
      const aiService = await getAiService()
      const result = await aiService.polishStoryDirectionIdea({
        userRawIdea,
        project,
        recentStageSummaries: stageSummaries,
        activeGuide: guideForStart ? { title: guideForStart.title, aiGuidance: guideForStart.aiGuidance } : null
      })
      if (!result.data) throw new Error(result.error || result.parseError || '剧情纲领润色失败')
      setUserPolishedIdea(result.data.polishedIdea)
      setMessage(result.usedAI ? '已生成润色纲领。' : '已使用本地模板保留原始纲领。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function generateGuide() {
    if (!range) return
    setIsBusy(true)
    setMessage('')
    try {
      const aiService = await getAiService()
      const recentChapters = chapters.slice(-6)
      const result = await aiService.generateStoryDirectionGuide({
        project,
        startChapterOrder: range.startChapterOrder,
        endChapterOrder: range.endChapterOrder,
        userRawIdea,
        userPolishedIdea,
        stageSummaries,
        recentChapters,
        activeForeshadowings: scoped.foreshadowings.filter((item) => item.status !== 'resolved' && item.status !== 'abandoned'),
        characters: scoped.characters,
        timelineEvents: scoped.timelineEvents,
        storyBible: scoped.bible
      })
      if (!result.ok || !result.data) throw new Error(result.parseError || result.error || '剧情导向生成失败')
      setDraftGuide(
        createDraft(
          project.id,
          range,
          userRawIdea,
          userPolishedIdea,
          result.data,
          stageSummaries.map((summary) => summary.id),
          recentChapters.map((chapter) => chapter.id)
        )
      )
      setMessage(result.usedAI ? '已生成未来剧情指导。' : '已生成本地保守剧情指导模板。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function saveGuide(status: StoryDirectionGuide['status'] = 'draft') {
    if (!draftGuide || !range || changedRange) return
    try {
      assertStoryDirectionBeats(draftGuide.chapterBeats, range, false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return
    }
    const timestamp = now()
    const guide: StoryDirectionGuide = { ...draftGuide, ...range, userRawIdea, userPolishedIdea, status, updatedAt: timestamp }
    const saved = await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      storyDirectionGuides: [
        guide,
        ...current.storyDirectionGuides
          .filter((item) => item.id !== guide.id || item.projectId !== project.id)
          .map((item) => (status === 'active' && item.projectId === project.id && item.status === 'active' ? { ...item, status: 'archived' as const, updatedAt: timestamp } : item))
      ]
    }))
    if (!saved.ok) { setMessage(saved.errorMessage); return }
    setDraftGuide(guide)
    setMessage(status === 'active' ? '已设为当前剧情导向，后续正文生成会读取它。' : '已保存剧情导向草稿。')
  }

  async function archiveActiveGuide() {
    if (!activeGuide) return
    const timestamp = now()
    const saved = await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      storyDirectionGuides: current.storyDirectionGuides.map((guide) =>
        guide.id === activeGuide.id && guide.projectId === project.id ? { ...guide, status: 'archived', updatedAt: timestamp } : guide
      )
    }))
    if (!saved.ok) { setMessage(saved.errorMessage); return }
    if (draftGuide?.id === activeGuide.id) setDraftGuide({ ...activeGuide, status: 'archived', updatedAt: timestamp })
    setMessage('已归档当前剧情导向。')
  }

  function updateGuide(patch: Partial<StoryDirectionGuide>) {
    if (!draftGuide) return
    setDraftGuide({ ...draftGuide, ...patch, updatedAt: now() })
  }

  function updateBeat(id: string, patch: Partial<StoryDirectionChapterBeat>) {
    if (!draftGuide) return
    updateGuide({
      chapterBeats: draftGuide.chapterBeats.map((beat) => (beat.id === id ? { ...beat, ...patch } : beat))
    })
  }

  return (
    <div className="story-direction-view">
      <Header title="剧情导向" description="回顾阶段走势，为指定章段安排剧情节拍。" />

      <section className="panel">
        <h2>接下来剧情怎么走？</h2>
        <TextArea
          label="你的粗写想法"
          rows={5}
          value={userRawIdea}
          placeholder="例如：接下来五章让主角逐步意识到副本规则不是惩罚，而是筛选机制；第 3 章再回收某个伏笔。"
          onChange={setUserRawIdea}
        />
        <div className="action-row">
          <button className="secondary-button" disabled={isBusy} onClick={polishIdea}>
            AI 润色纲领
          </button>
          <button className="ghost-button" onClick={() => { setUserRawIdea(''); setUserPolishedIdea('') }}>
            清空
          </button>
        </div>
        <TextArea label="润色后纲领" rows={5} value={userPolishedIdea} onChange={setUserPolishedIdea} />
      </section>

      <section className="panel">
        <fieldset className="story-direction-controls" aria-label="导向章段" disabled={isBusy}>
        <div className="section-heading">
          <div>
            <h2>未来剧情指导</h2>
            {activeGuide ? <p>当前导向：{activeGuide.title}（第 {activeGuide.startChapterOrder}-{activeGuide.endChapterOrder} 章）</p> : <p>暂无已激活的剧情导向。</p>}
          </div>
          <div className="action-row">
            {[5, 10].map(count => <button key={count} className={range?.horizonChapters === count ? 'primary-button' : 'secondary-button'}
              aria-pressed={range?.horizonChapters === count} disabled={!isChapterOrder(startChapterOrder)} onClick={() => {
                if (isChapterOrder(startChapterOrder)) setEndChapterOrder(startChapterOrder + (count - 1))
              }}>未来 {count} 章</button>)}
          </div>
        </div>
        <div className="form-grid compact">
          <NumberInput label="起始章节" value={startChapterOrder} min={1} onChange={setStartChapterOrder} />
          <NumberInput label="结束章节" value={endChapterOrder} min={startChapterOrder ?? 1}
            hint={`含起止两章，单条导向最多 ${MAX_STORY_DIRECTION_CHAPTERS} 章。`} onChange={setEndChapterOrder} />
        </div>
        {range ? <p>第 {range.startChapterOrder}-{range.endChapterOrder} 章，共 {range.horizonChapters} 章</p> : <p role="alert">{rangeError}</p>}
        {changedRange && <p>编辑中的导向仍为第 {draftGuide.startChapterOrder}-{draftGuide.endChapterOrder} 章。
          调整后保留重合章的节拍，并移除 {removedBeats} 个范围外的节拍。
          <button className="secondary-button" onClick={applyDraftRange}>应用章段到草稿</button></p>}
        <div className="action-row">
          <button className="secondary-button" disabled={!range} onClick={() => {
            if (!range) return
            setDraftGuide(createDraft(project.id, range, userRawIdea, userPolishedIdea))
            setMessage('已新建剧情导向草稿，尚未保存。')
          }}>新建空白导向</button>
          <button className="primary-button" disabled={!range || isBusy} onClick={generateGuide}>
            生成 AI 剧情指导
          </button>
          <button className="secondary-button" disabled={!draftGuide || !range || changedRange} onClick={() => saveGuide('draft')}>
            保存草稿
          </button>
          <button className="primary-button" disabled={!draftGuide || !range || changedRange} onClick={() => saveGuide('active')}>
            设为当前导向
          </button>
          <button className="ghost-button" disabled={!activeGuide} onClick={archiveActiveGuide}>
            归档当前导向
          </button>
        </div>
        {scoped.storyDirectionGuides.length > 0 && <SelectField label="已保存的导向"
          value={scoped.storyDirectionGuides.find(guide => guide.id === draftGuide?.id)?.id ?? ''}
          options={[{ value: '', label: '选择导向' }, ...scoped.storyDirectionGuides.map(guide => ({
            value: guide.id, label: `${guide.title}（${guide.startChapterOrder}-${guide.endChapterOrder}，${{ active: '当前', archived: '归档', draft: '草稿' }[guide.status]}）`
          }))]} onChange={openGuide} />}
        </fieldset>
        {message ? <p className="status-line" role="status">{message}</p> : null}

        {!draftGuide ? (
          <EmptyState title="暂无剧情指导" description="可以先输入你的想法，也可以直接基于阶段摘要生成 AI 导向。" />
        ) : (
          <div className="story-direction-editor" key={draftGuide.id}>
            <h3>导向预览：第 {draftGuide.startChapterOrder}-{draftGuide.endChapterOrder} 章（共 {draftGuide.horizonChapters} 章）</h3>
            {draftGuide.warnings.map((warning, index) => <p className="status-line" key={index}>{warning}</p>)}
            <div className="form-grid">
              <TextInput label="标题" value={draftGuide.title} onChange={(title) => updateGuide({ title })} />
              <TextArea label="总体指导" value={draftGuide.aiGuidance} onChange={(aiGuidance) => updateGuide({ aiGuidance })} />
              <TextArea label="战略主题" value={draftGuide.strategicTheme} onChange={(strategicTheme) => updateGuide({ strategicTheme })} />
              <TextArea label="核心戏剧承诺" value={draftGuide.coreDramaticPromise} onChange={(coreDramaticPromise) => updateGuide({ coreDramaticPromise })} />
              <TextArea label="情绪曲线" value={draftGuide.emotionalCurve} onChange={(emotionalCurve) => updateGuide({ emotionalCurve })} />
              <TextArea label="角色弧线方向" value={draftGuide.characterArcDirectives} onChange={(characterArcDirectives) => updateGuide({ characterArcDirectives })} />
              <TextArea label="伏笔推进方向" value={draftGuide.foreshadowingDirectives} onChange={(foreshadowingDirectives) => updateGuide({ foreshadowingDirectives })} />
              <TextArea label="限制" value={draftGuide.constraints} onChange={(constraints) => updateGuide({ constraints })} />
              <TextArea label="禁止转向" value={draftGuide.forbiddenTurns} onChange={(forbiddenTurns) => updateGuide({ forbiddenTurns })} />
            </div>
            <h3>章节节拍</h3>
            <div className="summary-list">
              {draftGuide.chapterBeats.map((beat) => (
                <article key={beat.id} className="panel subtle-panel">
                  <h4>第 {beat.chapterOrder ?? '-'} 章</h4>
                  <div className="form-grid">
                    <TextArea label="目标" value={beat.goal} onChange={(goal) => updateBeat(beat.id, { goal })} />
                    <TextArea label="冲突" value={beat.conflict} onChange={(conflict) => updateBeat(beat.id, { conflict })} />
                    <TextArea label="角色焦点" value={beat.characterFocus} onChange={(characterFocus) => updateBeat(beat.id, { characterFocus })} />
                    <TextArea label="可使用伏笔" value={beat.foreshadowingToUse} onChange={(foreshadowingToUse) => updateBeat(beat.id, { foreshadowingToUse })} />
                    <TextArea label="禁止提前揭示" value={beat.foreshadowingNotToReveal} onChange={(foreshadowingNotToReveal) => updateBeat(beat.id, { foreshadowingNotToReveal })} />
                    <TextArea label="保留悬念" value={beat.suspenseToKeep} onChange={(suspenseToKeep) => updateBeat(beat.id, { suspenseToKeep })} />
                    <TextArea label="结尾钩子" value={beat.endingHook} onChange={(endingHook) => updateBeat(beat.id, { endingHook })} />
                    <TextArea label="读者情绪" value={beat.readerEmotion} onChange={(readerEmotion) => updateBeat(beat.id, { readerEmotion })} />
                    <TextArea label="必须避免" value={beat.mustAvoid} onChange={(mustAvoid) => updateBeat(beat.id, { mustAvoid })} />
                    <TextArea label="备注" value={beat.notes} onChange={(notes) => updateBeat(beat.id, { notes })} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>过往剧情回顾</h2>
        {stageReview ? <pre className="trace-json">{stageReview}</pre> : <EmptyState title="暂无阶段摘要" description="生成阶段摘要后，这里会作为未来剧情导向的历史参考。" />}
      </section>
    </div>
  )
}
