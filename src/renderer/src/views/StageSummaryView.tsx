import { useMemo, useState } from 'react'
import type { ID, StageSummary } from '../../../shared/types'
import { AIService } from '../../../services/AIService'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState, NumberInput, TextArea } from '../components/FormFields'
import { Header } from '../components/Layout'
import { clampNumber, newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function StageSummaryView({ data, project, saveData }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = projectData(data, project.id)
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const summaries = [...scoped.stageSummaries].sort((a, b) => a.chapterStart - b.chapterStart)
  const [chapterStart, setChapterStart] = useState(1)
  const [chapterEnd, setChapterEnd] = useState(3)
  const aiService = useMemo(() => new AIService(), [])

  function coveredRange(start: number, end: number) {
    return `第 ${start}-${end} 章`
  }

  async function generateDraft() {
    const selectedChapters = chapters.filter((chapter) => chapter.order >= chapterStart && chapter.order <= chapterEnd)
    if (selectedChapters.length === 0) return
    const draft = await aiService.generateStageSummary(selectedChapters)
    const timestamp = now()
    const summary: StageSummary = { ...draft, id: newId(), projectId: project.id, createdAt: timestamp, updatedAt: timestamp }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      stageSummaries: [...current.stageSummaries, summary],
      chapters: current.chapters.map((chapter) =>
        chapter.projectId === project.id && chapter.order >= chapterStart && chapter.order <= chapterEnd
          ? { ...chapter, includedInStageSummary: true, updatedAt: now() }
          : chapter
      )
    }))
  }

  async function updateSummary(id: ID, patch: Partial<StageSummary>) {
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      stageSummaries: current.stageSummaries.map((summary) => (summary.id === id ? { ...summary, ...patch, updatedAt: now() } : summary))
    }))
  }

  async function deleteSummary(summary: StageSummary) {
    const confirmed = await confirmAction({
      title: '删除阶段摘要',
      message: `确定删除第 ${summary.chapterStart}-${summary.chapterEnd} 章阶段摘要吗？`,
      confirmLabel: '删除摘要',
      tone: 'danger'
    })
    if (!confirmed) return
    await saveData((current) => {
      const remaining = current.stageSummaries.filter((item) => item.id !== summary.id)
      return {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        stageSummaries: remaining,
        chapters: current.chapters.map((chapter) => {
          if (chapter.projectId !== project.id) return chapter
          const stillCovered = remaining.some(
            (item) => item.projectId === project.id && chapter.order >= item.chapterStart && chapter.order <= item.chapterEnd
          )
          return { ...chapter, includedInStageSummary: stillCovered, updatedAt: now() }
        })
      }
    })
  }

  return (
    <div className="stage-summary-view">
      <Header title="滚动阶段摘要" description="阶段摘要只保留旧章节剧情压缩和远期背景记忆，角色、伏笔和信息差请回到对应账本维护。" />
      <section className="panel inline-form stage-builder">
        <NumberInput label="起始章节" value={chapterStart} min={1} onChange={(value) => setChapterStart(clampNumber(value ?? 1, 1))} />
        <NumberInput label="结束章节" value={chapterEnd} min={1} onChange={(value) => setChapterEnd(clampNumber(value ?? 3, 3))} />
        <button className="primary-button" onClick={generateDraft}>
          从选中章节生成阶段摘要草稿
        </button>
      </section>
      <section className="summary-list">
        {summaries.length === 0 ? (
          <EmptyState title="暂无阶段摘要" description="建议每 3 章生成一次阶段摘要，用它替代旧章节细节。" />
        ) : (
          summaries.map((summary) => (
            <article key={summary.id} className="panel">
              <div className="form-grid compact">
                <NumberInput label="覆盖起始章" value={summary.chapterStart} onChange={(chapterStart) => {
                  const nextStart = chapterStart ?? summary.chapterStart
                  updateSummary(summary.id, { chapterStart: nextStart, coveredChapterRange: coveredRange(nextStart, summary.chapterEnd) })
                }} />
                <NumberInput label="覆盖结束章" value={summary.chapterEnd} onChange={(chapterEnd) => {
                  const nextEnd = chapterEnd ?? summary.chapterEnd
                  updateSummary(summary.id, { chapterEnd: nextEnd, coveredChapterRange: coveredRange(summary.chapterStart, nextEnd) })
                }} />
              </div>
              <div className="form-grid">
                <TextArea label="压缩剧情摘要" value={summary.compressedPlotSummary || summary.plotProgress} onChange={(compressedPlotSummary) => updateSummary(summary.id, { compressedPlotSummary, plotProgress: compressedPlotSummary })} />
                <TextArea label="不可逆变化" value={summary.irreversibleChanges ?? ''} onChange={(irreversibleChanges) => updateSummary(summary.id, { irreversibleChanges })} />
                <TextArea label="结尾承接状态" value={summary.endingCarryoverState ?? ''} onChange={(endingCarryoverState) => updateSummary(summary.id, { endingCarryoverState })} />
                <TextArea label="情绪余味" value={summary.emotionalAftertaste ?? ''} onChange={(emotionalAftertaste) => updateSummary(summary.id, { emotionalAftertaste })} />
                <TextArea label="节奏状态" value={summary.pacingState ?? ''} onChange={(pacingState) => updateSummary(summary.id, { pacingState })} />
              </div>
              <button className="danger-button" onClick={() => deleteSummary(summary)}>
                删除阶段摘要
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
