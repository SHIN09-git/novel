import type { Character, ID } from '../../../../shared/types'
import { Toggle } from '../../components/FormFields'

interface PromptCharacterSelectionPanelProps {
  characters: Character[]
  automaticallyRecommendedIds: Set<ID>
  selectedCharacterIds: ID[]
  onToggleCharacter: (id: ID, checked: boolean) => void
}

export function PromptCharacterSelectionPanel({
  characters,
  automaticallyRecommendedIds,
  selectedCharacterIds,
  onToggleCharacter
}: PromptCharacterSelectionPanelProps) {
  return (
    <section className="panel">
      <h2>手动选择本章相关角色</h2>
      <div className="checkbox-grid">
        {characters.map((character) => (
          <Toggle
            key={character.id}
            label={`${character.name}${automaticallyRecommendedIds.has(character.id) ? '（自动推荐）' : ''}`}
            checked={selectedCharacterIds.includes(character.id)}
            onChange={(checked) => onToggleCharacter(character.id, checked)}
          />
        ))}
      </div>
    </section>
  )
}
