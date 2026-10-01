import assert from 'node:assert/strict'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { repoRoot } from './repo-root.mjs'
import { createSpecialtyFixture, loadSpecialtyRuntime, SPECIALTY_EVIDENCE, SPECIALTY_IDS,
  SPECIALTY_KINDS, specialtyFact } from '../validate-candidate-specialty-coverage.mjs'

const observedCollections = ['foreshadowings', 'timelineEvents', 'memoryUpdateCandidates', 'candidateDecisionReceipts',
  'chapters', 'characters', 'characterStateFacts', 'characterStateTransactions', 'chapterVersions', 'revisionVersions',
  'chapterCommitBundles', 'revisionCommitBundles', 'hardCanonPacks']
const observed = (data) => Object.fromEntries(observedCollections.map((key) => [key, data[key]]))
const receiptSelector = (id) => `[data-decision-receipt-id="${id}"]`

function within(parent, child) {
  const path = relative(resolve(parent), resolve(child))
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

// Reuses qa-candidate-decisions-ui.mjs's UNBOUND helpers: evaluate(client, expression),
// waitFor(client, BooleanExpression, timeout), clickButton(client, label), etc.
// The caller owns the already-running production/packaged app and its isolated userData.
export async function runCandidateUndoQA({ client, evaluate, waitFor, clickButton, openEvent, clickCandidateButton,
  isolatedUserDataDir, captureScreenshot }) {
  assert(client && typeof client.send === 'function')
  for (const dependency of [evaluate, waitFor, clickButton, openEvent, clickCandidateButton]) assert.equal(typeof dependency, 'function')
  assert(typeof isolatedUserDataDir === 'string' && within(resolve(repoRoot, 'tmp'), isolatedUserDataDir),
    'Candidate undo QA requires a caller-owned isolated userData directory under repository tmp.')
  const ev = (expression) => evaluate(client, expression)
  const until = (expression, timeout = 30_000) => waitFor(client, expression, timeout)
  const load = async () => {
    const loaded = await ev('(async () => await window.novelDirector.data.load())()')
    assert(typeof loaded.storagePath === 'string' && loaded.storagePath.endsWith('.sqlite') && within(isolatedUserDataDir, loaded.storagePath),
      'Candidate undo QA escaped the supplied isolated SQLite directory.')
    return loaded
  }
  const original = await load()
  assert(typeof original.storagePath === 'string' && original.storagePath.endsWith('.sqlite') && within(isolatedUserDataDir, original.storagePath),
    'Candidate undo QA must use SQLite inside the supplied isolated userData directory.')
  const fixture = await createSpecialtyFixture(await loadSpecialtyRuntime())
  const checks = []
  const screenshots = []
  let seeded = false
  let failure
  let cleanupFailure

  async function pointerClick(expression, label) {
    const point = await ev(`(async () => {
      const element = ${expression}
      if (!element || element.disabled) return null
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      await new Promise(resolve => requestAnimationFrame(resolve))
      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
      const hit = document.elementFromPoint(x, y)
      return rect.width > 0 && rect.height > 0 && hit && element.contains(hit) ? { x, y } : null
    })()`)
    assert(point, `Could not reach visible UI control: ${label}.`)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }

  async function clickWithin(selector, label, prefix = false) {
    await pointerClick(`[...(document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('button') ?? [])].find((item) => !item.disabled &&
      (${prefix ? `item.textContent?.trim().startsWith(${JSON.stringify(label)})` : `item.textContent?.trim() === ${JSON.stringify(label)}`}))`, `${label} within ${selector}`)
  }

  async function setChecked(selector, checked) {
    assert.equal(await ev(`document.querySelector(${JSON.stringify(selector)})?.checked`), !checked, `Unexpected checkbox initial state: ${selector}`)
    await pointerClick(`document.querySelector(${JSON.stringify(selector)})`, selector)
    await until(`document.querySelector(${JSON.stringify(selector)})?.checked === ${checked}`)
    const size = await ev(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { width: rect.width, height: rect.height }; })()`)
    assert(size.width >= 12 && size.width <= 20 && size.height >= 12 && size.height <= 20,
      'Inbox checkboxes inherited text-input dimensions.')
  }

  async function assertUndoEnabled(scope, enabled) {
    await until(`Boolean([...document.querySelectorAll(${JSON.stringify(`${scope} .inbox-undo-preview button`)})]
      .some(item => item.textContent?.trim() === '确认撤销这次处理' && item.disabled === ${!enabled}))`)
  }

  async function assertInlineRisk(scope, required) {
    if (required) await until(`document.querySelector(${JSON.stringify(`${scope} .inbox-undo-risk`)})?.textContent?.includes('高风险') === true`)
    assert.equal(await ev('Boolean(document.querySelector(".confirm-dialog"))'), false, 'Undo preview should provide its own inline confirmation.')
  }

  async function submitUndo(scope, receipt) {
    await assertInlineRisk(scope, receipt.requiresConfirmation)
    await assertUndoEnabled(scope, true)
    await clickWithin(`${scope} .inbox-undo-preview`, '确认撤销这次处理')
    await until(`(async () => (await window.novelDirector.data.load()).data.candidateDecisionReceipts
      .some(item => item.operation === 'undo' && item.undoesReceiptId === ${JSON.stringify(receipt.id)}))()`)
    const { data } = await load()
    const undoReceipt = data.candidateDecisionReceipts.find((item) => item.undoesReceiptId === receipt.id)
    assert.equal(undoReceipt.requiresConfirmation, receipt.requiresConfirmation)
    assert.equal(await ev('Boolean(document.querySelector(".confirm-dialog"))'), false, 'Undo unexpectedly required a second modal.')
    return data
  }

  async function reloadInbox() {
    await client.send('Page.reload', { ignoreCache: true })
    await until(`Boolean([...document.querySelectorAll('.project-row')].some(item => item.querySelector('h3')?.textContent === ${JSON.stringify(SPECIALTY_IDS.project)}))`)
    const entered = await ev(`(() => {
      const row = [...document.querySelectorAll('.project-row')].find(item => item.querySelector('h3')?.textContent === ${JSON.stringify(SPECIALTY_IDS.project)})
      const button = [...(row?.querySelectorAll('button') ?? [])].find(item => item.textContent?.trim() === '进入' && !item.disabled)
      if (!button) return false
      button.click(); return true
    })()`)
    assert(entered, 'Could not enter the exact specialty fixture project after reload.')
    await until('Boolean(document.querySelector(".dashboard-view") && !document.querySelector(".view-loading"))')
    await clickButton(client, '决策收件箱')
    await until('Boolean(document.querySelector(".decision-inbox-view"))')
  }

  async function showView(label) {
    await clickWithin('.inbox-view-switch', label, true)
    await until(`Boolean([...document.querySelectorAll('.inbox-view-switch button')].some(item =>
      item.textContent?.trim().startsWith(${JSON.stringify(label)}) && item.getAttribute('aria-pressed') === 'true'))`)
  }

  async function showFilter(label, candidateIds) {
    await clickWithin('.inbox-toolbar', label, true)
    await until(`Boolean([...document.querySelectorAll('.inbox-toolbar button')].some(item =>
      item.textContent?.trim().startsWith(${JSON.stringify(label)}) && item.getAttribute('aria-pressed') === 'true'))`)
    await until(`JSON.stringify([...document.querySelectorAll('.inbox-candidate')].map(item => item.dataset.candidateId).sort()) ===
      ${JSON.stringify(JSON.stringify([...candidateIds].sort()))}`)
  }

  async function editText(label, text, fieldsSelector = '.inbox-amendment-field') {
    const focused = await ev(`(() => {
      const field = [...document.querySelectorAll(${JSON.stringify(fieldsSelector)})].find(item => item.querySelector('span')?.textContent?.trim() === ${JSON.stringify(label)})
      const input = field?.querySelector('input:not([type=checkbox]), textarea')
      if (!input || input.disabled) return false
      input.scrollIntoView({ block: 'center', behavior: 'instant' }); input.focus(); input.setSelectionRange(0, input.value.length)
      return document.activeElement === input
    })()`)
    assert(focused, `Could not focus ${label}.`)
    await client.send('Input.insertText', { text })
    await until(`Boolean([...document.querySelectorAll(${JSON.stringify(fieldsSelector)})].some(item => item.querySelector('input, textarea')?.value === ${JSON.stringify(text)}))`)
  }

  function assertOrdinaryUnchanged(before, after) {
    for (const key of observedCollections.filter((item) => !['foreshadowings', 'timelineEvents', 'memoryUpdateCandidates', 'candidateDecisionReceipts'].includes(item))) {
      assert.deepEqual(after[key], before[key], `${key} changed during specialty decisions.`)
    }
    for (const [key, items] of Object.entries(before)) {
      if (Array.isArray(items)) assert.deepEqual(after[key].filter((item) => item.projectId && item.projectId !== SPECIALTY_IDS.project),
        items.filter((item) => item.projectId && item.projectId !== SPECIALTY_IDS.project), `Another project's ${key} changed.`)
    }
  }

  function assertSpecialtyIsolation(before, after, candidateId, factId) {
    for (const key of ['foreshadowings', 'timelineEvents']) {
      assert.deepEqual(after[key].filter((item) => item.id !== factId), before[key].filter((item) => item.id !== factId),
        `Another specialty fact changed in ${key}.`)
    }
    assert.deepEqual(after.memoryUpdateCandidates.filter((item) => item.id !== candidateId),
      before.memoryUpdateCandidates.filter((item) => item.id !== candidateId), 'Another candidate changed with this decision.')
  }

  try {
    // Fixture preparation only. No accepted candidates, receipts or UI successes are seeded.
    const additions = Object.fromEntries(Object.entries(fixture).filter(([, value]) => Array.isArray(value) && value.length))
    for (const [key, items] of Object.entries(additions)) {
      assert(items.every((item) => !original.data[key].some((existing) => existing.id === item.id)), `Fixture ID collision in ${key}.`)
    }
    seeded = true
    await ev(`(async () => {
      const { data } = await window.novelDirector.data.load()
      const additions = ${JSON.stringify(additions)}
      for (const [key, items] of Object.entries(additions)) data[key] = [...data[key], ...items]
      await window.novelDirector.data.save(data)
    })()`)
    await reloadInbox()
    await until(`Boolean(document.querySelector('[data-candidate-id="qa-specialty-timeline"]'))`)
    const baseline = (await load()).data
    assert.equal(baseline.memoryUpdateCandidates.filter((item) => item.projectId === SPECIALTY_IDS.project && item.status === 'pending').length, 3)
    assert.equal(baseline.candidateDecisionReceipts.filter((item) => item.projectId === SPECIALTY_IDS.project).length, 0)

    const candidateIds = fixture.memoryUpdateCandidates.map((item) => item.id)
    await showFilter('伏笔', candidateIds)
    await showFilter('角色状态', [])
    await showFilter('时间线', candidateIds)
    await showFilter('全部', candidateIds)
    assert.deepEqual(observed((await load()).data), observed(baseline), 'Filtering changed candidates or canonical facts.')
    await openEvent(client, SPECIALTY_EVIDENCE.slice(0, 28))
    const eventId = await ev(`document.querySelector('[data-candidate-id="qa-specialty-timeline"]')?.closest('.inbox-event')?.dataset.decisionEventId`)
    assert(eventId, 'Missing mixed-specialty event.')
    const eventScope = `[data-decision-event-id="${eventId}"]`
    const partialIds = fixture.memoryUpdateCandidates.filter((item) => item.type === 'foreshadowing').map((item) => item.id)
    for (const id of partialIds) await setChecked(`[data-candidate-id="${id}"] .inbox-selection-toggle input`, true)
    await until(`document.querySelector(${JSON.stringify(`${eventScope} .inbox-selection-count`)})?.textContent === '已选 2 / 3 项'`)
    assert.equal(await ev(`document.querySelector(${JSON.stringify(`${eventScope} details > .inbox-selection-toggle input`)})?.indeterminate`), true)
    if (captureScreenshot) {
      await captureScreenshot(client, 'candidate-undo-partial-selection.png')
      screenshots.push('candidate-undo-partial-selection.png')
    }
    await clickWithin(`${eventScope} .inbox-event-actions`, '接受所选 2 项并写入')
    await until('Boolean(document.querySelector(".confirm-dialog"))')
    assert((await ev('document.querySelector(".confirm-dialog")?.textContent ?? ""')).includes('高风险'))
    await clickWithin('.confirm-dialog', '先返回核对')
    await until('!document.querySelector(".confirm-dialog") && document.querySelector(".decision-inbox-view")?.getAttribute("aria-busy") === "false"')
    assert.deepEqual(observed((await load()).data), observed(baseline), 'Cancelling partial high-risk acceptance wrote facts or a receipt.')
    checks.push('First-screen filters preserve mixed-event members; pointer selection chooses two of three candidates and cancelling high-risk acceptance writes nothing.')

    await clickWithin(`${eventScope} .inbox-event-actions`, '接受所选 2 项并写入')
    await until('Boolean(document.querySelector(".confirm-dialog"))')
    await clickWithin('.confirm-dialog', '确认处理')
    await until(`(async () => { const { data } = await window.novelDirector.data.load(); return ${JSON.stringify(partialIds)}
      .every(id => data.memoryUpdateCandidates.some(item => item.id === id && item.status === 'accepted')) })()`)
    const partialAccepted = (await load()).data
    assert.equal(partialAccepted.candidateDecisionReceipts.length, baseline.candidateDecisionReceipts.length + 1)
    const partialReceipt = partialAccepted.candidateDecisionReceipts.find((item) => !baseline.candidateDecisionReceipts.some((old) => old.id === item.id))
    assert.deepEqual(partialReceipt.decisions.map((item) => item.candidateId).sort(), [...partialIds].sort())
    assert.equal(partialReceipt.requiresConfirmation, true)
    assert.equal(specialtyFact(partialAccepted, 'foreshadowing_create').title, fixture.memoryUpdateCandidates.find((item) => item.proposedPatch.kind === 'foreshadowing_create').proposedPatch.candidate.title)
    assert.equal(specialtyFact(partialAccepted, 'foreshadowing_status_update').status, 'resolved')
    assert.equal(partialAccepted.foreshadowings.length, baseline.foreshadowings.length + 1)
    assert.deepEqual(partialAccepted.timelineEvents, baseline.timelineEvents)
    assert.equal(partialAccepted.memoryUpdateCandidates.find((item) => item.id === 'qa-specialty-timeline').status, 'pending')
    assertOrdinaryUnchanged(baseline, partialAccepted)
    await showFilter('伏笔', [])
    await showFilter('时间线', ['qa-specialty-timeline'])
    await reloadInbox()
    await showFilter('全部', ['qa-specialty-timeline'])
    assert.deepEqual(observed((await load()).data), observed(partialAccepted), 'Partial acceptance did not survive SQLite reload.')
    await showView('处理记录')
    const partialScope = receiptSelector(partialReceipt.id)
    await until(`Boolean(document.querySelector(${JSON.stringify(partialScope)}))`)
    await clickWithin(partialScope, '预览撤销')
    await until(`document.querySelector(${JSON.stringify(`${partialScope} .inbox-undo-preview`)})?.getAttribute('data-undo-status') === 'ready'`)
    const partialUndone = await submitUndo(partialScope, partialReceipt)
    assert.equal(specialtyFact(partialUndone, 'foreshadowing_create'), undefined)
    for (const key of ['status', 'notes', 'treatmentMode', 'actualPayoffChapter']) {
      assert.deepEqual(specialtyFact(partialUndone, 'foreshadowing_status_update')[key], specialtyFact(baseline, 'foreshadowing_status_update')[key])
    }
    assert.deepEqual(partialUndone.timelineEvents, baseline.timelineEvents)
    assertOrdinaryUnchanged(baseline, partialUndone)
    await reloadInbox()
    await showFilter('全部', candidateIds)
    assert.deepEqual(observed((await load()).data), observed(partialUndone), 'Partial undo did not survive SQLite reload.')
    checks.push('Accepting only selected hooks leaves the timeline pending, updates filter results after reload and restores the partial group through explicit inline undo.')

    for (const kind of SPECIALTY_KINDS) {
      const candidate = fixture.memoryUpdateCandidates.find((item) => item.proposedPatch.kind === kind)
      const text = `QA author edit: ${kind}`
      const field = kind === 'foreshadowing_status_update' ? 'notes' : 'title'
      const label = kind === 'foreshadowing_create' ? '标题' : kind === 'foreshadowing_status_update' ? '备注' : '事件标题'
      await showView('待确认')
      await openEvent(client, SPECIALTY_EVIDENCE.slice(0, 28))
      const before = (await load()).data
      await clickCandidateButton(client, candidate.id, '编辑后接受')
      await until('Boolean(document.querySelector(".inbox-amendment-editor"))')
      await editText(label, text)
      await until('Boolean([...document.querySelectorAll(".inbox-amendment-actions button")].some(item => item.textContent?.trim() === "预览后接受" && !item.disabled))')
      assert.deepEqual(observed((await load()).data), observed(before), 'Typing an amendment automatically changed canonical records or candidate status.')
      await clickWithin('.inbox-amendment-actions', '预览后接受')
      await until(`(async () => Boolean(document.querySelector('.confirm-dialog')) ||
        (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some(item => item.id === ${JSON.stringify(candidate.id)} && item.status === 'accepted'))()`)
      if (kind === 'foreshadowing_status_update') assert(await ev('Boolean(document.querySelector(".confirm-dialog"))'), 'Resolved hook acceptance skipped high-risk confirmation.')
      if (await ev('Boolean(document.querySelector(".confirm-dialog"))')) await clickWithin('.confirm-dialog', '确认处理')
      await until(`(async () => (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some(item => item.id === ${JSON.stringify(candidate.id)} && item.status === 'accepted'))()`)
      const accepted = (await load()).data
      const fact = specialtyFact(accepted, kind)
      assert(fact, `${kind} acceptance did not write its canonical fact.`)
      assert.equal(fact[field], kind === 'foreshadowing_status_update' ? `${specialtyFact(before, kind).notes}\n${text}` : text)
      if (kind === 'foreshadowing_status_update') {
        assert.equal(fact.status, 'resolved')
        assert.equal(fact.actualPayoffChapter, 3)
      }
      const receipt = accepted.candidateDecisionReceipts.find((item) => !before.candidateDecisionReceipts.some((old) => old.id === item.id) &&
        item.decisions.some((decision) => decision.candidateId === candidate.id))
      assert(receipt?.effects?.some((item) => item.id === fact.id), 'Acceptance receipt did not capture the specialty fact.')
      assert.equal(accepted.candidateDecisionReceipts.length, before.candidateDecisionReceipts.length + 1)
      assert.equal(receipt.decisions.length, 1)
      const audit = receipt.amendments?.find((item) => item.candidateId === candidate.id)
      assert(audit && JSON.stringify(audit.after).includes(text) && !JSON.stringify(audit.before).includes(text), 'Missing amendment before/after receipt.')
      assertOrdinaryUnchanged(before, accepted)
      assertSpecialtyIsolation(before, accepted, candidate.id, fact.id)
      checks.push(`${kind}: typed amendment remains read-only until UI acceptance writes the edited fact and before/after receipt.`)

      await reloadInbox()
      await showView('处理记录')
      const scope = receiptSelector(receipt.id)
      await until(`Boolean(document.querySelector(${JSON.stringify(scope)}))`)
      assert.deepEqual(observed((await load()).data), observed(accepted), 'Acceptance did not survive renderer reload.')
      await clickWithin(scope, '预览撤销')
      await until(`document.querySelector(${JSON.stringify(`${scope} .inbox-undo-preview`)})?.getAttribute('data-undo-status') === 'ready'`)
      await assertInlineRisk(scope, receipt.requiresConfirmation)
      const previewText = await ev(`document.querySelector(${JSON.stringify(`${scope} .inbox-undo-preview`)})?.textContent ?? ''`)
      assert(previewText.includes(text) && previewText.includes('当时写入') && previewText.includes('当前值') && previewText.includes('撤销后'), 'Undo preview omits the actual edited value or before/current/after columns.')
      assert.deepEqual(observed((await load()).data), observed(accepted), 'Opening undo preview changed storage.')
      if (captureScreenshot) {
        const name = `candidate-undo-${kind}.png`
        await captureScreenshot(client, name)
        screenshots.push(name)
      }
      await clickWithin(`${scope} .inbox-undo-preview`, '取消')
      await until(`!document.querySelector(${JSON.stringify(`${scope} .inbox-undo-preview`)})`)
      assert.deepEqual(observed((await load()).data), observed(accepted), 'Cancelling undo changed storage.')
      checks.push(`${kind}: reload restores history; undo preview shows actual changes and cancel leaves storage untouched.`)

      let laterDescription
      if (kind === 'foreshadowing_status_update') {
        const laterNotes = 'QA later author note entered in the ledger.'
        laterDescription = 'QA later description outside the accepted status fields.'
        await clickWithin('.sidebar .nav-list', '伏笔')
        await until('Boolean(document.querySelector(".foreshadowing-view"))')
        await pointerClick(`[...document.querySelectorAll('.foreshadowing-view tbody tr')].find(item => item.querySelector('td')?.textContent === ${JSON.stringify(fact.title)})`, 'The accepted hook in its ledger')
        await until(`Boolean([...document.querySelectorAll('.foreshadowing-view .field')].some(item =>
          item.querySelector('.field-label')?.textContent === '伏笔标题' && item.querySelector('input')?.value === ${JSON.stringify(fact.title)}))`)
        await editText('注意事项', laterNotes, '.foreshadowing-view .field')
        await until(`(async () => (await window.novelDirector.data.load()).data.foreshadowings
          .some(item => item.id === ${JSON.stringify(fact.id)} && item.notes === ${JSON.stringify(laterNotes)}))()`)
        await editText('伏笔描述', laterDescription, '.foreshadowing-view .field')
        await until(`(async () => (await window.novelDirector.data.load()).data.foreshadowings
          .some(item => item.id === ${JSON.stringify(fact.id)} && item.description === ${JSON.stringify(laterDescription)} && item.notes === ${JSON.stringify(laterNotes)}))()`)
        const changed = (await load()).data
        assert.deepEqual(changed.candidateDecisionReceipts, accepted.candidateDecisionReceipts, 'Manual ledger editing created a candidate receipt.')
        assert.deepEqual(changed.memoryUpdateCandidates, accepted.memoryUpdateCandidates, 'Manual ledger editing changed candidate status.')
        assertOrdinaryUnchanged(accepted, changed)
        assertSpecialtyIsolation(accepted, changed, candidate.id, fact.id)
        await reloadInbox()
        await showView('处理记录')
        assert.deepEqual(observed((await load()).data), observed(changed), 'The UI-entered ledger conflict did not survive reload.')
      }
      const beforeUndo = (await load()).data
      await clickWithin(scope, '预览撤销')
      await until(`document.querySelector(${JSON.stringify(`${scope} .inbox-undo-preview`)})?.getAttribute('data-undo-status') === ${JSON.stringify(laterDescription ? 'conflict' : 'ready')}`)
      if (laterDescription) {
        const consent = `${scope} .inbox-restore-consent input[type="checkbox"]`
        assert.equal(await ev(`document.querySelector(${JSON.stringify(`${scope} [data-undo-field="treatmentMode"] > strong`)})?.textContent`), '本章处理方式')
        assert.equal(await ev(`document.querySelector(${JSON.stringify(`${scope} [data-undo-field="actualPayoffChapter"] > strong`)})?.textContent`), '实际回收章')
        await assertInlineRisk(scope, true)
        await assertUndoEnabled(scope, false)
        assert.equal(await ev(`document.querySelector(${JSON.stringify(consent)})?.checked`), false)
        const conflictText = await ev(`document.querySelector(${JSON.stringify(`${scope} [data-undo-field="notes"].conflicted`)})?.textContent ?? ''`)
        assert(conflictText.includes(specialtyFact(beforeUndo, kind).notes) && conflictText.includes(specialtyFact(before, kind).notes), 'Conflict preview is missing the actual current and restored notes.')
        await clickWithin(`${scope} .inbox-undo-preview`, '取消')
        await until(`!document.querySelector(${JSON.stringify(`${scope} .inbox-undo-preview`)})`)
        assert.deepEqual(observed((await load()).data), observed(beforeUndo), 'Cancelling conflict undo changed storage.')
        await clickWithin(scope, '预览撤销')
        await until(`document.querySelector(${JSON.stringify(`${scope} .inbox-undo-preview`)})?.getAttribute('data-undo-status') === 'conflict'`)
        await setChecked(consent, true)
        await assertUndoEnabled(scope, true)
        await setChecked(consent, false)
        await assertUndoEnabled(scope, false)
        await setChecked(consent, true)
        assert.deepEqual(observed((await load()).data), observed(beforeUndo), 'Conflict consent alone restored fields before submission.')
        if (captureScreenshot) {
          await captureScreenshot(client, 'candidate-undo-conflict-consent.png')
          screenshots.push('candidate-undo-conflict-consent.png')
        }
      }
      await submitUndo(scope, receipt)
      await until(`(async () => { const { data } = await window.novelDirector.data.load(); return Boolean(
        data.candidateDecisionReceipts.some(item => item.operation === 'undo' && item.undoesReceiptId === ${JSON.stringify(receipt.id)}) &&
        data.memoryUpdateCandidates.some(item => item.id === ${JSON.stringify(candidate.id)} && item.status === 'pending')) })()`)
      const undone = (await load()).data
      const restored = specialtyFact(undone, kind)
      if (kind === 'foreshadowing_status_update') {
        for (const key of ['status', 'notes', 'treatmentMode', 'actualPayoffChapter']) assert.deepEqual(restored[key], specialtyFact(before, kind)[key], key)
        assert.equal(restored.description, laterDescription, 'Undo overwrote an unrelated later description.')
      } else assert.equal(restored, undefined, 'Undo left a created specialty fact active.')
      assert.deepEqual(undone.memoryUpdateCandidates.find((item) => item.id === candidate.id).proposedPatch, candidate.proposedPatch)
      assert.deepEqual(undone.candidateDecisionReceipts.find((item) => item.id === receipt.id), receipt)
      assert.equal(undone.candidateDecisionReceipts.filter((item) => item.undoesReceiptId === receipt.id).length, 1)
      assert.equal(undone.candidateDecisionReceipts.length, accepted.candidateDecisionReceipts.length + 1)
      assertOrdinaryUnchanged(before, undone)
      assertSpecialtyIsolation(before, undone, candidate.id, fact.id)
      await reloadInbox()
      await until(`Boolean(document.querySelector('[data-candidate-id="${candidate.id}"]'))`)
      assert.deepEqual(observed((await load()).data), observed(undone), 'Undo facts/history did not survive reload.')
      await showView('处理记录')
      await until(`Boolean([...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].some(item => item.textContent?.trim() === '预览撤销' && item.disabled))`)
      checks.push(`${kind}: explicit UI undo restores the pending proposal/canonical facts, keeps both receipts after reload and disables duplicate undo.`)
      if (laterDescription) checks.push('A ledger edit entered through UI survives reload and causes an undo conflict; cancel/unchecked consent writes nothing, explicit checked restore reverts only affected fields with high-risk receipt metadata.')
    }
  } catch (error) {
    failure = error
  } finally {
    if (seeded) try {
      await ev(`window.novelDirector.data.save(${JSON.stringify(original.data)})`)
      await client.send('Page.reload', { ignoreCache: true })
      await until('Boolean(window.novelDirector?.data?.load && document.querySelector(".project-list-panel"))')
    } catch (error) { cleanupFailure = error }
  }
  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'Specialty UI QA and cleanup failed.')
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  return { checks, screenshots, setup: 'Synthetic pending candidates seeded through IPC; fixture setup is not a UI journey.',
    scope: 'Existing production/packaged renderer -> preload -> main -> isolated SQLite; no AI calls.' }
}
