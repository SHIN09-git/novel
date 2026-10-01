import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8')
}

async function main() {
  const checks = []
  const hook = await read('src/renderer/src/hooks/useBufferedField.ts')
  const fields = await read('src/renderer/src/components/FormFields.tsx')
  const bible = await read('src/renderer/src/views/BibleView.tsx')
  const characters = await read('src/renderer/src/views/characters/CharacterProfilePanels.tsx')
  const characterLedger = await read('src/renderer/src/views/characters/CharacterStateLedgerPanel.tsx')
  const foreshadowing = await read('src/renderer/src/views/ForeshadowingView.tsx')
  const timeline = await read('src/renderer/src/views/TimelineView.tsx')
  const stages = await read('src/renderer/src/views/StageSummaryView.tsx')
  const hardCanon = await read('src/renderer/src/views/HardCanonView.tsx')
  const settings = [
    await read('src/renderer/src/views/SettingsView.tsx'),
    await read('src/renderer/src/views/settings/SettingsCorePanels.tsx')
  ].join('\n')
  const appDataHook = await read('src/renderer/src/hooks/useAppData.ts')

  checks.push(
    assert(
      hook.includes('export function useBufferedField') &&
        hook.includes('setTimeout(() => flush(false), delayMs)') &&
        hook.includes('flush: () => flush(true)'),
      'buffered fields debounce background commits and force a retry on blur'
    )
  )
  checks.push(
    assert(
      hook.includes('dirtyRef.current') &&
        hook.includes('lastSubmittedRef.current = null') &&
        hook.includes('inFlightValueRef.current === next') &&
        hook.includes('attemptCommit(1)') &&
        hook.includes('isFailedCommitResult'),
      'failed commits get one safe retry while blur avoids duplicating an in-flight save'
    )
  )
  checks.push(
    assert(
      hook.includes('activeCommitRef.current') &&
        hook.includes('resetKeyRef.current !== resetKey') &&
        /if \(resetKeyRef\.current !== resetKey\) \{[\s\S]*?flush\(false\)[\s\S]*?activeCommitRef\.current = onCommit/.test(
          hook
        ),
      'switching entities flushes the old draft through its original commit callback'
    )
  )
  checks.push(
    assert(
      fields.includes("import { useBufferedField } from '../hooks/useBufferedField'") &&
        (fields.match(/useBufferedField\(\{/g) ?? []).length === 2 &&
        fields.includes('buffered.flush()'),
      'shared TextInput and TextArea use the buffered draft layer'
    )
  )
  checks.push(
    assert(
      (bible.match(/debounceMs=\{500\}/g) ?? []).length >= 10 &&
        bible.includes('const currentBible = current.storyBibles.find'),
      'Story Bible edits are debounced and merge patches against current persisted data'
    )
  )
  checks.push(
    assert(
      characters.includes('const bufferedFieldProps = { debounceMs: 500, bufferKey: character.id }') &&
        (characters.match(/\.\.\.bufferedFieldProps/g) ?? []).length >= 10,
      'character profile text fields stay responsive and reset by character id'
    )
  )
  checks.push(
    assert(
      characterLedger.includes('useBufferedField') &&
        characterLedger.includes('factEditableValue(fact)') &&
        characterLedger.includes('delayMs: 500') &&
        characterLedger.includes('resetKey: fact.id'),
      'character state ledger values debounce saves and exclude display-only units from editable values'
    )
  )
  checks.push(
    assert(
      (foreshadowing.match(/debounceMs=\{500\}/g) ?? []).length >= 6 &&
        foreshadowing.includes('bufferKey={selected.id}') &&
        (timeline.match(/debounceMs=\{500\}/g) ?? []).length >= 4 &&
        timeline.includes('bufferKey={event.id}'),
      'foreshadowing and timeline text editors debounce entity-scoped saves'
    )
  )
  checks.push(
    assert(
      (stages.match(/debounceMs=\{500\}/g) ?? []).length >= 5 &&
        hardCanon.includes('bufferKey={pack.id}') &&
        hardCanon.includes('const currentPack = HardCanonPackService.getHardCanonPackForProject') &&
        (settings.match(/debounceMs=\{500\}/g) ?? []).length >= 4 &&
        settings.includes('bufferKey="ai-base-url"') &&
        settings.includes('bufferKey="codex-cli-path"'),
      'stage summaries, HardCanon metadata and AI endpoint settings avoid per-keystroke full saves'
    )
  )
  checks.push(
    assert(
      bible.includes('return saveData((current) =>') &&
        characters.includes('onUpdate: (patch: Partial<Character>) => void | Promise<unknown>') &&
        foreshadowing.includes('return saveData((current) =>') &&
        timeline.includes('return saveData((current) =>') &&
        stages.includes('return saveData((current) =>') &&
        hardCanon.includes('return saved') &&
        settings.includes('return saveData((current) =>'),
      'debounced commit callbacks propagate SaveDataOutcome so failures remain retryable'
    )
  )
  checks.push(
    assert(
      appDataHook.indexOf('await getNovelDirectorDataApi().save(next)') <
        appDataHook.indexOf('commitPersistedData(next)', appDataHook.indexOf('const saveData: SaveDataHandler')),
      'debounced inputs retain the post-persistence AppData commit boundary'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, totalChecks: checks.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
