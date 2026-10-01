import type { Character } from '../../../../shared/types'
import { NumberInput, TextArea, TextInput, Toggle } from '../../components/FormFields'

interface CharacterProfilePanelsProps {
  character: Character
  onUpdate: (patch: Partial<Character>) => void | Promise<unknown>
  onDelete: () => void
}

export function CharacterProfilePanels({ character, onUpdate, onDelete }: CharacterProfilePanelsProps) {
  const bufferedFieldProps = { debounceMs: 500, bufferKey: character.id }
  return (
    <>
      <div className="panel character-basics-panel">
        <h2>基础设定</h2>
        <div className="form-grid compact">
          <TextInput {...bufferedFieldProps} label="角色名" value={character.name} onChange={(name) => onUpdate({ name })} />
          <TextInput {...bufferedFieldProps} label="角色定位" value={character.role} onChange={(role) => onUpdate({ role })} />
        </div>
        <div className="form-grid">
          <TextArea {...bufferedFieldProps} label="表层目标" value={character.surfaceGoal} onChange={(surfaceGoal) => onUpdate({ surfaceGoal })} />
          <TextArea {...bufferedFieldProps} label="深层欲望" value={character.deepDesire} onChange={(deepDesire) => onUpdate({ deepDesire })} />
          <TextArea {...bufferedFieldProps} label="核心恐惧" value={character.coreFear} onChange={(coreFear) => onUpdate({ coreFear })} />
          <TextArea {...bufferedFieldProps} label="自我欺骗" value={character.selfDeception} onChange={(selfDeception) => onUpdate({ selfDeception })} />
          <TextArea {...bufferedFieldProps} label="禁止写法" value={character.forbiddenWriting} onChange={(forbiddenWriting) => onUpdate({ forbiddenWriting })} />
        </div>
        <div className="row-actions">
          <Toggle label="主要角色" checked={character.isMain} onChange={(isMain) => onUpdate({ isMain })} />
          <button className="danger-button" onClick={onDelete}>删除角色</button>
        </div>
      </div>

      <div className="panel character-current-state-panel">
        <h2>当前状态</h2>
        <div className="form-grid">
          <TextArea {...bufferedFieldProps} label="当前知道的信息" value={character.knownInformation} onChange={(knownInformation) => onUpdate({ knownInformation })} />
          <TextArea {...bufferedFieldProps} label="当前不知道的信息" value={character.unknownInformation} onChange={(unknownInformation) => onUpdate({ unknownInformation })} />
          <TextArea {...bufferedFieldProps} label="与主角关系状态" value={character.protagonistRelationship} onChange={(protagonistRelationship) => onUpdate({ protagonistRelationship })} />
          <TextArea {...bufferedFieldProps} label="当前情绪状态" value={character.emotionalState} onChange={(emotionalState) => onUpdate({ emotionalState })} />
          <TextArea {...bufferedFieldProps} label="下一阶段行为倾向" value={character.nextActionTendency} onChange={(nextActionTendency) => onUpdate({ nextActionTendency })} />
          <NumberInput label="最近一次变化发生章节" value={character.lastChangedChapter} onChange={(lastChangedChapter) => onUpdate({ lastChangedChapter })} />
        </div>
      </div>
    </>
  )
}
