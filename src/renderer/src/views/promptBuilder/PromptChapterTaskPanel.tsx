import type { ChapterTask } from '../../../../shared/types'
import { TextArea, TextInput } from '../../components/FormFields'

interface PromptChapterTaskPanelProps {
  task: ChapterTask
  onTaskChange: (task: ChapterTask) => void
}

export function PromptChapterTaskPanel({
  task,
  onTaskChange
}: PromptChapterTaskPanelProps) {
  return (
    <section className="panel prompt-chapter-task-panel">
      <h2>当前章节任务书</h2>
      <div className="form-grid">
        <TextArea label="本章目标" value={task.goal} onChange={(goal) => onTaskChange({ ...task, goal })} />
        <TextArea label="本章必须推进的冲突" value={task.conflict} onChange={(conflict) => onTaskChange({ ...task, conflict })} />
        <TextArea label="本章必须保留的悬念" value={task.suspenseToKeep} onChange={(suspenseToKeep) => onTaskChange({ ...task, suspenseToKeep })} />
        <TextArea label="本章允许回收的伏笔" value={task.allowedPayoffs} onChange={(allowedPayoffs) => onTaskChange({ ...task, allowedPayoffs })} />
        <TextArea label="本章禁止回收的伏笔" value={task.forbiddenPayoffs} onChange={(forbiddenPayoffs) => onTaskChange({ ...task, forbiddenPayoffs })} />
        <TextArea label="本章结尾钩子" value={task.endingHook} onChange={(endingHook) => onTaskChange({ ...task, endingHook })} />
        <TextArea label="本章读者应该产生的情绪" value={task.readerEmotion} onChange={(readerEmotion) => onTaskChange({ ...task, readerEmotion })} />
        <TextInput label="本章预计字数" value={task.targetWordCount} onChange={(targetWordCount) => onTaskChange({ ...task, targetWordCount })} />
        <TextArea label="文风要求" value={task.styleRequirement} onChange={(styleRequirement) => onTaskChange({ ...task, styleRequirement })} />
      </div>
    </section>
  )
}
