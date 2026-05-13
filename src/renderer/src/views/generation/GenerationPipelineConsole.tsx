import type { ComponentProps } from 'react'
import type { ChapterGenerationJob } from '../../../../shared/types'
import { Header } from '../../components/Layout'
import { PipelineConfigPanel } from '../../components/pipeline/PipelineConfigPanel'
import { PipelineCurrentArtifactPanel } from '../../components/pipeline/PipelineCurrentArtifactPanel'
import { PipelineDiagnosticsPanel } from '../../components/pipeline/PipelineDiagnosticsPanel'
import { PipelineEmptyState } from '../../components/pipeline/PipelineEmptyState'
import { PipelineJobList } from '../../components/pipeline/PipelineJobList'
import { PipelineLayout } from '../../components/pipeline/PipelineLayout'
import { PipelineMemoryCandidatesPanel } from '../../components/pipeline/PipelineMemoryCandidatesPanel'
import { PipelineRiskBanner } from '../../components/pipeline/PipelineRiskBanner'
import { PipelineStepRail } from '../../components/pipeline/PipelineStepRail'
import { PipelineTopStatusBar } from '../../components/pipeline/PipelineTopStatusBar'
import { PipelineTracePanel } from '../../components/pipeline/PipelineTracePanel'

interface GenerationPipelineConsoleProps {
  selectedJob: ChapterGenerationJob | null
  headerTitle: string
  headerDescription: string
  topStatusBar: ComponentProps<typeof PipelineTopStatusBar>
  configPanel: ComponentProps<typeof PipelineConfigPanel>
  jobList: ComponentProps<typeof PipelineJobList>
  currentArtifactPanel: ComponentProps<typeof PipelineCurrentArtifactPanel>
  memoryCandidatesPanel: ComponentProps<typeof PipelineMemoryCandidatesPanel>
  riskBanner: ComponentProps<typeof PipelineRiskBanner>
  stepRail: ComponentProps<typeof PipelineStepRail>
  diagnosticsPanel: ComponentProps<typeof PipelineDiagnosticsPanel>
  tracePanel: ComponentProps<typeof PipelineTracePanel>
}

export function GenerationPipelineConsole({
  selectedJob,
  headerTitle,
  headerDescription,
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
      <Header title={headerTitle} description={headerDescription} />
      <PipelineLayout
        topBar={<PipelineTopStatusBar {...topStatusBar} />}
        sidebar={
          <>
            <PipelineConfigPanel {...configPanel} />
            <PipelineJobList {...jobList} />
          </>
        }
        main={
          !selectedJob ? (
            <PipelineEmptyState />
          ) : (
            <>
              <PipelineCurrentArtifactPanel {...currentArtifactPanel} />
              <PipelineMemoryCandidatesPanel {...memoryCandidatesPanel} />
            </>
          )
        }
        inspector={
          <>
            <PipelineRiskBanner {...riskBanner} />
            <PipelineStepRail {...stepRail} />
            <PipelineDiagnosticsPanel {...diagnosticsPanel} />
            <PipelineTracePanel {...tracePanel} />
          </>
        }
      />
    </>
  )
}
