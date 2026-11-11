import type { Character } from '../../../shared/types'
import type { HardCanonCheck } from '../../../shared/types/hardCanonCheck'
import { parseHardCanonCheck } from '../../../shared/normalizers/hardCanonCheck'
import { Field } from '../components/FormFields'

type Mode = 'hint' | 'terms' | 'latin' | 'actor_action'
type ListKey = 'terms' | 'exceptions' | 'aliases' | 'actions' | 'objects'
type NumberKey = 'fromChapter' | 'toChapter' | 'maxPerChapter' | 'maxPerBook'

export function checkEditorDraft(check?: HardCanonCheck) {
  const literal = check?.kind === 'literal' ? check : undefined
  const role = check?.kind === 'actor_action' ? check : undefined
  return {
    mode: (literal?.mode ?? role?.kind ?? 'hint') as Mode, enforcement: check?.enforcement ?? 'review',
    fromChapter: String(check?.fromChapter ?? ''), toChapter: String(check?.toChapter ?? ''),
    terms: literal?.terms ?? [], exceptions: literal?.exceptions ?? [],
    maxPerChapter: String(literal?.maxPerChapter ?? ''), maxPerBook: String(literal?.maxPerBook ?? ''),
    actor: role?.actor ?? '', characterId: role?.characterId ?? '', aliases: role?.aliases ?? [],
    actions: role?.actions ?? [], side: role?.side ?? '', objects: role?.objects ?? [],
    state: role?.state ?? '', effect: role?.effect ?? 'forbid'
  }
}

type Draft = ReturnType<typeof checkEditorDraft>
const filled = (words: string[]) => words.filter((word) => word !== '')

export function checkFromEditor(draft: Draft): HardCanonCheck | undefined {
  if (draft.mode === 'hint') return undefined
  const number = (key: NumberKey) => {
    const raw = draft[key].trim()
    return draft[key] === '' ? {} : { [key]: /^\d+$/.test(raw) ? Number(raw) : NaN }
  }
  const bounds = { enforcement: draft.enforcement, ...number('fromChapter'), ...number('toChapter') }
  return parseHardCanonCheck(draft.mode === 'actor_action' ? {
    kind: 'actor_action', actor: draft.actor, ...(draft.characterId && { characterId: draft.characterId }),
    aliases: filled(draft.aliases), actions: filled(draft.actions), ...(draft.side && { side: draft.side }),
    objects: filled(draft.objects), ...(draft.state && { state: draft.state }), effect: draft.effect, ...bounds
  } : {
    kind: 'literal', mode: draft.mode, terms: filled(draft.terms), exceptions: filled(draft.exceptions),
    ...number('maxPerChapter'), ...number('maxPerBook'), ...bounds
  })
}

export function describeHardCanonCheck(check: HardCanonCheck): string {
  const parts: string[] = []
  if (check.kind === 'literal') {
    const terms = check.terms.join('、')
    parts.push(check.mode === 'latin' ? (terms ? `指定外文用语：${terms}` : '拉丁字母用语') : terms)
    if (check.maxPerChapter !== undefined) parts.push(`本章最多 ${check.maxPerChapter} 次`)
    if (check.maxPerBook !== undefined) parts.push(`全书最多 ${check.maxPerBook} 次`)
    if (check.maxPerChapter === undefined && check.maxPerBook === undefined) parts.push('本章禁止出现')
    if (check.exceptions?.length) parts.push(`例外：${check.exceptions.join('、')}`)
  } else {
    parts.push(check.actor, ...(check.aliases?.length ? [`别名：${check.aliases.join('、')}`] : []))
    if (check.state) parts.push(check.state)
    if (check.side) parts.push(`${check.side}侧`)
    parts.push(`${check.effect === 'allow' ? '允许' : '禁止'}：${check.actions.join('、')}`)
    if (check.objects?.length) parts.push(`物件：${check.objects.join('、')}`)
  }
  if (check.fromChapter !== undefined) parts.push(`从第 ${check.fromChapter} 章起`)
  if (check.toChapter !== undefined) parts.push(`至第 ${check.toChapter} 章止`)
  parts.push(check.enforcement === 'review' ? '仅提示复核' : '确证违规时阻断')
  return parts.join(' · ')
}

export function HardCanonCheckEditor({ draft, onChange, characters }: {
  draft: Draft; onChange: (draft: Draft) => void; characters: Character[]
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value })
  const list = (key: ListKey, label: string) => (
    <Field label={label}>
      <textarea rows={2} value={draft[key].join('\n')} onChange={(event) => set(key, event.target.value.split('\n'))} />
    </Field>
  )
  const number = (key: NumberKey, label: string) => (
    <Field label={label}>
      <input inputMode="numeric" value={draft[key]} placeholder="可留空" onChange={(event) => set(key, event.target.value)} />
    </Field>
  )
  return (
    <div className="hard-canon-check-editor">
      <Field label="检查方式">
        <select value={draft.mode} onChange={(event) => set('mode', event.target.value as Mode)}>
          <option value="hint">只作写作提示</option>
          <option value="terms">可机械核查：字面用语与次数</option>
          <option value="latin">可机械核查：拉丁字母用语</option>
          <option value="actor_action">可机械核查：角色动作</option>
        </select>
      </Field>
      {(draft.mode === 'terms' || draft.mode === 'latin') && <>
        {list('terms', draft.mode === 'terms' ? '检查用语（每行一项）' : '指定外文用语（每行一项，可留空）')}
        {list('exceptions', '例外用语（每行一项）')}
        <div className="form-grid">
          {number('maxPerChapter', '本章次数上限')}{number('maxPerBook', '全书次数上限')}
        </div>
        <small className="muted">两项均留空表示本章禁止出现；只填全书上限时，本章不单独限次。</small>
      </>}
      {draft.mode === 'actor_action' && <>
        <Field label="绑定角色卡（可选）">
          <select value={draft.characterId} onChange={(event) => {
            const characterId = event.target.value
            const character = characters.find((entry) => entry.id === characterId)
            onChange({ ...draft, characterId, actor: character?.name ?? draft.actor })
          }}>
            <option value="">不绑定角色卡</option>
            {characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.id}</option>)}
          </select>
        </Field>
        <Field label="角色称呼"><input value={draft.actor} onChange={(event) => set('actor', event.target.value)} /></Field>
        {list('aliases', '角色别名（每行一项）')}
        <div className="form-grid">
          <Field label="动作要求">
            <select value={draft.effect} onChange={(event) => set('effect', event.target.value as Draft['effect'])}>
              <option value="forbid">禁止</option><option value="allow">允许</option>
            </select>
          </Field>
          <Field label="侧别">
            <select value={draft.side} onChange={(event) => set('side', event.target.value)}>
              <option value="">不限</option><option value="左">左</option><option value="右">右</option>
            </select>
          </Field>
        </div>
        {list('actions', '动作（每行一项）')}{list('objects', '物件（每行一项）')}
        <Field label="适用状态（可选）"><input value={draft.state} onChange={(event) => set('state', event.target.value)} /></Field>
      </>}
      {draft.mode !== 'hint' && <>
        <div className="form-grid">{number('fromChapter', '起始章（含）')}{number('toChapter', '结束章（含）')}</div>
        <Field label="核查结果">
          <select value={draft.enforcement} onChange={(event) => set('enforcement', event.target.value as Draft['enforcement'])}>
            <option value="review">仅提示作者复核</option><option value="block">确证违规时阻断采纳</option>
          </select>
        </Field>
      </>}
    </div>
  )
}
