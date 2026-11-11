import assert from 'node:assert/strict'
import { cardBalanceFixture } from './fixtures/card-balance.mjs'
import { loadDomainModules } from './utils/load-domain-modules.mjs'

const { normalizeAppData, defaultModulesForMode, createEmptyChapterTask, CharacterStateService, PromptBuilderService,
  ContextNeedPlannerService, selectBudgetContext, createContextBudgetProfile, buildPipelineContextResultFromSelection,
  isolateOpeningCharacterCards, stringifyCharacterForPlan, characterFieldValue, writingCardAtChapter } = await loadDomainModules(
  'shared/defaults', 'services/CharacterStateService', 'services/PromptBuilderService', 'services/ContextNeedPlannerService',
  'renderer/src/utils/promptContext', 'services/OpeningChapterContextPolicy', 'services/contextBudget/scoringEngine',
  'services/characterState/writingCard')
const { data, pending, p, c, log } = cardBalanceFixture(normalizeAppData, CharacterStateService)
const project = data.projects[0], person = data.characters[0]
const task = { ...createEmptyChapterTask(), goal: '小葵照账付钱' }, budget = createContextBudgetProfile(p, 'standard', 7000)
const makePlan = (order, d = data) => {
  const plan = ContextNeedPlannerService.buildFromChapterIntent({ project, storyBible: null, targetChapterOrder: order, chapterTaskDraft: task,
    previousChapter: null, continuityBridge: null, characters: d.characters, characterStateFacts: d.characterStateFacts,
    foreshadowing: [], timelineEvents: [], stageSummaries: [] })
  return { ...plan, requiredCharacterCardFields: { [c]: ['roleFunction', 'abilitiesAndResources', 'relationshipTension'] } }
}
const raw = (order, d = data, plan = null) => PromptBuilderService.buildResult({ project, chapters: d.chapters, characters: d.characters,
  characterStateLogs: d.characterStateLogs, characterStateFacts: d.characterStateFacts, characterStateTransactions: d.characterStateTransactions,
  stateSourceChapters: d.chapters, contextNeedPlan: plan, timelineEvents: [], stageSummaries: [], foreshadowings: [], bible: null,
  config: { projectId: p, targetChapterOrder: order, mode: 'standard', modules: defaultModulesForMode('standard'), task,
    useContinuityBridge: false, selectedCharacterIds: [c], selectedForeshadowingIds: [] } })
