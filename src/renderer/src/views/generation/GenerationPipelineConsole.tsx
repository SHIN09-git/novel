import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type { ChapterGenerationJob } from '../../../../shared/types'
import { Header } from '../../components/Layout'
import { PipelineConfigPanel } from '../../components/pipeline/PipelineConfigPanel'
import { PipelineCurrentArtifactPanel } from '../../components/pipeline/PipelineCurrentArtifactPanel'
import type { PipelineDiagnosticsPanelProps } from '../../components/pipeline/PipelineDiagnosticsPanel'
import { PipelineEmptyState } from '../../components/pipeline/PipelineEmptyState'
import { PipelineJobList } from '../../components/pipeline/PipelineJobList'
import { PipelineLayout } from '../../components/pipeline/PipelineLayout'
import type { PipelineMemoryCandidatesPanelProps } from '../../components/pipeline/PipelineMemoryCandidatesPanel'
import { PipelineRiskBanner } from '../../components/pipeline/PipelineRiskBanner'
import { PipelineStepRail } from '../../components/pipeline/PipelineStepRail'
import { PipelineStageDecisionProvider } from '../../components/pipeline/PipelineStageBoard'
import { PipelineTopStatusBar } from '../../components/pipeline/PipelineTopStatusBar'
import type { PipelineTracePanelProps } from '../../components/pipeline/PipelineTracePanel'

const PipelineMemoryCandidatesPanel = lazy(() =>
  import('../../components/pipeline/PipelineMemoryCandidatesPanel').then((module) => ({ default: module.PipelineMemoryCandidatesPanel }))
)
const PipelineDiagnosticsPanel = lazy(() =>
  import('../../components/pipeline/PipelineDiagnosticsPanel').then((module) => ({ default: module.PipelineDiagnosticsPanel }))
)
const PipelineTracePanel = lazy(() =>
  import('../../components/pipeline/PipelineTracePanel').then((module) => ({ default: module.PipelineTracePanel }))
)

function LazyPanelFallback({ label }: { label: string }) {
  return (
    <section className="pipeline-card">
      <p className="muted">正在加载{label}...</p>
    </section>
  )
}

interface GenerationPipelineConsoleProps {
  taskEditor?: ReactNode
  selectedJob: ChapterGenerationJob | null
  headerTitle: string
  headerDescription: string
  topStatusBar: ComponentProps<typeof PipelineTopStatusBar>
  configPanel: ComponentProps<typeof PipelineConfigPanel>
  jobList: ComponentProps<typeof PipelineJobList>
  currentArtifactPanel: ComponentProps<typeof PipelineCurrentArtifactPanel>
  memoryCandidatesPanel: PipelineMemoryCandidatesPanelProps
  riskBanner: ComponentProps<typeof PipelineRiskBanner>
  stepRail: ComponentProps<typeof PipelineStepRail>
  diagnosticsPanel: PipelineDiagnosticsPanelProps
  tracePanel: PipelineTracePanelProps
}

export function GenerationPipelineConsole({
  taskEditor,
  selectedJob,
  headerTitle,
  topStatusBar,
  configPanel,
  jobList,
  currentArtifactPanel,
  memoryCandidatesPanel,
  riskBanner,
  stepRail,
  diagnosticsPanel,
  tracePanel
}: GenerationPipelineConsoleProps) {
  return (
    <>
      <Header
        title={headerTitle}
        description={`第 ${topStatusBar.targetChapterOrder} 章 · ${topStatusBar.isRunning ? '正在生成' : selectedJob ? '查看本次运行' : '准备新任务'}`}
      />
      <PipelineStageDecisionProvider draft={diagnosticsPanel.latestDraft} chapterCommitBundles={diagnosticsPanel.chapterCommitBundles}>
        <PipelineLayout
          topBar={<PipelineTopStatusBar {...topStatusBar} />}
          sidebar={
            <>
              <PipelineConfigPanel {...configPanel} />
              <PipelineJobList {...jobList} />
            </>
          }
          main={
            <>
              <PipelineCurrentArtifactPanel {...currentArtifactPanel} taskEditor={taskEditor} />
              {!selectedJob ? <PipelineEmptyState /> : (
                <Suspense fallback={<LazyPanelFallback label="记忆候选" />}>
                  <PipelineMemoryCandidatesPanel {...memoryCandidatesPanel} />
                </Suspense>
              )}
            </>
          }
          inspector={
            <div className="pipeline-inspector-stack">
              <PipelineRiskBanner {...riskBanner} />
              <PipelineStepRail {...stepRail} />
              <Suspense fallback={<LazyPanelFallback label="诊断面板" />}>
                <PipelineDiagnosticsPanel {...diagnosticsPanel} />
              </Suspense>
              <Suspense fallback={<LazyPanelFallback label="Run Trace" />}>
                <PipelineTracePanel {...tracePanel} />
              </Suspense>
            </div>
          }
        />
      </PipelineStageDecisionProvider>
    </>
  )
}
