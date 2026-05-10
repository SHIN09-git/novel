import { lazy, Suspense, useState } from 'react'
import type { AppData, ID, Project } from '../../shared/types'
import { Shell, type View } from './components/Layout'
import { useAppData } from './hooks/useAppData'
import { BibleView } from './views/BibleView'
import { CharactersView } from './views/CharactersView'
import { DashboardView } from './views/DashboardView'
import { ForeshadowingView } from './views/ForeshadowingView'
import { HomeView } from './views/HomeView'
import { StageSummaryView } from './views/StageSummaryView'
import { TimelineView } from './views/TimelineView'

const ChaptersView = lazy(() => import('./views/ChaptersView').then((module) => ({ default: module.ChaptersView })))
const PromptBuilderView = lazy(() => import('./views/PromptBuilderView').then((module) => ({ default: module.PromptBuilderView })))
const HardCanonView = lazy(() => import('./views/HardCanonView').then((module) => ({ default: module.HardCanonView })))
const StoryDirectionView = lazy(() => import('./views/StoryDirectionView').then((module) => ({ default: module.StoryDirectionView })))
const GenerationPipelineView = lazy(() =>
  import('./views/GenerationPipelineView').then((module) => ({ default: module.GenerationPipelineView }))
)
const RevisionStudioView = lazy(() => import('./views/RevisionStudioView').then((module) => ({ default: module.RevisionStudioView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })))

export default function App() {
  const {
    data,
    storagePath,
    setStoragePath,
    status,
    setStatus,
    saveData,
    saveGenerationRunBundle,
    saveChapterCommitBundle,
    saveRevisionCommitBundle,
    replaceData: replaceStoredData
  } = useAppData()
  const [currentProjectId, setCurrentProjectId] = useState<ID | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [revisionPrefill, setRevisionPrefill] = useState<{ chapterId: ID | null; draftId: ID | null; requestId: ID } | null>(null)
  const [pipelineSnapshotId, setPipelineSnapshotId] = useState<ID | null>(null)

  async function replaceData(next: AppData, nextStoragePath?: string) {
    replaceStoredData(next, nextStoragePath)
    setCurrentProjectId(next.projects[0]?.id ?? null)
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

  if (!currentProject) {
    return <HomeView data={data} saveData={saveData} setProjectId={setCurrentProjectId} setView={setView} />
  }

  function renderCurrentView(activeData: AppData, activeProject: Project) {
    switch (view) {
      case 'dashboard':
        return <DashboardView data={activeData} project={activeProject} saveData={saveData} />
      case 'bible':
        return <BibleView data={activeData} project={activeProject} saveData={saveData} />
      case 'chapters':
        return <ChaptersView data={activeData} project={activeProject} saveData={saveData} saveRevisionCommitBundle={saveRevisionCommitBundle} />
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
      case 'settings':
        return (
          <SettingsView
            data={activeData}
            project={activeProject}
            saveData={saveData}
            storagePath={storagePath}
            setStoragePath={setStoragePath}
            setStatus={setStatus}
            replaceData={replaceData}
          />
        )
      default:
        return <DashboardView data={activeData} project={activeProject} saveData={saveData} />
    }
  }

  return (
    <Shell project={currentProject} view={view} setView={setView} setProjectId={setCurrentProjectId} status={status}>
      <Suspense fallback={<div className="view-loading">正在加载页面...</div>}>{renderCurrentView(data, currentProject)}</Suspense>
    </Shell>
  )
}
