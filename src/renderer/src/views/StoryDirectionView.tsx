import { useMemo, useState } from 'react'
import type {
  StoryDirectionChapterBeat,
  StoryDirectionGenerationResult,
  StoryDirectionGuide,
  StoryDirectionGuideSource,
  StoryDirectionHorizon
} from '../../../shared/types'
import { AIService } from '../../../services/AIService'
import { StoryDirectionService } from '../../../services/StoryDirectionService'
import { EmptyState, NumberInput, TextArea, TextInput } from '../components/FormFields'
import { Header } from '../components/Layout'
import { newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

function makeBeat(raw: Omit<StoryDirectionChapterBeat, 'id'>, index: number, startChapterOrder: number): StoryDirectionChapterBeat {
  const chapterOffset = raw.chapterOffset || index + 1
  return {
    id: newId(),
    chapterOffset,
    chapterOrder: raw.chapterOrder ?? startChapterOrder + chapterOffset - 1,
    goal: raw.goal ?? '',
    conflict: raw.conflict ?? '',
    characterFocus: raw.characterFocus ?? '',
    foreshadowingToUse: raw.foreshadowingToUse ?? '',
    foreshadowingNotToReveal: raw.foreshadowingNotToReveal ?? '',
    suspenseToKeep: raw.suspenseToKeep ?? '',
    endingHook: raw.endingHook ?? '',
    readerEmotion: raw.readerEmotion ?? '',
    mustAvoid: raw.mustAvoid ?? '',
    notes: raw.notes ?? ''
  }
}

function guideFromResult(
  projectId: string,
  startChapterOrder: number,
  horizon: StoryDirectionHorizon,
  source: StoryDirectionGuideSource,
  userRawIdea: string,
  userPolishedIdea: string,
  result: StoryDirectionGenerationResult,
  stageSummaryIds: string[],
  chapterIds: string[]
): StoryDirectionGuide {
  const timestamp = now()
  return {
    id: newId(),
    projectId,
    title: result.title || `第 ${startChapterOrder}-${startChapterOrder + horizon - 1} 章剧情导向`,
    status: 'draft',
    source,
    horizonChapters: horizon,
    startChapterOrder,
    endChapterOrder: startChapterOrder + horizon - 1,
    userRawIdea,
    userPolishedIdea,
    aiGuidance: result.aiGuidance,
    strategicTheme: result.strategicTheme,
    coreDramaticPromise: result.coreDramaticPromise,
    emotionalCurve: result.emotionalCurve,
    characterArcDirectives: result.characterArcDirectives,
    foreshadowingDirectives: result.foreshadowingDirectives,
    constraints: result.constraints,
    forbiddenTurns: result.forbiddenTurns,
    chapterBeats: result.chapterBeats.map((beat, index) => makeBeat(beat, index, startChapterOrder)),
    generatedFromStageSummaryIds: stageSummaryIds,
    generatedFromChapterIds: chapterIds,
    warnings: result.warnings,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function StoryDirectionView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const stageSummaries = [...scoped.stageSummaries].sort((a, b) => a.chapterStart - b.chapterStart)
  const latestChapterOrder = chapters.at(-1)?.order ?? 0
  const [userRawIdea, setUserRawIdea] = useState('')
  const [userPolishedIdea, setUserPolishedIdea] = useState('')
  const [horizon, setHorizon] = useState<StoryDirectionHorizon>(5)
  const [startChapterOrder, setStartChapterOrder] = useState(latestChapterOrder + 1 || 1)
  const activeGuide = StoryDirectionService.getActiveGuideForChapter(data.storyDirectionGuides ?? [], project.id, startChapterOrder)
  const [draftGuide, setDraftGuide] = useState<StoryDirectionGuide | null>(activeGuide)
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])
  const stageReview = StoryDirectionService.formatStageSummaryReview(stageSummaries)

  async function polishIdea() {
    setIsBusy(true)
    setMessage('')
    try {
      const result = await aiService.polishStoryDirectionIdea({
        userRawIdea,
        project,
        recentStageSummaries: stageSummaries,
        activeGuide: activeGuide ? { title: activeGuide.title, aiGuidance: activeGuide.aiGuidance } : null
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
    setIsBusy(true)
    setMessage('')
    try {
      const recentChapters = chapters.slice(-6)
      const result = await aiService.generateStoryDirectionGuide({
        project,
        horizonChapters: horizon,
        startChapterOrder,
        userRawIdea,
        userPolishedIdea,
        stageSummaries,
        recentChapters,
        activeForeshadowings: scoped.foreshadowings.filter((item) => item.status !== 'resolved' && item.status !== 'abandoned'),
        characters: scoped.characters,
        timelineEvents: scoped.timelineEvents,
        storyBible: scoped.bible
      })
      if (!result.data) throw new Error(result.error || result.parseError || '剧情导向生成失败')
      setDraftGuide(
        guideFromResult(
          project.id,
          startChapterOrder,
          horizon,
          userRawIdea.trim() ? (userPolishedIdea.trim() ? 'mixed' : 'ai_generated') : 'ai_generated',
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
    if (!draftGuide) return
    const timestamp = now()
    const guide: StoryDirectionGuide = { ...draftGuide, status, updatedAt: timestamp }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      storyDirectionGuides: [
        guide,
        ...current.storyDirectionGuides
          .filter((item) => item.id !== guide.id)
          .map((item) => (status === 'active' && item.projectId === project.id && item.status === 'active' ? { ...item, status: 'archived' as const, updatedAt: timestamp } : item))
      ]
    }))
    setDraftGuide(guide)
    setMessage(status === 'active' ? '已设为当前剧情导向，后续正文生成会读取它。' : '已保存剧情导向草稿。')
  }

  async function archiveActiveGuide() {
    if (!activeGuide) return
    const timestamp = now()
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      storyDirectionGuides: current.storyDirectionGuides.map((guide) =>
        guide.id === activeGuide.id ? { ...guide, status: 'archived', updatedAt: timestamp } : guide
      )
    }))
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
      <Header title="剧情导向" description="回顾阶段走势，生成并激活未来 5/10 章的中期剧情指导。激活后会进入正文生成链路。" />

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
        <div className="section-heading">
          <div>
            <h2>未来剧情指导</h2>
            {activeGuide ? <p>当前 active：{activeGuide.title}（第 {activeGuide.startChapterOrder}-{activeGuide.endChapterOrder} 章）</p> : <p>暂无 active 剧情导向。</p>}
          </div>
          <div className="action-row">
            <button className={horizon === 5 ? 'primary-button' : 'secondary-button'} onClick={() => setHorizon(5)}>未来 5 章</button>
            <button className={horizon === 10 ? 'primary-button' : 'secondary-button'} onClick={() => setHorizon(10)}>未来 10 章</button>
          </div>
        </div>
        <div className="form-grid compact">
          <NumberInput label="起始章节" value={startChapterOrder} min={1} onChange={(value) => setStartChapterOrder(value ?? 1)} />
        </div>
        <div className="action-row">
          <button className="primary-button" disabled={isBusy} onClick={generateGuide}>
            生成 AI 剧情指导
          </button>
          <button className="secondary-button" disabled={!draftGuide} onClick={() => saveGuide('draft')}>
            保存草稿
          </button>
          <button className="primary-button" disabled={!draftGuide} onClick={() => saveGuide('active')}>
            设为当前导向
          </button>
          <button className="ghost-button" disabled={!activeGuide} onClick={archiveActiveGuide}>
            归档当前导向
          </button>
        </div>
        {message ? <p className="status-line">{message}</p> : null}

        {!draftGuide ? (
          <EmptyState title="暂无剧情指导" description="可以先输入你的想法，也可以直接基于阶段摘要生成 AI 导向。" />
        ) : (
          <div className="story-direction-editor">
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
