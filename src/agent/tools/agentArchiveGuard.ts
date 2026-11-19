import { assertProjectWritable, isProjectArchived } from '../../services/ProjectLifecycleService'
import type { AppData } from '../../shared/types'
import { findProjectId, stringArg } from './agentToolArguments'

// Some legacy write tools identify their project through the run/job/preview, not a project argument.
export function assertAgentWriteTargetActive(name: string, data: AppData, args: Record<string, unknown>): void {
  if (name === 'agent.createProject' || name === 'agent.cancelChapterPipeline' || !data.projects.some(isProjectArchived)) return
  const selector = stringArg(args, 'projectId') ?? stringArg(args, 'project')
  const ids = [
    ...(selector ? [findProjectId(data, args)] : []),
    ...(args.jobId ? [data.chapterGenerationJobs.find(item => item.id === args.jobId)?.projectId] : []),
    ...(args.agentRunId ? [data.agentRuns.find(item => item.id === args.agentRunId)?.projectId] : []),
    ...(args.previewId ? [data.agentActionPreviews.find(item => item.id === args.previewId)?.projectId] : [])
  ]
  assertProjectWritable(data.projects.find(project => ids.includes(project.id) && isProjectArchived(project)))
}
