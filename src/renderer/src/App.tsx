import { lazy, Suspense, useRef, useState } from 'react'
import type { AppData, ID, Project } from '../../shared/types'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useConfirm } from './components/ConfirmDialog'
import { Shell, type View } from './components/Layout'
import { useAppData } from './hooks/useAppData'
import { QuickRewriteDraftProvider } from './components/QuickRewriteDraftProvider'

const HomeView = lazy(() => import('./views/HomeView').then((module) => ({ default: module.HomeView })))
const DashboardView = lazy(() => import('./views/DashboardView').then((module) => ({ default: module.DashboardView })))
const DecisionInboxView = lazy(() => import('./views/DecisionInboxView').then((module) => ({ default: module.DecisionInboxView })))
const BibleView = lazy(() => import('./views/BibleView').then((module) => ({ default: module.BibleView })))
const CharactersView = lazy(() => import('./views/CharactersView').then((module) => ({ default: module.CharactersView })))
const ForeshadowingView = lazy(() => import('./views/ForeshadowingView').then((module) => ({ default: module.ForeshadowingView })))
const TimelineView = lazy(() => import('./views/TimelineView').then((module) => ({ default: module.TimelineView })))
const StageSummaryView = lazy(() => import('./views/StageSummaryView').then((module) => ({ default: module.StageSummaryView })))
const ChaptersView = lazy(() => import('./views/ChaptersView').then((module) => ({ default: module.ChaptersView })))
const ReadingView = lazy(() => import('./views/ReadingView').then((module) => ({ default: module.ReadingView })))
const PromptBuilderView = lazy(() => import('./views/PromptBuilderView').then((module) => ({ default: module.PromptBuilderView })))
const HardCanonView = lazy(() => import('./views/HardCanonView').then((module) => ({ default: module.HardCanonView })))
const StoryDirectionView = lazy(() => import('./views/StoryDirectionView').then((module) => ({ default: module.StoryDirectionView })))
const AgentRunsView = lazy(() => import('./views/AgentRunsView').then((module) => ({ default: module.AgentRunsView })))
const GenerationPipelineView = lazy(() =>
  import('./views/GenerationPipelineView').then((module) => ({ default: module.GenerationPipelineView }))
)
const RevisionStudioView = lazy(() => import('./views/RevisionStudioView').then((module) => ({ default: module.RevisionStudioView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })))

function StorageConflictNotice({ onReload }: { onReload: () => Promise<unknown> }) {
  const [isReloading, setIsReloading] = useState(false)

  async function reload() {
    setIsReloading(true)
    try {
      await onReload()
    } finally {
      setIsReloading(false)
    }
  }

  return (
    <section className="storage-conflict-notice" role="alert" aria-live="assertive">
      <div>
        <strong>本地数据已在其他窗口或 Agent 中更新</strong>
        <span>当前保存已停止，以免覆盖较新的章节或提交记录。</span>
      </div>
      <button className="primary-button" type="button" disabled={isReloading} onClick={reload}>
        {isReloading ? '正在重新加载...' : '重新加载最新数据'}
      </button>
    </section>
  )
}

