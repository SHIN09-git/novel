import assert from 'node:assert/strict'
import { evaluate, click, button, ready } from './long-novel-ui-driver.mjs'

const j = JSON.stringify
const tab = id => `document.getElementById('character-tab-${id}')`
const characterButton = name => `([...document.querySelectorAll('.character-list-results button')].find(e=>e.querySelector('strong')?.textContent===${j(name)}))`
const factValue = `([...document.querySelectorAll('#character-panel-ledger .character-add-fact .field')].find(e=>e.querySelector('.field-label')?.textContent==='状态值').querySelector('input'))`
const logNote = `document.querySelector('input[aria-label="状态变化内容"]')`

async function typeText(client, element, text) {
  await click(client, element)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.insertText', { text })
  await ready(client, `(${element}).value === ${j(text)}`)
}

async function clearText(client, element) {
  await click(client, element)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await ready(client, `(${element}).value === ''`)
}

async function selectCharacter(client, name) {
  await click(client, characterButton(name))
  await ready(client, `document.querySelector('.character-focus-card')?.textContent.includes(${j(name)})`)
}

async function openFactForm(client) {
  if (!(await evaluate(client, `document.querySelector('.character-add-fact')?.open`))) {
    await click(client, `document.querySelector('.character-add-fact > summary')`)
  }
  await ready(client, 'document.querySelector(".character-add-fact[open]")')
}

async function assertFormFeedback(client, panel, expected) {
  const feedback = await evaluate(client, `(() => {
    const panel = document.querySelector(${j(panel)})
    const status = [...(panel?.querySelectorAll('.character-form-status[role="status"]') || [])]
      .find(item => item.textContent?.trim() === ${j(expected)})
    const rect = (element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
    }
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const statusRect = status ? rect(status) : null
    const panelRect = panel ? rect(panel) : null
    const controls = status && panel ? [...panel.querySelectorAll('input, select, button')]
      .filter(item => !item.disabled).map(item => ({ tag: item.tagName, text: item.textContent?.trim(), rect: rect(item) })) : []
    return {
      text: status?.textContent?.trim() || '',
      visible: Boolean(status && statusRect?.width > 0 && statusRect?.height > 0 && !status.hidden && getComputedStyle(status).visibility !== 'hidden'),
      inViewport: Boolean(statusRect && statusRect.top >= 0 && statusRect.bottom <= innerHeight),
      withinPanel: Boolean(statusRect && panelRect && statusRect.left >= panelRect.left - 1 && statusRect.right <= panelRect.right + 1 && statusRect.top >= panelRect.top - 1 && statusRect.bottom <= panelRect.bottom + 1),
      overlaps: statusRect ? controls.filter(item => overlaps(statusRect, item.rect)) : []
    }
  })()`)
  assert.equal(feedback.text, expected, `Missing save feedback: ${expected}`)
  assert(feedback.visible, `Save feedback is not visible: ${expected}`)
  assert(feedback.inViewport, `Save feedback is outside the viewport: ${expected}`)
  assert(feedback.withinPanel, `Save feedback escapes its panel: ${expected}`)
  assert.deepEqual(feedback.overlaps, [], `Save feedback obscures a control: ${j(feedback.overlaps)}`)
}

