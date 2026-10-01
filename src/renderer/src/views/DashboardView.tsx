import { useMemo, useRef, useState } from 'react'
import type { Chapter, ID } from '../../../shared/types'
import { StageSummaryService } from '../../../services/StageSummaryService'
import { nextChapterOrder } from '../../../services/ChapterLifecycleService'
import { getDirectorDashboard, type DirectorDestination, type DirectorNextAction } from '../../../services/DirectorNextActionService'
import { qualityGateEffectivelyPassed } from '../../../shared/qualityGatePolicy'
import { StatusBadge } from '../components/UI'
import { useProjectData } from '../hooks/useProjectData'
import { formatDate, newId, now } from '../utils/format'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'
import '../styles/views/dashboard.css'

interface DashboardProps extends ProjectProps {
  onNavigate?: (view: DirectorDestination) => void
  onOpenChapter?: (chapterId: ID) => void
}

const draftStatusLabels = { draft: '待审阅', accepted: '已采纳', rejected: '已放弃' }

function excerpt(text: string | undefined, limit = 180): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

export function DashboardView({ data, project, saveData, onNavigate, onOpenChapter }: DashboardProps) {
  const scoped = useProjectData(data, project.id)
  const dashboard = useMemo(() => getDirectorDashboard(data, project.id, {
    navigate: Boolean(onNavigate), openChapter: Boolean(onOpenChapter)
  }), [data, project.id, onNavigate, onOpenChapter])
  const latestStage = useMemo(() => [...scoped.stageSummaries]
    .sort((a, b) => b.chapterEnd - a.chapterEnd)[0], [scoped.stageSummaries])
  const latestLog = useMemo(() => [...scoped.characterStateLogs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [scoped.characterStateLogs])
  const logCharacter = latestLog ? scoped.characters.find((item) => item.id === latestLog.characterId) : null
  const [isCreating, setIsCreating] = useState(false)
  const creatingRef = useRef(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const [primary, ...secondary] = dashboard.actions
  const recentChapter = dashboard.recentChapters[0]
  const { latestDraft, qualityReport } = dashboard

  async function createNextChapter() {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    setFeedback(null)
    const timestamp = now()
    const chapterId = newId()
    try {
      const result = await saveData((current) => {
        if (!current.projects.some((item) => item.id === project.id)) throw new Error('项目已移除，请返回项目列表。')
        const order = nextChapterOrder(current.chapters, project.id)
        const chapter: Chapter = {
          id: chapterId, projectId: project.id, order, title: `第 ${order} 章`, body: '', summary: '',
          newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '',
          endingHook: '', riskWarnings: '', includedInStageSummary: false, archivedAt: null,
          createdAt: timestamp, updatedAt: timestamp
        }
        return {
          ...current, projects: updateProjectTimestamp(current, project.id),
          chapters: current.chapters.some((item) => item.id === chapterId) ? current.chapters : [...current.chapters, chapter]
        }
      })
      if (!result.ok) {
        setFeedback({ error: true, text: result.errorMessage })
        return
      }
      setFeedback({ error: false, text: '章节已创建。' })
      onOpenChapter?.(chapterId)
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : '章节创建失败，请重试。' })
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  function performAction(action: DirectorNextAction) {
    if (action.kind === 'create_chapter') void createNextChapter()
    else if (action.chapterId) onOpenChapter?.(action.chapterId)
    else if (action.destination) onNavigate?.(action.destination)
  }

  return (
    <div className="dashboard-view">
      <header className="director-heading">
        <div>
          <p className="director-eyebrow">导演行动台</p>
          <h1>{project.name}</h1>
          {project.description && <p className="director-description">{excerpt(project.description, 130)}</p>}
        </div>
        <div className="director-project-meta">
          {project.genre && <StatusBadge tone="neutral">{project.genre}</StatusBadge>}
          <span>最近更新 {formatDate(project.updatedAt)}</span>
        </div>
      </header>

      <section className="director-action-area" aria-labelledby="director-next-title">
        <div className="director-current-chapter">
          <span>{primary.chapterOrder ? '当前推进章节' : '当前创作进度'}</span>
          <strong>{String(primary.chapterOrder ?? dashboard.latestChapterOrder).padStart(2, '0')}</strong>
          <small>{primary.chapterOrder ? `第 ${primary.chapterOrder} 章` : `已写至第 ${dashboard.latestChapterOrder} 章`}</small>
        </div>
        <div className="director-next-action">
          <p className="director-eyebrow">接下来</p>
          <h2 id="director-next-title">{primary.title}</h2>
          <p>{primary.reason}</p>
          <button type="button" className="primary-button director-primary-action" disabled={isCreating}
            onClick={() => performAction(primary)}>
            {isCreating && primary.kind === 'create_chapter' ? '正在创建…' : primary.label}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {secondary.length > 0 && <div className="director-secondary-actions" aria-label="其他可做的事">
          {secondary.map((action) => <button type="button" key={action.kind} disabled={isCreating} onClick={() => performAction(action)}>
            <span><strong>{action.label}</strong><small>{action.reason}</small></span><span aria-hidden="true">↗</span>
          </button>)}
        </div>}
      </section>
      {feedback && <p className={`director-feedback${feedback.error ? ' is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}

      <dl className="director-stats" aria-label="项目进度">
        <div><dt>正文累计</dt><dd>{dashboard.totalWords.toLocaleString()}<small>字</small></dd></div>
        <div><dt>已建章节</dt><dd>{dashboard.chapterCount}<small>章</small></dd></div>
        <div><dt>待确认变化</dt><dd>{dashboard.pendingCandidateCount}<small>条</small></dd></div>
        <div><dt>剧情回顾覆盖</dt><dd>{latestStage ? `${latestStage.chapterStart}–${latestStage.chapterEnd}` : '尚无'}{latestStage && <small>章</small>}</dd></div>
      </dl>

      <div className="director-workspace">
        <section className="director-manuscript" aria-labelledby="director-manuscript-title">
          <div className="director-section-heading"><h2 id="director-manuscript-title">最近落笔</h2><span>最近编辑</span></div>
          {recentChapter ? <>
            <article className="director-chapter-preview">
              <p className="director-eyebrow">第 {recentChapter.order} 章 · {formatDate(recentChapter.updatedAt)}</p>
              <h3>{recentChapter.title}</h3>
              <p className="director-prose">{excerpt(recentChapter.body) || '这一页还空着，故事从下一句话开始。'}</p>
              {recentChapter.endingHook && <p className="director-hook"><span>结尾留下</span>{excerpt(recentChapter.endingHook, 95)}</p>}
            </article>
            <div className="director-chapter-list">
              {dashboard.recentChapters.map((chapter) => <button type="button" key={chapter.id} disabled={!onOpenChapter}
                onClick={() => onOpenChapter?.(chapter.id)} aria-label={`打开第 ${chapter.order} 章：${chapter.title}`}>
                <span className="director-chapter-number">{String(chapter.order).padStart(2, '0')}</span>
                <strong>{chapter.title}</strong><span>{chapter.body.replace(/\s/g, '').length.toLocaleString()} 字</span><span aria-hidden="true">→</span>
              </button>)}
            </div>
          </> : <div className="director-empty"><strong>第一章，等你落笔。</strong><p>还没有章节正文。</p></div>}
        </section>

        <section className="director-progress" aria-labelledby="director-progress-title">
          <div className="director-section-heading"><h2 id="director-progress-title">最近进展</h2><span>创作记录</span></div>
          <ol className="director-progress-list">
            {latestDraft && <li>
              <div><StatusBadge tone={latestDraft.status === 'accepted' ? 'success' : 'info'}>{draftStatusLabels[latestDraft.status]}</StatusBadge><time>{formatDate(latestDraft.updatedAt)}</time></div>
              <h3>{latestDraft.title}</h3>
              <p>{qualityReport ? `质量审阅 ${qualityReport.overallScore} 分 · ${qualityGateEffectivelyPassed(qualityReport) ? '已通过' : '待调整'}` : '当前正文尚待质量审阅'}</p>
            </li>}
            {latestLog && <li><div><StatusBadge tone="neutral">角色变化</StatusBadge><time>{formatDate(latestLog.createdAt)}</time></div>
              <h3>{logCharacter?.name || '角色状态记录'}</h3><p>{excerpt(latestLog.note, 110)}</p></li>}
            {latestStage && <li><div><StatusBadge tone="neutral">剧情回顾</StatusBadge><time>{formatDate(latestStage.updatedAt)}</time></div>
              <h3>第 {latestStage.chapterStart}–{latestStage.chapterEnd} 章</h3>
              <p>{excerpt(StageSummaryService.compressedPlotSummary(latestStage) || latestStage.endingCarryoverState, 120)}</p></li>}
          </ol>
          {!latestDraft && !latestLog && !latestStage && <div className="director-empty"><strong>新的故事，新的开始。</strong><p>还没有生成或复盘记录。</p></div>}
        </section>
      </div>
    </div>
  )
}
