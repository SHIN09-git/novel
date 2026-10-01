import { useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Character, ID } from '../../../../shared/types'

interface CharacterListPaneProps {
  characters: Character[]
  selectedId: ID | null
  onSelect: (id: ID) => void
}

export function CharacterListPane({ characters, selectedId, onSelect }: CharacterListPaneProps) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLocaleLowerCase()
  const filtered = characters.filter((character) => `${character.name} ${character.role}`.toLocaleLowerCase().includes(search))
  return (
    <aside className="list-pane character-list-pane">
      <div className="chapter-shelf-header">
        <span>角色</span>
        <strong>{characters.length}</strong>
      </div>
      <div className="character-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label="搜索角色" placeholder="搜索姓名或定位" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query ? <button type="button" className="icon-button" aria-label="清空角色搜索" title="清空搜索" onClick={() => setQuery('')}><X size={14} aria-hidden="true" /></button> : null}
      </div>
      <div className="character-list-results" aria-label="角色列表">
      {filtered.map((character) => (
        <button key={character.id} type="button" aria-pressed={character.id === selectedId} className={character.id === selectedId ? 'list-item active' : 'list-item'} onClick={() => onSelect(character.id)}>
          <strong>{character.name}</strong>
          <span>{character.role || '未设置定位'}</span>
          <small>{character.isMain ? '主要角色' : '次要角色'} · {character.emotionalState || '未记录情绪'}</small>
        </button>
      ))}
      {!filtered.length ? <p className="muted" role="status">{search ? '没有匹配的角色' : '暂无角色'}</p> : null}
      </div>
    </aside>
  )
}