export default function App() {
  const {
    data,
    storagePath,
    setStoragePath,
    status,
    hasStorageConflict,
    setStatus,
    saveData,
    saveGenerationRunBundle,
    saveChapterCommitBundle,
    saveRevisionCommitBundle,
    executeCandidateDecision,
    importData: importStoredData,
    runPersistedStorageOperation,
    reloadData,
    getCurrentData
  } = useAppData()
  const storagePathRef = useRef(storagePath)
  storagePathRef.current = storagePath
  const confirmAction = useConfirm()
  const [currentProjectId, setCurrentProjectId] = useState<ID | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [revisionPrefill, setRevisionPrefill] = useState<{ chapterId: ID | null; draftId: ID | null; requestId: ID } | null>(null)
  const [pipelineSnapshotId, setPipelineSnapshotId] = useState<ID | null>(null)
  const [readerInitialChapterId, setReaderInitialChapterId] = useState<ID | null>(null)

  async function reloadAfterStorageConflict(): Promise<{ ok: boolean; errorMessage?: string }> {
    const confirmed = await confirmAction({
      title: '重新加载最新数据',
      message: '重新加载会同步其他窗口或 Agent 已写入的数据。请先复制当前页面中尚未保存的重要文本；系统不会把旧内存自动覆盖回磁盘。',
      confirmLabel: '重新加载',
      cancelLabel: '稍后处理'
    })
    if (!confirmed) return { ok: false, errorMessage: '已取消重新加载。' }
    return reloadData()
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <strong>Novel Director</strong>
        <span>正在读取本地数据...</span>
      </div>
    )
  }

  const currentProject = data.projects.find((project) => project.id === currentProjectId) ?? null

  function renderCurrentView(activeData: AppData, activeProject: Project) {
    switch (view) {
      case 'dashboard':
        return (
          <DashboardView data={activeData} project={activeProject} saveData={saveData}
            onNavigate={setView}
            onOpenChapter={(chapterId) => {
              setReaderInitialChapterId(chapterId)
              setView('chapters')
            }}
          />
        )
      case 'inbox':
        return <DecisionInboxView data={activeData} project={activeProject} saveData={saveData} executeCandidateDecision={executeCandidateDecision} />
      case 'bible':
        return <BibleView data={activeData} project={activeProject} saveData={saveData} />
      case 'chapters':
        return (
          <ChaptersView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            saveRevisionCommitBundle={saveRevisionCommitBundle}
            initialChapterId={readerInitialChapterId}
            onInitialChapterConsumed={() => setReaderInitialChapterId(null)}
            onOpenReader={(chapterId) => {
              setReaderInitialChapterId(chapterId ?? null)
              setView('reader')
            }}
          />
        )
      case 'reader':
        return (
          <ReadingView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            saveRevisionCommitBundle={saveRevisionCommitBundle}
            initialChapterId={readerInitialChapterId}
            onBackToChapters={(chapterId) => {
              setReaderInitialChapterId(chapterId ?? null)
              setView('chapters')
            }}
          />
        )
      case 'characters':
        return <CharactersView data={activeData} project={activeProject} saveData={saveData} />
      case 'foreshadowings':
        return <ForeshadowingView data={activeData} project={activeProject} saveData={saveData} />
      case 'timeline':
        return <TimelineView data={activeData} project={activeProject} saveData={saveData} />
      case 'stages':
        return <StageSummaryView data={activeData} project={activeProject} saveData={saveData} />
      case 'hardCanon':
        return <HardCanonView data={activeData} project={activeProject} saveData={saveData} />
      case 'direction':
        return <StoryDirectionView data={activeData} project={activeProject} saveData={saveData} />
      case 'prompt':
        return (
          <PromptBuilderView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            onSendToPipeline={(snapshotId) => {
              setPipelineSnapshotId(snapshotId)
              setView('pipeline')
            }}
          />
        )
      case 'pipeline':
        return (
          <GenerationPipelineView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            saveGenerationRunBundle={saveGenerationRunBundle}
            executeCandidateDecision={executeCandidateDecision}
            saveChapterCommitBundle={saveChapterCommitBundle}
            initialSnapshotId={pipelineSnapshotId}
            onInitialSnapshotConsumed={() => setPipelineSnapshotId(null)}
            onOpenRevision={(prefill) => {
              setRevisionPrefill(prefill)
              setView('revision')
            }}
          />
        )
      case 'revision':
        return (
          <RevisionStudioView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            saveRevisionCommitBundle={saveRevisionCommitBundle}
            prefill={revisionPrefill}
            onPrefillConsumed={() => setRevisionPrefill(null)}
          />
        )
      case 'agentRuns':
        return <AgentRunsView data={activeData} project={activeProject} saveData={saveData} onReload={reloadAfterStorageConflict} />
      case 'settings':
        return (
          <SettingsView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            storagePath={storagePath}
            setStoragePath={setStoragePath}
            setStatus={setStatus}
            importData={importStoredData}
            runPersistedStorageOperation={runPersistedStorageOperation}
            getCurrentData={getCurrentData}
          />
        )
      default:
        return <DashboardView data={activeData} project={activeProject} saveData={saveData} />
    }
  }

  return (
    <QuickRewriteDraftProvider key={storagePath} getCurrentData={getCurrentData} saveData={saveData} isCurrentStorage={() => storagePathRef.current === storagePath}>
      {currentProject ? <Shell project={currentProject} view={view} setView={setView} setProjectId={setCurrentProjectId} status={status}>
        <ErrorBoundary
          fallback={(error, reset) => (
            <div className="error-boundary view-error-boundary" role="alert">
              <div>
                <p className="eyebrow">页面错误</p>
                <h2>当前页面加载失败</h2>
                <p>导航到其他页面或重试当前页面都不会影响本地数据。</p>
              </div>
              <details>
                <summary>技术详情</summary>
                <pre>{error.stack ?? error.message}</pre>
              </details>
              <button className="primary-button" type="button" onClick={reset}>
                重试当前页面
              </button>
            </div>
          )}
        >
          <Suspense fallback={<div className="view-loading">正在加载页面...</div>}>{renderCurrentView(data, currentProject)}</Suspense>
        </ErrorBoundary>
      </Shell> : <Suspense fallback={<div className="view-loading">正在加载项目列表...</div>}>
        <HomeView data={data} saveData={saveData} importData={importStoredData} setProjectId={setCurrentProjectId} setView={setView} />
      </Suspense>}
      {hasStorageConflict ? <StorageConflictNotice onReload={reloadAfterStorageConflict} /> : null}
    </QuickRewriteDraftProvider>
  )
}