const currentSection = text => text.match(/【角色状态账本切片】([\s\S]*?)(?=\n## |$)/u)?.[1] || ''
const beforeSnapshot = JSON.stringify(data)
for (const plan of [false, true]) {
  const at = (order, d = data) => currentSection(raw(order, d, plan ? makePlan(order, d) : null).finalPrompt)
  assert.match(at(11), /随身现金：10 文/)
  assert.doesNotMatch(at(11), /30 文|三十文/)
  assert.match(at(13, pending), /随身现金：10 文/, 'unaccepted income is not canon')
  assert.match(at(13), /随身现金：30 文/)
  assert.doesNotMatch(at(13), /钱只剩十文|过期角色定位|旧关系/)
  assert.match(at(13), /擅长辨银/)
  assert.match(at(13), /替船队保管五十文/)
}
const plan = makePlan(13)
const selection = selectBudgetContext(project, data, 13, budget, { characterIds: [c], contextNeedPlan: plan, chapterTask: task })
assert.deepEqual(selection.selectedCharacterIds, [c])
const production = buildPipelineContextResultFromSelection(project, data, 13, '', '', budget, selection, plan, null, task)
assert.match(currentSection(production.finalPrompt), /随身现金：30 文/)
assert.doesNotMatch(currentSection(production.finalPrompt), /钱只剩十文/)
assert.equal(characterFieldValue(person, 'roleFunction'), '船上账房')
assert.match(stringifyCharacterForPlan(person, plan), /船上账房/)
assert.doesNotMatch(stringifyCharacterForPlan(person, plan), /过期角色定位|知道过桥暗号|旧关系/)
assert.equal(characterFieldValue({ ...person, abilitiesAndResources: ' ' }, 'abilitiesAndResources'), '知道过桥暗号。')
assert.equal(isolateOpeningCharacterCards([person])[0].abilitiesAndResources, '')
const cash = data.characterStateFacts[0]
const evidence = '小葵替船队保管五十文公款。'
const crew = { ...data.characterStateChangeCandidates[0], id: 'crew-update', targetFactId: null,
  chapterId: 'c13', chapterOrder: 13, candidateType: 'create_fact', status: 'pending',
  proposedFact: { ...cash, id: 'crew-fund', label: '船队公款', key: 'cash', value: 50 },
  proposedTransaction: null, beforeValue: null, afterValue: 50, evidence }
const bothAccounts = CharacterStateService.applyStateChangeCandidate(crew.id, { ...data,
  chapters: [...data.chapters, { ...data.chapters[1], id: 'c13', order: 13, body: evidence }],
  characterStateChangeCandidates: [crew, ...data.characterStateChangeCandidates] })
assert.equal(bothAccounts.characterStateFacts.find(f => f.id === 'cash').value, 30)
assert.equal(bothAccounts.characterStateFacts.find(f => f.id === 'crew-fund').value, 50)
const twoPurses = currentSection(raw(14, bothAccounts).finalPrompt)
assert.match(twoPurses, /随身现金：30 文/)
assert.match(twoPurses, /船队公款：50 文/)
assert.doesNotMatch(twoPurses, /钱只剩十文/)
const cardWithBalance = { ...person, abilitiesAndResources: '钱只剩十文；擅长辨银' }
const renderedCash = (overrides) => writingCardAtChapter(cardWithBalance, [{ ...cash, ...overrides }], 13)
assert.equal(renderedCash({ key: '资源/余额', label: '资源/余额', value: '钱袋里还剩三十文。', unit: '' }).card.abilitiesAndResources, '擅长辨银')
for (const overrides of [
  { key: 'cash', label: '船队盘缠' }, { key: 'cash_drawer', label: '现金余额' },
  { key: 'cash', label: '现金', value: '支付二十文买药' }, { key: 'cash', unit: '美元' }
]) assert.equal(renderedCash(overrides).card.abilitiesAndResources, cardWithBalance.abilitiesAndResources)
assert(renderedCash({ key: 'cash', value: '支付二十文买药' }).warnings.size > 0)
for (const sentence of ['队里只剩十文', '她欠店里十文', '盘缠只剩十两银子', '十文是过桥费', '掌柜的钱只剩十文', '以前钱只剩十文',
  '她说：“钱只剩十文。”', '她说：“还记得吗？钱只剩十文。那是三年前。”', '队长清点公账，钱只剩十文', '回忆当初，钱只剩十文']) {
  assert.equal(writingCardAtChapter({ ...person, abilitiesAndResources: sentence }, [cash], 13).card.abilitiesAndResources, sentence)
}
const unknown = raw(13, { ...data, characterStateFacts: [{ ...cash, unit: '' }], characterStateTransactions: [] })
assert(unknown.warnings.some(w => w.includes('单位')), 'ambiguous balances are reported outside the writing prompt')
assert.match(currentSection(unknown.finalPrompt), /钱只剩十文/)
assert.doesNotMatch(unknown.finalPrompt, /账户或单位不能唯一对应/)
const undated = { ...data, characterStateTransactions: [], characters: [{ ...person, abilitiesAndResources: '钱只剩三十文；擅长辨银', lastChangedChapter: null }] }
assert.doesNotMatch(currentSection(raw(11, undated).finalPrompt), /三十文|30 文/)
assert.match(currentSection(raw(11, undated).finalPrompt), /擅长辨银/)
const noAccount = { ...undated, characterStateFacts: [], characterStateLogs: [{ ...log, chapterId: null, chapterOrder: null, note: '未注明何时开仓' }] }
assert.doesNotMatch(currentSection(raw(12, noAccount).finalPrompt), /三十文|未注明何时开仓/)
assert.match(currentSection(raw(13, noAccount).finalPrompt), /三十文/)
const discretionary = { ...data, characterStateTransactions: [], characterStateFacts: [{ ...cash, trackingLevel: 'soft', promptPolicy: 'when_relevant' }] }
const unrelated = { ...makePlan(13), mustCheckContinuity: [], requiredStateFactCategories: { [c]: ['physical'] } }
assert.doesNotMatch(currentSection(raw(13, discretionary, unrelated).finalPrompt), /钱只剩十文|随身现金：30 文/)
const foreignLog = { ...log, id: 'later', chapterId: 'c12', chapterOrder: 5, note: '迟来的定局' }
assert.doesNotMatch(raw(11, { ...data, characterStateLogs: [foreignLog] }).finalPrompt, /迟来的定局/)
assert.equal(JSON.stringify(data), beforeSnapshot, 'reading the card and building context never rewrites the manuscript or card')
console.log('PASS historical and current cash in real writing contexts, dedicated card fields, separate accounts, unchanged source cards')
