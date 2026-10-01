import type { Character } from '../../../../shared/types'
import { StatusBadge } from '../../components/UI'

interface CharacterFocusCardProps {
  character: Character
}

export function CharacterFocusCard({ character }: CharacterFocusCardProps) {
  return (
    <div className="panel character-focus-card">
      <div>
        <span className="chapter-kicker">当前角色状态</span>
        <h2>{character.name}</h2>
        <p>{character.role || '未设置角色定位'}</p>
      </div>
      <div className="character-state-grid">
        <article>
          <span>深层欲望</span>
          <strong>{character.deepDesire || '未填写'}</strong>
        </article>
        <article>
          <span>核心恐惧</span>
          <strong>{character.coreFear || '未填写'}</strong>
        </article>
        <article>
          <span>关系状态</span>
          <strong>{character.protagonistRelationship || '未填写'}</strong>
        </article>
      </div>
      <div className="row-actions">
        <StatusBadge tone={character.isMain ? 'accent' : 'neutral'}>{character.isMain ? '主要角色' : '次要角色'}</StatusBadge>
        {character.lastChangedChapter ? <StatusBadge tone="info">最近变化第 {character.lastChangedChapter} 章</StatusBadge> : null}
      </div>
    </div>
  )
}
