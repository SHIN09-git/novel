// Two official chapter observations in a synthetic book. Both desktop QA and contract tests use the actual acceptance operation.
export function cardBalanceFixture(normalizeAppData, CharacterStateService) {
  const p = 'book', c = 'kui', stamp = '2026-01-01T00:00:00Z'
  const chapter = (order, body) => ({ id: 'c' + order, projectId: p, order, title: '样章', body,
    summary: '', newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '',
    endingHook: '', riskWarnings: '', createdAt: stamp, updatedAt: stamp })
  const log = { id: 'initial', projectId: p, characterId: c, chapterId: 'c10', chapterOrder: 10, note: '小葵的钱只剩十文。', createdAt: stamp }
  const initial = normalizeAppData({ projects: [{ id: p, name: '试算样书' }],
    chapters: [chapter(10, log.note), chapter(12, '她挣了二十文，钱袋里有三十文。')],
    characters: [{ id: c, projectId: p, name: '小葵', isMain: true, lastChangedChapter: 10, role: '过期角色定位',
      roleFunction: '船上账房', abilitiesAndResources: '钱只剩十文；擅长辨银；替船队保管五十文。', knownInformation: '知道过桥暗号。',
      relationshipTension: '信任掌柜', protagonistRelationship: '旧关系' }],
    characterStateLogs: [log] })
  const before = CharacterStateService.createFactFromLog(log, { id: 'cash', projectId: p, characterId: c,
    key: 'cash', label: '随身现金', category: 'resource', valueType: 'number', value: 10, unit: '文',
    trackingLevel: 'hard', promptPolicy: 'always' }, initial)
  const candidate = { id: 'earned', projectId: p, characterId: c, chapterId: 'c12', chapterOrder: 12, candidateType: 'transaction',
    targetFactId: 'cash', proposedFact: null, proposedTransaction: null, beforeValue: 10, afterValue: 30,
    evidence: before.chapters[1].body, confidence: 1, riskLevel: 'low', status: 'pending', createdAt: stamp, updatedAt: stamp }
  const pending = { ...before, characterStateChangeCandidates: [candidate] }
  const data = CharacterStateService.applyStateChangeCandidate(candidate.id, pending)
  return { data, pending, p, c, log }
}