export async function exerciseCharacterWorkspace(client, { theme, take, result, verifyDraftIsolation = true }) {
  await ready(client, `Boolean(${tab('profile')})`)
  const search = `document.querySelector('input[aria-label="搜索角色"]')`
  await typeText(client, search, '没有这个角色')
  assert.equal(await evaluate(client, `document.querySelectorAll('.character-list-results button').length`), 0)
  assert(await evaluate(client, `document.querySelector('.character-focus-card').textContent.includes('林默')`), 'Filtering must not change the current character')
  await click(client, `document.querySelector('button[aria-label="清空角色搜索"]')`)
  assert(await evaluate(client, `document.querySelector('.character-list-results button[aria-pressed="true"]') !== null`))
  await click(client, tab('profile'))
  for (const [key, code, expected] of [['End', 35, 'logs'], ['ArrowLeft', 37, 'ledger'], ['Home', 36, 'profile']]) {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    await ready(client, `document.activeElement.id === 'character-tab-${expected}'`)
    assert.equal(await evaluate(client, `document.querySelectorAll('.characters-workbench [role="tabpanel"]:not([hidden])').length`), 1)
  }
  await click(client, tab('ledger'))
  assert(await evaluate(client, `[...document.querySelectorAll('.state-fact-card')].some(e=>e.textContent.includes('右手指节伤'))`))
  await take(`${theme}-character-ledger`)
  if (verifyDraftIsolation) {
    await openFactForm(client)
    await typeText(client, factValue, '5000')
    await selectCharacter(client, '顾遥')
    assert.equal(await evaluate(client, `(${factValue}).value`), '', 'A draft fact must not appear in another character')
    assert.equal(await evaluate(client, 'document.querySelector(".character-add-fact")?.open'), true, 'Fact form must stay expanded after switching characters')
    await typeText(client, factValue, '800')
    await selectCharacter(client, '林默')
    assert.equal(await evaluate(client, `(${factValue}).value`), '5000', '林默 fact draft must survive a character switch')
    assert.equal(await evaluate(client, 'document.querySelector(".character-add-fact")?.open'), true, 'Fact form must stay expanded when returning to 林默')
    await selectCharacter(client, '顾遥')
    assert.equal(await evaluate(client, `(${factValue}).value`), '800', '顾遥 fact draft must remain isolated')

    await selectCharacter(client, '林默')
    await click(client, button('新增状态事实', 'document.querySelector("#character-panel-ledger")'))
    await ready(client, `document.querySelector('#character-panel-ledger .character-form-status[role="status"]')?.textContent.trim() === '状态已写入账本。'`)
    await evaluate(client, 'document.querySelector("#character-panel-ledger .character-form-status[role=\\"status\\"]")?.scrollIntoView({block:"nearest", behavior:"instant"})')
    await evaluate(client, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await assertFormFeedback(client, '#character-panel-ledger', '状态已写入账本。')
    await take(`${theme}-character-new-fact`, { preserveScroll: true })
    const savedFact = await evaluate(client, `window.novelDirector.data.load().then(r=>r.data.characterStateFacts.find(f=>f.characterId==='qa-lin' && String(f.value)==='5000' && f.status==='active'))`)
    assert.deepEqual({ characterId: savedFact?.characterId, value: savedFact?.value }, { characterId: 'qa-lin', value: 5000 }, 'Saved fact must belong to 林默 and retain value 5000')

    await click(client, tab('logs'))
    const noteA = `隔离 HIG ${theme} 林默日志`
    const noteB = `隔离 HIG ${theme} 顾遥日志`
    await typeText(client, logNote, noteA)
    await selectCharacter(client, '顾遥')
    assert.equal(await evaluate(client, `(${logNote}).value`), '', 'A log draft must not appear in another character')
    await typeText(client, logNote, noteB)
    await selectCharacter(client, '林默')
    assert.equal(await evaluate(client, `(${logNote}).value`), noteA, '林默 log draft must survive a character switch')
    await selectCharacter(client, '顾遥')
    assert.equal(await evaluate(client, `(${logNote}).value`), noteB, '顾遥 log draft must remain isolated')
    const factsBefore = await evaluate(client, `window.novelDirector.data.load().then(r=>r.data.characterStateFacts.length)`)
    await click(client, button('记录', 'document.getElementById("character-panel-logs")'))
    await ready(client, `(${logNote}).value === '' && document.querySelector('#character-panel-logs .character-form-status[role="status"]')?.textContent.trim() === '日志已保存。'`)
    await evaluate(client, 'document.querySelector("#character-panel-logs .character-form-status[role=\\"status\\"]")?.scrollIntoView({block:"nearest", behavior:"instant"})')
    await evaluate(client, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await assertFormFeedback(client, '#character-panel-logs', '日志已保存。')
    const stored = await evaluate(client, `window.novelDirector.data.load().then(r=>({
      log:r.data.characterStateLogs.find(l=>l.characterId==='qa-b' && l.note===${j(noteB)}),
      facts:r.data.characterStateFacts.length
    }))`)
    assert.equal(stored.log?.characterId, 'qa-b', 'Log-only save must persist under 顾遥')
    assert.equal(stored.log?.note, noteB, 'Log-only save must retain its note')
    assert.equal(stored.facts, factsBefore, 'Log-only save must not create ledger facts')
    await take(`${theme}-character-logs`, { preserveScroll: true })

    await selectCharacter(client, '林默')
    await click(client, tab('logs'))
    assert.equal(await evaluate(client, `(${logNote}).value`), noteA, 'Unsaved 林默 log must remain after another character saves')
    await clearText(client, logNote)
    await selectCharacter(client, '顾遥')
    await click(client, tab('ledger'))
    await openFactForm(client)
    await clearText(client, factValue)
    await selectCharacter(client, '林默')
    result.checks.push(`${theme}: real A/B fact drafts (5000/800) and log drafts isolated across character switches; fact form remained expanded; saved fact verified by window.novelDirector.data.load() as qa-lin=5000; default log_only persisted qa-b log without changing fact count; status feedback was visible and unobstructed.`)
  }
  for (const width of [1440, 1024, 800]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const id of ['profile', 'ledger', 'logs']) {
      await click(client, tab(id))
      await evaluate(client, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert(await evaluate(client, `document.documentElement.scrollWidth <= innerWidth + 1`), `${theme} ${id} ${width} overflow`)
      assert(await evaluate(client, `(() => { const p=document.getElementById('character-panel-${id}'); return p.scrollWidth <= p.clientWidth + 1; })()`), `${id} content overflow`)
    }
    if (width === 800) await take(`${theme}-character-800`)
  }
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false })
  await selectCharacter(client, '林默')
  await click(client, tab('profile'))
  result.checks.push(`${theme}: character search, real keyboard tabs, retained three-panel workflow and three panels at 1440/1024/800px; final selection 林默.`)
}
