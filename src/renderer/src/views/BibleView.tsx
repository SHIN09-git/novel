import type { StoryBible } from '../../../shared/types'
import { createEmptyBible } from '../../../shared/defaults'
import { TextArea } from '../components/FormFields'
import { Header } from '../components/Layout'
import { useProjectData } from '../hooks/useProjectData'
import { now } from '../utils/format'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function BibleView({ data, project, saveData }: ProjectProps) {
  const scoped = useProjectData(data, project.id)
  const bible = scoped.bible ?? createEmptyBible(project.id)

  async function updateBible(patch: Partial<StoryBible>) {
    return saveData((current) => {
      const currentBible = current.storyBibles.find((item) => item.projectId === project.id) ?? bible
      const nextBible = { ...currentBible, ...patch, updatedAt: now() }
      const exists = current.storyBibles.some((item) => item.projectId === project.id)
      return {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        storyBibles: exists
          ? current.storyBibles.map((item) => (item.projectId === project.id ? nextBible : item))
          : [...current.storyBibles, nextBible]
      }
    })
  }

  return (
    <div className="bible-view">
      <Header title="小说圣经" description="这里应放长期稳定信息，而不是章节流水账。" />
      <section className="panel">
        <div className="notice">长期上下文要短、稳、可复用。会频繁变化的信息请写入章节复盘或角色当前状态。</div>
        <div className="form-grid">
          <TextArea label="世界观基础设定" value={bible.worldbuilding} debounceMs={500} bufferKey={project.id} onChange={(worldbuilding) => updateBible({ worldbuilding })} />
          <TextArea label="故事核心命题" value={bible.corePremise} debounceMs={500} bufferKey={project.id} onChange={(corePremise) => updateBible({ corePremise })} />
          <TextArea label="主角核心欲望" value={bible.protagonistDesire} debounceMs={500} bufferKey={project.id} onChange={(protagonistDesire) => updateBible({ protagonistDesire })} />
          <TextArea label="主角核心恐惧" value={bible.protagonistFear} debounceMs={500} bufferKey={project.id} onChange={(protagonistFear) => updateBible({ protagonistFear })} />
          <TextArea label="主线冲突" value={bible.mainConflict} debounceMs={500} bufferKey={project.id} onChange={(mainConflict) => updateBible({ mainConflict })} />
          <TextArea label="力量体系/规则体系" value={bible.powerSystem} debounceMs={500} bufferKey={project.id} onChange={(powerSystem) => updateBible({ powerSystem })} />
          <TextArea label="禁用套路" value={bible.bannedTropes} debounceMs={500} bufferKey={project.id} onChange={(bannedTropes) => updateBible({ bannedTropes })} />
          <TextArea label="文风样例" value={bible.styleSample} debounceMs={500} bufferKey={project.id} onChange={(styleSample) => updateBible({ styleSample })} />
          <TextArea label="叙事基调" value={bible.narrativeTone} debounceMs={500} bufferKey={project.id} onChange={(narrativeTone) => updateBible({ narrativeTone })} />
          <TextArea label="重要不可违背设定" value={bible.immutableFacts} debounceMs={500} bufferKey={project.id} onChange={(immutableFacts) => updateBible({ immutableFacts })} />
        </div>
      </section>
    </div>
  )
}
