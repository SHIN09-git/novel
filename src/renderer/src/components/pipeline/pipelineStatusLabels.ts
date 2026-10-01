import type { ChapterGenerationJob } from '../../../../shared/types'

export function pipelineJobStatusLabel(status: ChapterGenerationJob['status'] | 'empty'): string {
  return {
    empty: '尚未开始',
    idle: '等待开始',
    running: '正在生成',
    paused: '已暂停',
    completed: '生成完成',
    failed: '生成失败'
  }[status]
}
