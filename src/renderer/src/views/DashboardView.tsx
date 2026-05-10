import type { Chapter } from '../../../shared/types'
import { StageSummaryService } from '../../../services/StageSummaryService'
import { Header } from '../components/Layout'
import { ActionToolbar, SectionCard, StatCard, StatusBadge } from '../components/UI'
import { formatDate, newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function DashboardView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const recentChapter = [...scoped.chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const latestStage = [...scoped.stageSummaries].sort((a, b) => b.chapterEnd - a.chapterEnd)[0]
  const highForeshadowingCount = scoped.foreshadowings.filter(
    (item) => item.status !== 'resolved' && item.status !== 'abandoned' && (item.weight === 'high' || item.weight === 'payoff')
  ).length
  const mainCharacterCount = scoped.characters.filter((character) => character.isMain).length
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1
  const totalWords = scoped.chapters.reduce((sum, chapter) => sum + chapter.body.replace(/\s/g, '').length, 0)
  const latestDraft = [...scoped.generatedChapterDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const latestQualityReport = [...scoped.qualityGateReports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestLog = [...scoped.characterStateLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestLogCharacter = latestLog ? scoped.characters.find((character) => character.id === latestLog.characterId) : null
  const latestStageDetail = latestStage
    ? StageSummaryService.compressedPlotSummary(latestStage) || latestStage.endingCarryoverState || '阶段摘要已压缩为远期剧情背景'
    : '建议每 3 章生成一次摘要'

  async function createNextChapter() {
    const timestamp = now()
    const chapter: Chapter = {
      id: newId(),
      projectId: project.id,
      order: nextChapter,
      title: `第 ${nextChapter} 章`,
      body: '',
      summary: '',
      newInformation: '',
      characterChanges: '',
      newForeshadowing: '',
      resolvedForeshadowing: '',
      endingHook: '',
      riskWarnings: '',
      includedInStageSummary: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      chapters: [...current.chapters, chapter]
    }))
  }

  return (
    <div className="dashboard-view">
      <Header
        title="项目工作台"
        description="把长期设定、阶段摘要和当前戏剧状态收束到下一章。"
        actions={
          <ActionToolbar>
            <button className="ghost-button">第 {nextChapter} 章准备区</button>
            <button className="primary-button" onClick={createNextChapter}>新建第 {nextChapter} 章</button>
          </ActionToolbar>
        }
      />
      <section className="dashboard-hero">
        <div>
          <span className="chapter-kicker">Novel Control Room</span>
          <h2>{project.name}</h2>
          <p>{project.description || '还没有项目简介。补上核心类型、目标读者和情绪体验后，Prompt 会更稳定。'}</p>
        </div>
        <div className="dashboard-next-card">
          <span>下一步建议</span>
          <strong>准备第 {nextChapter} 章</strong>
          <p>{recentChapter?.endingHook || latestStageDetail || '先补齐最近章节复盘，再进入 Prompt 构建器或生产流水线。'}</p>
        </div>
      </section>
      <section className="metric-grid dashboard-metrics">
        <StatCard label="总字数" value={totalWords.toLocaleString()} detail={`${scoped.chapters.length} 个章节 · 最近第 ${recentChapter?.order ?? '-'} 章`} tone="accent" />
        <StatCard label="阶段摘要" value={latestStage ? `${latestStage.chapterStart}-${latestStage.chapterEnd}` : '暂无'} detail={latestStageDetail} tone="info" />
        <StatCard label="高权重伏笔" value={highForeshadowingCount} detail="未回收且需要进入调度视野" tone="warning" />
        <StatCard label="主要角色" value={mainCharacterCount} detail="维护当前戏剧状态，而非百科条目" tone="success" />
      </section>
      <section className="dashboard-grid">
        <SectionCard title="最近生产动态" description="草稿、质量门禁和角色变化会汇集在这里。">
          <div className="insight-list">
            <article>
              <StatusBadge tone={latestDraft ? 'accent' : 'neutral'}>草稿</StatusBadge>
              <strong>{latestDraft ? latestDraft.title : '暂无生成草稿'}</strong>
              <p>{latestDraft ? `${latestDraft.status} · ${latestDraft.tokenEstimate} token · ${formatDate(latestDraft.updatedAt)}` : '从生产流水线生成正文草稿后会显示在这里。'}</p>
            </article>
            <article>
              <StatusBadge tone={latestQualityReport?.pass ? 'success' : latestQualityReport ? 'warning' : 'neutral'}>质量门禁</StatusBadge>
              <strong>{latestQualityReport ? `${latestQualityReport.overallScore} 分 · ${latestQualityReport.pass ? '通过' : '需人工审查'}` : '暂无报告'}</strong>
              <p>{latestQualityReport ? `高风险问题 ${latestQualityReport.issues.filter((issue) => issue.severity === 'high').length} 条 · 必修 ${latestQualityReport.requiredFixes.length} 项` : '章节草稿生成后会自动给出质量解释。'}</p>
            </article>
            <article>
              <StatusBadge tone={latestLog ? 'info' : 'neutral'}>角色状态</StatusBadge>
              <strong>{latestLogCharacter?.name || '暂无状态变化'}</strong>
              <p>{latestLog?.note || '从章节复盘或角色页记录关键变化。'}</p>
            </article>
          </div>
        </SectionCard>
        <SectionCard title="上下文风险雷达" description="优先处理会让 AI 写偏的长期记忆问题。">
          <div className="insight-list compact">
            <article>
              <strong>未回收高权重伏笔</strong>
              <p>{highForeshadowingCount ? `有 ${highForeshadowingCount} 条需要关注。` : '当前没有高压伏笔。'}</p>
            </article>
            <article>
              <strong>最近章节复盘</strong>
              <p>{recentChapter?.summary ? `第 ${recentChapter.order} 章已有摘要。` : '最近章节摘要仍为空，建议先补。'}</p>
            </article>
            <article>
              <strong>阶段摘要</strong>
              <p>{latestStage ? `当前滚动摘要覆盖 ${latestStage.chapterStart}-${latestStage.chapterEnd} 章。` : '暂无阶段摘要，长篇上下文会更容易膨胀。'}</p>
            </article>
          </div>
        </SectionCard>
      </section>
    </div>
  )
}
