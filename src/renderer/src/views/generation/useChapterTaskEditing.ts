import { useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import type { AppData, ChapterGenerationJob, ChapterTask, ContextBudgetMode, GenerationRunBundle, ID, PipelineMode, Project, PromptContextSnapshot } from '../../../../shared/types'
import { getChapterTaskForJob, TASK_SCOPE_LABELS } from '../../../../services/ChapterTaskEditService'
import { assertChapterTaskContextSourceCurrent, chapterTaskContextSourceSignature } from '../../../../services/chapterTaskEdit/contextSourceBinding'
import type { PipelineTaskEditor } from '../../components/pipeline/PipelineTaskEditor'
import type { SaveDataHandler, SaveDataInput } from '../../utils/saveDataState'
import { newId, now } from '../../utils/format'

interface Args {
  data: AppData; project: Project; selectedJob: ChapterGenerationJob | null
  targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string
  budgetMode: ContextBudgetMode; budgetMaxTokens: number; pipelineMode: PipelineMode; isRunning: boolean
  saveData: SaveDataHandler; saveGenerationRunBundle?: (next: SaveDataInput, bundle: GenerationRunBundle) => Promise<void>
  selectJob: (id: ID) => void
  onGenerate: (job: ChapterGenerationJob) => void
  confirmSnapshotRefresh: () => Promise<boolean>
  selectedSnapshot?: PromptContextSnapshot | null
}

export function useChapterTaskEditing(args: Args): ComponentProps<typeof PipelineTaskEditor> {
  const { data, project, selectedJob } = args
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const task = !selectedJob && args.selectedSnapshot ? args.selectedSnapshot.chapterTask : getChapterTaskForJob(data, project.id, selectedJob, selectedJob?.targetChapterOrder ?? args.targetChapterOrder, args.estimatedWordCount, args.readerEmotionTarget)
  async function onSave(nextTask: ChapterTask) {
    if (lock.current || args.isRunning) throw new Error('请等待当前操作完成。')
    lock.current = true
    setSaving(true)
    try {
      const refresh = selectedJob?.contextSource === 'prompt_snapshot' || (!selectedJob && Boolean(args.selectedSnapshot))
      if (refresh && !await args.confirmSnapshotRefresh()) throw new Error('已取消另建上下文，修改仍保留在编辑器中。')
      const { prepareChapterTaskEdit } = await import('../../../../services/ChapterTaskEditService')
      const { applyGenerationRunBundleToAppData, buildGenerationRunBundle } = await import('../../../../services/GenerationRunBundleService')
      const target = selectedJob?.targetChapterOrder ?? args.targetChapterOrder
      const contextSourceSignature = chapterTaskContextSourceSignature(data, project.id, target)
      const prepared = await prepareChapterTaskEdit(data, {
        projectId: project.id, sourceJobId: selectedJob?.id, sourceUpdatedAt: selectedJob?.updatedAt,
        sourceSnapshotId: !selectedJob ? args.selectedSnapshot?.id : undefined,
        targetChapterOrder: target, task: nextTask,
        jobId: newId(), createdAt: now(), budgetMode: args.budgetMode, budgetMaxTokens: args.budgetMaxTokens,
        pipelineMode: args.pipelineMode, refreshContext: refresh
      })
      const bundle = buildGenerationRunBundle(prepared.data, prepared.job.id)
      const merge = (current: AppData) => {
        const currentSource = current.chapterGenerationJobs.find((job) => job.id === selectedJob?.id)
        if (selectedJob && currentSource?.updatedAt !== selectedJob.updatedAt) throw new Error('原任务已变化，请重新查看后保存。')
        if (prepared.impact.scope === 'context') {
          assertChapterTaskContextSourceCurrent(current, project.id, target, contextSourceSignature)
        }
        return applyGenerationRunBundleToAppData(current, bundle)
      }
      if (args.saveGenerationRunBundle) await args.saveGenerationRunBundle(merge, bundle)
      else {
        const result = await args.saveData(merge)
        if (!result.ok) throw new Error(result.errorMessage)
      }
      args.selectJob(prepared.job.id)
    } finally { lock.current = false; setSaving(false) }
  }
  return {
    task, onSave, busy: saving || args.isRunning || selectedJob?.status === 'running',
    onGenerate: selectedJob?.status === 'idle' && selectedJob.taskEdit ? () => args.onGenerate(selectedJob) : undefined,
    sourceLabel: selectedJob?.taskEdit ? '已保存的新任务，原运行保留' : selectedJob ? `第 ${selectedJob.targetChapterOrder} 章；保存后另建运行，原草稿保留` : `第 ${args.targetChapterOrder} 章的新任务`,
    impact: selectedJob?.taskEdit ? { label: TASK_SCOPE_LABELS[selectedJob.taskEdit.scope], reusableArtifacts: selectedJob.taskEdit.reusableArtifacts, warnings: selectedJob.taskEdit.warnings } : undefined
  }
}
