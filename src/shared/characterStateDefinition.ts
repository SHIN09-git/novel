import type { CharacterStateFactDefinition } from './types/character'

export const qualifiedAccount = /公款|公[账帐]|队|团|集体|公用|公共|备用金|共享|欠款|欠债|押金|货款|预算|赏金|赏银|存款|账户|代管|team|crew|group|party|shared|debt|deposit/i

/** Some legacy records use "cash" for both a personal purse and a named fund. */
export function resourceAccountScope(key = '', label = ''): string {
  return qualifiedAccount.test(key + ' ' + label) ? (label.trim() || key.trim()) : ''
}

export function stateFactDefinition(fact: CharacterStateFactDefinition): CharacterStateFactDefinition {
  const { category, key, unit, label, valueType, trackingLevel, promptPolicy, linkedCardFields, confidence, status } = fact
  return { category, key, unit, label, valueType, trackingLevel, promptPolicy, linkedCardFields: [...linkedCardFields], confidence, status }
}
