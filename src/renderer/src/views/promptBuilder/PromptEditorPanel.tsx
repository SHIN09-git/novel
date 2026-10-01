import { TextInput } from '../../components/FormFields'

interface PromptEditorPanelProps {
  prompt: string
  snapshotNote: string
  onPromptChange: (prompt: string) => void
  onSnapshotNoteChange: (note: string) => void
}

export function PromptEditorPanel({
  prompt,
  snapshotNote,
  onPromptChange,
  onSnapshotNoteChange
}: PromptEditorPanelProps) {
  return (
    <section className="panel prompt-editor-panel">
      <div className="panel-title-row sticky-title-row">
        <h2>最终 Prompt</h2>
      </div>
      <textarea className="prompt-editor" aria-label="最终 Prompt" spellCheck={false} value={prompt} onChange={(event) => onPromptChange(event.target.value)} />
      <div className="prompt-editor-note"><TextInput label="快照备注" value={snapshotNote} onChange={onSnapshotNoteChange} /></div>
    </section>
  )
}
