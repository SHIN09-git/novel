import type { StoryBible } from '../../../shared/types'
import { createEmptyBible } from '../../../shared/defaults'
import { TextArea } from '../components/FormFields'
import { Header } from '../components/Layout'
import { now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function BibleView({ data, project, saveData }: ProjectProps) {
  const bible = projectData(data, project.id).bible ?? createEmptyBible(project.id)

  async function updateBible(patch: Partial<StoryBible>) {
    const nextBible = { ...bible, ...patch, updatedAt: now() }
    const exists = data.storyBibles.some((item) => item.projectId === project.id)
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      storyBibles: exists
        ? data.storyBibles.map((item) => (item.projectId === project.id ? nextBible : item))
        : [...data.storyBibles, nextBible]
    })
  }

  return (
    <div className="bible-view">
      <Header title="小说圣经" description="这里应放长期稳定信息，而不是章节流水账。" />
      <section className="panel">
        <div className="notice">长期上下文要短、稳、可复用。会频繁变化的信息请写入章节复盘或角色当前状态。</div>
        <div className="form-grid">
          <TextArea label="世界观基础设定" value={bible.worldbuilding} onChange={(worldbuilding) => updateBible({ worldbuilding })} />
          <TextArea label="故事核心命题" value={bible.corePremise} onChange={(corePremise) => updateBible({ corePremise })} />
          <TextArea label="主角核心欲望" value={bible.protagonistDesire} onChange={(protagonistDesire) => updateBible({ protagonistDesire })} />
          <TextArea label="主角核心恐惧" value={bible.protagonistFear} onChange={(protagonistFear) => updateBible({ protagonistFear })} />
          <TextArea label="主线冲突" value={bible.mainConflict} onChange={(mainConflict) => updateBible({ mainConflict })} />
          <TextArea label="力量体系/规则体系" value={bible.powerSystem} onChange={(powerSystem) => updateBible({ powerSystem })} />
          <TextArea label="禁用套路" value={bible.bannedTropes} onChange={(bannedTropes) => updateBible({ bannedTropes })} />
          <TextArea label="文风样例" value={bible.styleSample} onChange={(styleSample) => updateBible({ styleSample })} />
          <TextArea label="叙事基调" value={bible.narrativeTone} onChange={(narrativeTone) => updateBible({ narrativeTone })} />
          <TextArea label="重要不可违背设定" value={bible.immutableFacts} onChange={(immutableFacts) => updateBible({ immutableFacts })} />
        </div>
      </section>
    </div>
  )
}
