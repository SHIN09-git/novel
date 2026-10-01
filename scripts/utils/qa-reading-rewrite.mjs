import { createServer } from 'node:http'
import { setTimeout as wait } from 'node:timers/promises'

const DEFAULT_SELECTORS = Object.freeze({
  reader: '.reading-view',
  scroll: '.reader-continuous-scroll',
  chapter: '[data-reader-chapter-id]',
  chapterBody: '.reader-chapter-body',
  chapterRailButton: '.reader-chapter-rail button',
  resultPanel: '[data-testid="ai-rewrite-result-panel"]',
  resultText: 'textarea.ai-rewrite-result-text',
  quickRewriteSaveStatus: '[data-testid="quick-rewrite-save-status"]'
})

const DEFAULT_BUTTONS = Object.freeze({
  enter: '进入',
  openChapters: '章节',
  openReader: '连贯阅读',
  backToChapters: '回到章节编辑',
  rewriteAction: '空白重写',
  applyToSelection: '应用到选区',
  adoptWhole: '作为整章采用',
  confirmWhole: '确认采用整章',
  saveCandidate: '暂存候选',
  copyCandidate: '复制候选',
  discardCandidate: '放弃候选',
  useCurrentSelection: '使用当前选区',
  editChapter: '编辑本章',
  saveChapter: '保存本章'
})

export const READING_REWRITE_SELECTORS = DEFAULT_SELECTORS
export const READING_REWRITE_BUTTONS = DEFAULT_BUTTONS

export const READING_REWRITE_FIXTURE = Object.freeze({
  projectId: 'qa-project',
  chapterIds: Object.freeze(['qa-reading-1', 'qa-reading-2', 'qa-reading-3']),
  previousChapterId: 'qa-reading-2',
  targetChapterId: 'qa-reading-3',
  targetChapterOrder: 3,
  targetText: '中段唯一选区：林默把银钥匙压在掌心。',
  localText: '中段局部候选：林默把银钥匙藏进袖口。',
  otherTargetText: '前一章独立选区：门后的风声忽然停了。',
  otherCandidateText: '另一章节候选：门后的风声变得更近。',
  externalPrefix: '前文长度变化后新增的外部锚点。\n\n'
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function closeServer(server) {
  server.closeAllConnections?.()
  if (!server.listening) return
  await new Promise((resolve) => server.close(resolve))
}

function revisionPayload(revisedText) {
  return JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          revisedText,
          changedSummary: '本地阅读重写 QA stub 返回候选。',
          risks: '',
          preservedFacts: '保留章节外部正文。'
        })
      }
    }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
  })
}

async function startRewriteStub({ localText, wholeText, staleLocalText }) {
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'POST' || url.pathname !== '/chat/completions') {
      response.writeHead(404).end()
      return
    }

    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.once('end', () => {
      let body = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        response.writeHead(400).end()
        return
      }
      requests.push(body)
      const responseText = requests.length === 1
        ? localText
        : requests.length <= 3
          ? wholeText
          : staleLocalText
      const payload = revisionPayload(responseText)
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        connection: 'close'
      })
      response.end(payload)
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object' && address.address === '127.0.0.1', 'Reading rewrite stub did not bind to loopback.')
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    requestCount: () => requests.length
  }
}

async function startPersistenceRewriteStub(responses) {
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'POST' || url.pathname !== '/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.once('end', () => {
      try { requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { response.writeHead(400).end(); return }
      const responseText = responses[Math.min(requests.length - 1, responses.length - 1)]
      const payload = revisionPayload(responseText)
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        connection: 'close'
      })
      response.end(payload)
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object' && address.address === '127.0.0.1', 'Quick rewrite persistence stub did not bind to loopback.')
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests.length
  }
}

function fixtureChapter(id, order, title, body, timestamp) {
  return {
    id,
    projectId: READING_REWRITE_FIXTURE.projectId,
    order,
    title,
    body,
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeFixture(timestamp = '2026-09-06T00:00:00.000Z') {
  const beforeParagraphs = [
    '前章开头锚点。',
    ...Array.from({ length: 14 }, (_, index) => `前章第 ${index + 2} 段，作为前文长度基线。`),
    '前章结尾锚点。'
  ]
  const targetParagraphs = [
    '目标章开头锚点。',
    ...Array.from({ length: 7 }, (_, index) => `目标章上半段第 ${index + 2} 段。`),
    READING_REWRITE_FIXTURE.targetText,
    ...Array.from({ length: 7 }, (_, index) => `目标章下半段第 ${index + 10} 段。`),
    '目标章结尾锚点。'
  ]
  const previousParagraphs = beforeParagraphs.map((paragraph, index) => `前一章第 ${index + 1} 段：${paragraph}`)
  previousParagraphs[6] = READING_REWRITE_FIXTURE.otherTargetText
  return [
    fixtureChapter(
      READING_REWRITE_FIXTURE.chapterIds[0],
      1,
      '阅读 QA 前章',
      beforeParagraphs.join('\n\n'),
      timestamp
    ),
    fixtureChapter(
      READING_REWRITE_FIXTURE.chapterIds[1],
      2,
      '阅读 QA 前一章',
      previousParagraphs.join('\n\n'),
      timestamp
    ),
    fixtureChapter(
      READING_REWRITE_FIXTURE.chapterIds[2],
      3,
      '阅读 QA 中章',
      targetParagraphs.join('\n\n'),
      timestamp
    ),
  ]
}

function mergedButtons(buttons) {
  return { ...DEFAULT_BUTTONS, ...buttons }
}

function mergedSelectors(selectors) {
  return { ...DEFAULT_SELECTORS, ...selectors }
}

async function clickConfigured({ clickButton, buttons }, name) {
  const label = buttons[name]
  assert(typeof label === 'string' && label.length > 0, `Missing reading rewrite button label: ${name}`)
  await clickButton(label)
}

async function waitForReader({ evaluate, waitFor }, selectors) {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selectors.reader)}))`, 30_000)
}

async function reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons, preservePosition = false) {
  await client.send('Page.reload', { ignoreCache: true })
  await waitFor(`Boolean(window.novelDirector?.data?.load && [...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === ${JSON.stringify(buttons.enter)}))`, 30_000)
  await clickButton(buttons.enter)
  await waitFor(`Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`, 30_000)
  await clickButton(buttons.openChapters)
  await waitFor(`Boolean(document.querySelector('.chapters-view') && !document.querySelector('.view-loading'))`, 30_000)
  await clickConfigured({ clickButton, buttons }, 'openReader')
  await waitForReader({ evaluate, waitFor }, selectors)
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selectors.chapter)}))`, 30_000)
  if (preservePosition) await settleReaderScroll(evaluate, selectors)
  else await selectReaderChapter({ evaluate, waitFor }, selectors, READING_REWRITE_FIXTURE.targetChapterOrder)
}

async function selectReaderText({ evaluate }, selectors, chapterId, selectedText) {
  const result = await evaluate(`(() => {
    const article = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"]`)})
    const body = article?.querySelector(${JSON.stringify(selectors.chapterBody)})
    if (!body) return { ok: false, reason: 'chapter-body-missing' }
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const value = node.textContent ?? ''
      const start = value.indexOf(${JSON.stringify(selectedText)})
      if (start >= 0) {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + ${JSON.stringify(selectedText)}.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 180 }))
        return { ok: true, selected: selection?.toString() ?? '' }
      }
      node = walker.nextNode()
    }
    return { ok: false, reason: 'selection-not-found' }
  })()`)
  assert(result?.ok && result.selected === selectedText, `Could not select the expected reading text: ${JSON.stringify(result)}`)
}

async function positionReaderParagraph({ evaluate }, selectors, chapterId, paragraphText) {
  const positioned = await evaluate(`(async () => {
    const scroll = document.querySelector(${JSON.stringify(selectors.scroll)})
    const article = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"]`)})
    const paragraph = [...(article?.querySelectorAll('p') ?? [])].find((item) => item.textContent === ${JSON.stringify(paragraphText)})
    if (!scroll || !article || !paragraph) return null
    const scrollRect = scroll.getBoundingClientRect()
    const paragraphRect = paragraph.getBoundingClientRect()
    const desiredOffset = scroll.clientHeight * 0.25
    scroll.scrollTo({ top: scroll.scrollTop + paragraphRect.top - scrollRect.top - desiredOffset, behavior: 'auto' })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const nextRect = paragraph.getBoundingClientRect()
    const nextScrollRect = scroll.getBoundingClientRect()
    return {
      viewportOffset: nextRect.top - nextScrollRect.top,
      desiredOffset: scroll.clientHeight * 0.25,
      scrollTop: scroll.scrollTop,
      paragraphTop: nextRect.top,
      containerTop: nextScrollRect.top,
      containerHeight: scroll.clientHeight
    }
  })()`)
  assert(positioned && positioned.containerHeight > 0, `Could not position reading paragraph: ${paragraphText}`)
  assert(Math.abs(positioned.viewportOffset - positioned.desiredOffset) <= 24, `Reading paragraph was not positioned near the viewport quarter: ${JSON.stringify(positioned)}`)
  return positioned
}

async function measureReaderParagraph({ evaluate }, selectors, chapterId, paragraphText) {
  const measured = await evaluate(`(() => {
    const scroll = document.querySelector(${JSON.stringify(selectors.scroll)})
    const article = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"]`)})
    const paragraph = [...(article?.querySelectorAll('p') ?? [])].find((item) => item.textContent === ${JSON.stringify(paragraphText)})
    if (!scroll || !paragraph) return null
    const scrollRect = scroll.getBoundingClientRect()
    const paragraphRect = paragraph.getBoundingClientRect()
    return {
      viewportOffset: paragraphRect.top - scrollRect.top,
      desiredOffset: scroll.clientHeight * 0.25,
      scrollTop: scroll.scrollTop,
      containerHeight: scroll.clientHeight
    }
  })()`)
  assert(measured && measured.containerHeight > 0, `Could not measure reading paragraph: ${paragraphText}`)
  return measured
}

function assertReaderParagraphNear(actual, expected, label) {
  assert(
    Math.abs(actual.viewportOffset - expected.viewportOffset) <= 32,
    `${label} moved the target paragraph too far: before=${expected.viewportOffset}, after=${actual.viewportOffset}`
  )
}

async function readState(evaluate, ids = READING_REWRITE_FIXTURE.chapterIds) {
  return evaluate(`(async () => {
    const loaded = await window.novelDirector.data.load()
    const ids = ${JSON.stringify(ids)}
    const chapters = loaded.data.chapters.filter((item) => ids.includes(item.id))
    return {
      chapters: Object.fromEntries(chapters.map((item) => [item.id, { body: item.body, updatedAt: item.updatedAt }])),
      chapterVersionCount: loaded.data.chapterVersions.filter((item) => ids.includes(item.chapterId)).length,
      revisionCommitCount: loaded.data.revisionCommitBundles.filter((item) => ids.includes(item.chapterId)).length,
      revisionVersionCount: loaded.data.revisionVersions.filter((item) => ids.includes(item.requestId) || ids.includes(item.id)).length
    }
  })()`)
}

function bodyOf(state, chapterId) {
  return state?.chapters?.[chapterId]?.body ?? null
}

async function waitForStoredBody({ evaluate, waitFor }, chapterId, expectedBody) {
  await waitFor(`(async () => (await window.novelDirector.data.load()).data.chapters.some((item) => item.id === ${JSON.stringify(chapterId)} && item.body === ${JSON.stringify(expectedBody)}))()`, 30_000)
}

async function waitForCandidate({ waitFor }, selectors) {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selectors.resultPanel)}) && document.querySelector(${JSON.stringify(selectors.resultText)}))`, 30_000)
}

async function waitForQuickRewriteSaved({ waitFor }, selectors) {
  await waitFor(`document.querySelector(${JSON.stringify(selectors.quickRewriteSaveStatus)})?.textContent?.includes('候选已暂存') === true`, 30_000)
}

async function candidateValue(evaluate, selectors) {
  return evaluate(`document.querySelector(${JSON.stringify(selectors.resultText)})?.value ?? null`)
}

async function editCandidateText({ client, evaluate, waitFor }, selectors, value) {
  const focused = await evaluate(`(() => {
    const textarea = document.querySelector(${JSON.stringify(selectors.resultText)})
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return false
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.activeElement === textarea
  })()`)
  assert(focused, 'Could not focus the persisted rewrite candidate textarea.')
  await client.send('Input.insertText', { text: value })
  await waitFor(`document.querySelector(${JSON.stringify(selectors.resultText)})?.value === ${JSON.stringify(value)}`, 10_000)
}

async function selectReaderChapter({ evaluate, waitFor }, selectors, order) {
  await waitFor(`Boolean([...document.querySelectorAll(${JSON.stringify(selectors.chapterRailButton)})].some((item) => item.title?.includes(${JSON.stringify(`第 ${order} 章`)})))`, 10_000)
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selectors.chapterRailButton)})]
      .find((item) => item.title?.includes(${JSON.stringify(`第 ${order} 章`)}))
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not select reader chapter ${order}.`)
  await waitFor(`Boolean([...document.querySelectorAll(${JSON.stringify(selectors.chapterRailButton)})].some((item) => item.title?.includes(${JSON.stringify(`第 ${order} 章`)}) && item.getAttribute('aria-current') === 'true'))`, 10_000)
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${READING_REWRITE_FIXTURE.chapterIds[order - 1]}"]`)}))`, 10_000)
  await settleReaderScroll(evaluate, selectors)
  const jump = await evaluate(`(() => {
    const scroll = document.querySelector(${JSON.stringify(selectors.scroll)});
    const article = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${READING_REWRITE_FIXTURE.chapterIds[order - 1]}"]`)});
    if (!scroll || !article) return null;
    const top = article.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    return { actual: scroll.scrollTop, expected: Math.max(0, Math.min(top, scroll.scrollHeight - scroll.clientHeight)) };
  })()`)
  assert(jump && Math.abs(jump.actual - jump.expected) <= 2, `Chapter directory jump missed its container-relative heading: ${JSON.stringify(jump)}`)
}

async function settleReaderScroll(evaluate, selectors) {
  await evaluate(`(async () => {
    const scroll = document.querySelector(${JSON.stringify(selectors.scroll)});
    if (!scroll) throw new Error('Missing reader scroll container');
    let previous = scroll.scrollTop, stableFrames = 0;
    const samples = [];
    for (let frame = 0; frame < 600; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      stableFrames = Math.abs(scroll.scrollTop - previous) < 0.5 ? stableFrames + 1 : 0;
      previous = scroll.scrollTop;
      samples.push([scroll.scrollTop, scroll.clientHeight, scroll.scrollHeight]);
      if (stableFrames >= 6) return;
    }
    throw new Error('Reader scroll did not settle: ' + JSON.stringify({ samples: samples.slice(-12),
      active: document.querySelector('.reader-chapter-rail [aria-current]')?.title,
      articles: [...scroll.querySelectorAll('[data-reader-chapter-id]')].map(article => ({
        id: article.dataset.readerChapterId, offsetTop: article.offsetTop,
        relativeTop: article.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop,
        parent: article.offsetParent?.className })) }));
  })()`)
}

async function readQuickRewriteDrafts(evaluate, projectId = READING_REWRITE_FIXTURE.projectId) {
  return evaluate(`(async () => {
    const loaded = await window.novelDirector.data.load()
    const drafts = loaded.data.quickRewriteDrafts
    if (!Array.isArray(drafts)) return { exists: false, drafts: [] }
    return {
      exists: true,
      drafts: drafts.filter((item) => item?.projectId === ${JSON.stringify(projectId)}).map((item) => ({
        id: item?.id ?? null,
        chapterId: item?.chapterId ?? null,
        targetKind: item?.targetKind ?? null,
        text: item?.text ?? null,
        raw: item
      }))
    }
  })()`)
}

async function waitForQuickRewriteDraft(evaluate, waitFor, chapterId, expectedText) {
  await waitFor(`(async () => {
    const loaded = await window.novelDirector.data.load()
    const drafts = loaded.data.quickRewriteDrafts
    if (!Array.isArray(drafts)) return false
    return drafts.some((item) => item?.projectId === ${JSON.stringify(READING_REWRITE_FIXTURE.projectId)} && item?.targetKind === 'chapter' && item?.chapterId === ${JSON.stringify(chapterId)} && item?.text === ${JSON.stringify(expectedText)})
  })()`, 30_000)
}

async function waitForNoQuickRewriteDraft(evaluate, waitFor, chapterId) {
  await waitFor(`(async () => {
    const loaded = await window.novelDirector.data.load()
    const drafts = loaded.data.quickRewriteDrafts
    if (!Array.isArray(drafts)) return false
    return !drafts.some((item) => item?.projectId === ${JSON.stringify(READING_REWRITE_FIXTURE.projectId)} && item?.targetKind === 'chapter' && item?.chapterId === ${JSON.stringify(chapterId)})
  })()`, 30_000)
}

async function assertCandidateButtonDisabled(evaluate, selectors, label) {
  const state = await evaluate(`(() => {
    const panel = document.querySelector(${JSON.stringify(selectors.resultPanel)})
    const button = [...(panel?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === ${JSON.stringify(label)})
    return button ? { found: true, disabled: button.disabled } : { found: false, disabled: false }
  })()`)
  assert(state?.found, `Could not find candidate action button: ${label}`)
  assert(state.disabled, `Expected candidate action button to be disabled: ${label}`)
}

async function assertCandidateReadOnlyState({ evaluate }, selectors, originalComparisonText, originalBody, beforeState, chapterId) {
  const current = await readState(evaluate, [chapterId])
  assert(bodyOf(current, chapterId) === originalBody, 'A rewrite candidate changed persisted chapter text before an explicit apply action.')
  assert(current.chapterVersionCount === beforeState.chapterVersionCount, 'A rewrite candidate created a chapter version before an explicit apply action.')
  assert(current.revisionCommitCount === beforeState.revisionCommitCount, 'A rewrite candidate created a revision commit before an explicit apply action.')
  const detailsText = await evaluate(`document.querySelector(${JSON.stringify(selectors.resultPanel)})?.querySelector('details')?.textContent ?? ''`)
  assert(detailsText.includes(originalComparisonText), 'The candidate details do not retain the expected original comparison text.')
}

async function readClipboard(evaluate) {
  return evaluate(`(async () => {
    try { return await navigator.clipboard?.readText?.() ?? null } catch { return null }
  })()`)
}

async function editCurrentChapterThroughReader({ client, evaluate, waitFor, clickButton }, chapterId, nextBody, selectors, buttons) {
  const clicked = await evaluate(`(() => {
    const article = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"]`)})
    const button = [...(article?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === ${JSON.stringify(buttons.editChapter)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, 'Could not enter the reader inline editor for stale-candidate QA.')
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"] .reader-editor-textarea`)}))`, 10_000)
  const prepared = await evaluate(`(() => {
    const textarea = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"] .reader-editor-textarea`)})
    if (!(textarea instanceof HTMLTextAreaElement)) return false
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.activeElement === textarea
  })()`)
  assert(prepared, 'Could not focus the reader inline editor for stale-candidate QA.')
  await client.send('Input.insertText', { text: nextBody })
  await waitFor(`document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"] .reader-editor-textarea`)})?.value === ${JSON.stringify(nextBody)}`, 10_000)
  const saved = await evaluate(`(() => {
    const article = document.querySelector(${JSON.stringify(`${selectors.chapter}[data-reader-chapter-id="${chapterId}"]`)})
    const button = [...(article?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === ${JSON.stringify(buttons.saveChapter)} && !item.disabled)
    if (!button) return false
    button.click()
    return true
  })()`)
  assert(saved, 'Could not save the source change used for stale-candidate QA.')
  await waitForStoredBody({ evaluate, waitFor }, chapterId, nextBody)
}

async function performWholeConfirmation({ clickButton, buttons }) {
  await clickButton(buttons.confirmWhole)
}

export async function runReadingRewriteQA({
  client,
  evaluate,
  waitFor,
  clickButton,
  captureScreenshot,
  buttons: buttonOverrides = {},
  selectors: selectorOverrides = {},
  actions = {},
  screenshots = {}
}) {
  for (const [name, value] of Object.entries({ client, evaluate, waitFor, clickButton })) {
    assert(value && (name === 'client' || typeof value === 'function'), `Missing reading rewrite QA dependency: ${name}`)
  }

  const buttons = mergedButtons(buttonOverrides)
  const selectors = mergedSelectors(selectorOverrides)
  const invoke = async (name, context = {}) => {
    if (typeof actions[name] === 'function') return actions[name]({ client, evaluate, waitFor, clickButton, selectors, buttons, ...context })
    return clickConfigured({ clickButton, buttons }, name)
  }
  const fixture = makeFixture()
  const checks = []
  const originalData = await evaluate(`(async () => (await window.novelDirector.data.load()).data)()`)
  let stub
  let result
  let failure
  let cleanupFailure

  try {
    await waitFor('Boolean(window.innerWidth >= 1024)', 10_000)
    const projectExists = await evaluate(`(async () => (await window.novelDirector.data.load()).data.projects.some((item) => item.id === ${JSON.stringify(READING_REWRITE_FIXTURE.projectId)}))()`)
    assert(projectExists, `Reading rewrite fixture requires project ${READING_REWRITE_FIXTURE.projectId} in the isolated fixture.`)
    const initialChapter = fixture.find((item) => item.id === READING_REWRITE_FIXTURE.targetChapterId)
    assert(initialChapter, 'Reading rewrite fixture is missing its target chapter.')
    const afterLocalBody = initialChapter.body.replace(READING_REWRITE_FIXTURE.targetText, READING_REWRITE_FIXTURE.localText)
    const wholeCandidate = `${afterLocalBody}\n\n整章候选尾部，等待明确采用。`
    const staleLocalText = '过期候选不应自动写入。'
    stub = await startRewriteStub({
      localText: READING_REWRITE_FIXTURE.localText,
      wholeText: wholeCandidate,
      staleLocalText
    })

    await evaluate(`(async () => {
      await window.novelDirector.credentials.setApiKey('TEST_READING_REWRITE_QA_KEY')
      const loaded = await window.novelDirector.data.load()
      await window.novelDirector.data.save({
        ...loaded.data,
        chapters: [...loaded.data.chapters.filter((item) => item.projectId !== ${JSON.stringify(READING_REWRITE_FIXTURE.projectId)}), ...${JSON.stringify(fixture)}],
        settings: {
          ...loaded.data.settings,
          apiProvider: 'compatible',
          hasApiKey: true,
          apiKey: '',
          baseUrl: ${JSON.stringify(stub.baseUrl)},
          modelName: 'qa-reading-rewrite-stub',
          retryEnabled: false,
          maxRetries: 0,
          requestTimeoutMs: 15000
        }
      })
    })()`)

    await reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons)
    const initialPosition = await positionReaderParagraph({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.targetText)
    await invoke('backToChapters')
    await waitFor(`Boolean(document.querySelector('.chapters-view'))`, 15_000)
    await invoke('openReader', { chapterId: READING_REWRITE_FIXTURE.targetChapterId })
    await waitForReader({ evaluate, waitFor }, selectors)
    // Returning restores the reading anchor; clicking the directory instead is
    // a different user action that intentionally jumps to the chapter heading.
    await settleReaderScroll(evaluate, selectors)
    const returnedPosition = await measureReaderParagraph({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.targetText)
    assertReaderParagraphNear(returnedPosition, initialPosition, 'Leaving and returning to the reader')
    checks.push('中章指定段落滚到视口约 25% 后，离开阅读页再返回仍保持附近位置。')

    const earlierBefore = await readState(evaluate, [READING_REWRITE_FIXTURE.previousChapterId])
    const earlierAfterBody = [
      bodyOf(earlierBefore, READING_REWRITE_FIXTURE.previousChapterId),
      ...Array.from({ length: 10 }, (_, index) => `前章长度变化后的新增段落 ${index + 1}。`)
    ].join('\n\n')
    await evaluate(`(async () => {
      const loaded = await window.novelDirector.data.load()
      await window.novelDirector.data.save({ ...loaded.data, chapters: loaded.data.chapters.map((item) => item.id === ${JSON.stringify(READING_REWRITE_FIXTURE.previousChapterId)} ? { ...item, body: ${JSON.stringify(earlierAfterBody)} } : item) })
    })()`)
    await reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons, true)
    const afterEarlierChange = await measureReaderParagraph({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.targetText)
    assertReaderParagraphNear(afterEarlierChange, initialPosition, 'Changing earlier text and reloading')
    checks.push('前章长度变化后按“章节 → 连贯阅读”重新进入，指定段落仍回到原视口附近。')

    const beforeLocal = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    const currentBody = bodyOf(beforeLocal, READING_REWRITE_FIXTURE.targetChapterId)
    await selectReaderText({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.targetText)
    await waitFor(`Boolean(document.querySelector('.ai-rewrite-menu'))`, 10_000)
    await invoke('rewriteAction')
    await waitForCandidate({ waitFor }, selectors)
    const localCandidate = await candidateValue(evaluate, selectors)
    assert(localCandidate === READING_REWRITE_FIXTURE.localText, 'The normal local rewrite candidate did not preserve the stub result.')
    await assertCandidateReadOnlyState({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetText, currentBody, beforeLocal, READING_REWRITE_FIXTURE.targetChapterId)
    await clickButton('与原文对比')
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selectors.resultPanel + ' .revision-diff')}))`)
    if (captureScreenshot) await captureScreenshot(client, '18-reading-rewrite-comparison.png')
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false })
    await wait(160)
    const layout = await evaluate(`(() => {
      const panel = document.querySelector(${JSON.stringify(selectors.resultPanel)})
      const rect = panel?.getBoundingClientRect()
      const footer = panel?.querySelector('footer')?.getBoundingClientRect()
      const scroll = document.querySelector(${JSON.stringify(selectors.scroll)})
      return { left: rect?.left, right: rect?.right, top: rect?.top, bottom: rect?.bottom,
        footerBottom: footer?.bottom, width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollOverflow: scroll ? getComputedStyle(scroll).overflowY : null }
    })()`)
    assert(layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height &&
      layout.footerBottom <= layout.height && layout.documentWidth <= layout.clientWidth && layout.scrollOverflow === 'auto', `Rewrite panel/reader escapes the compact viewport: ${JSON.stringify(layout)}`)
    if (captureScreenshot) await captureScreenshot(client, '19-reading-rewrite-compact.png')
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
    await clickButton('编辑候选')
    checks.push('局部候选可与原文并排对比；1024×720 紧凑窗口保留操作栏与独立阅读滚动。')
    await invoke('copyCandidate')
    const clipboard = await readClipboard(evaluate)
    if (clipboard !== null) assert(clipboard === localCandidate, 'Copy candidate did not copy the editable candidate text.')
    await invoke('applyToSelection')
    const localExpected = currentBody.replace(READING_REWRITE_FIXTURE.targetText, READING_REWRITE_FIXTURE.localText)
    await waitForStoredBody({ evaluate, waitFor }, READING_REWRITE_FIXTURE.targetChapterId, localExpected)
    const afterLocal = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(afterLocal.chapterVersionCount > beforeLocal.chapterVersionCount, 'Applying a local candidate did not create a persisted chapter version.')
    assert(afterLocal.revisionCommitCount > beforeLocal.revisionCommitCount, 'Applying a local candidate did not create a persisted revision commit.')
    assert(bodyOf(afterLocal, READING_REWRITE_FIXTURE.targetChapterId) === localExpected, 'Applying a local candidate changed text outside the selected range.')
    checks.push('局部候选先进入可编辑面板；明确应用后只替换选区，并等待正文与版本持久化。')

    await selectReaderText({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.localText)
    await waitFor(`Boolean(document.querySelector('.ai-rewrite-menu'))`, 10_000)
    await invoke('rewriteAction')
    await waitForCandidate({ waitFor }, selectors)
    const beforeDiscard = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    await invoke('discardCandidate')
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.resultPanel)})`, 10_000)
    const afterDiscard = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(JSON.stringify(afterDiscard.chapters) === JSON.stringify(beforeDiscard.chapters), 'Discarding a candidate changed persisted chapter text.')
    assert(afterDiscard.chapterVersionCount === beforeDiscard.chapterVersionCount, 'Discarding a candidate created a chapter version.')
    checks.push('候选可复制、可放弃；放弃不会写入正文或版本。')

    await selectReaderText({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.localText)
    await waitFor(`Boolean(document.querySelector('.ai-rewrite-menu'))`, 10_000)
    await invoke('rewriteAction')
    await waitForCandidate({ waitFor }, selectors)
    const beforeWhole = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(await candidateValue(evaluate, selectors) === wholeCandidate, 'The broad rewrite response was not retained as a full editable candidate.')
    await assertCandidateReadOnlyState({ evaluate }, selectors, bodyOf(beforeWhole, READING_REWRITE_FIXTURE.targetChapterId), bodyOf(beforeWhole, READING_REWRITE_FIXTURE.targetChapterId), beforeWhole, READING_REWRITE_FIXTURE.targetChapterId)
    await invoke('adoptWhole')
    await waitFor(`Boolean(document.querySelector('.confirm-dialog'))`, 10_000)
    const beforeWholeConfirm = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(JSON.stringify(beforeWholeConfirm.chapters) === JSON.stringify(beforeWhole.chapters), 'Whole-chapter candidate changed storage before its explicit confirmation.')
    await performWholeConfirmation({ clickButton, buttons })
    await waitForStoredBody({ evaluate, waitFor }, READING_REWRITE_FIXTURE.targetChapterId, wholeCandidate)
    const afterWhole = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(afterWhole.chapterVersionCount > beforeWhole.chapterVersionCount, 'Explicit whole-chapter adoption did not create a persisted chapter version.')
    checks.push('疑似整章候选保持可编辑，只有“作为整章采用”后的第二次确认才写回整章。')

    const staleSource = `${READING_REWRITE_FIXTURE.externalPrefix}${wholeCandidate}`
    await selectReaderText({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.localText)
    await waitFor(`Boolean(document.querySelector('.ai-rewrite-menu'))`, 10_000)
    await invoke('rewriteAction')
    await waitForCandidate({ waitFor }, selectors)
    await editCurrentChapterThroughReader({ client, evaluate, waitFor, clickButton }, READING_REWRITE_FIXTURE.targetChapterId, staleSource, selectors, buttons)
    assert(await candidateValue(evaluate, selectors) === staleLocalText, 'The stale candidate was not retained after the source changed.')
    const beforeStaleApply = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    await assertCandidateButtonDisabled(evaluate, selectors, buttons.applyToSelection)
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selectors.resultPanel)}))`, 10_000)
    const afterStaleApply = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(bodyOf(afterStaleApply, READING_REWRITE_FIXTURE.targetChapterId) === staleSource, 'A stale candidate overwrote the changed source.')
    assert(afterStaleApply.chapterVersionCount === beforeStaleApply.chapterVersionCount, 'A stale candidate created a chapter version.')
    await selectReaderText({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.localText)
    await invoke('useCurrentSelection')
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selectors.resultPanel)}))`, 10_000)
    await waitFor(`(() => {
      const panel = document.querySelector(${JSON.stringify(selectors.resultPanel)})
      const button = [...(panel?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === ${JSON.stringify(buttons.applyToSelection)})
      return Boolean(button && !button.disabled)
    })()`, 10_000)
    await invoke('applyToSelection')
    const reboundExpected = staleSource.replace(READING_REWRITE_FIXTURE.localText, staleLocalText)
    await waitForStoredBody({ evaluate, waitFor }, READING_REWRITE_FIXTURE.targetChapterId, reboundExpected)
    const afterReboundApply = await readState(evaluate, [READING_REWRITE_FIXTURE.targetChapterId])
    assert(bodyOf(afterReboundApply, READING_REWRITE_FIXTURE.targetChapterId) === reboundExpected, 'Using the current selection did not apply the retained candidate to the new selection.')
    assert(reboundExpected.startsWith(READING_REWRITE_FIXTURE.externalPrefix), 'Reapplying a retained candidate changed the new source prefix.')
    assert(afterReboundApply.chapterVersionCount > beforeStaleApply.chapterVersionCount, 'Applying a retained candidate after reselection did not create a chapter version.')
    assert(afterReboundApply.revisionCommitCount > beforeStaleApply.revisionCommitCount, 'Applying a retained candidate after reselection did not create a revision commit.')
    checks.push('来源变化后的过期候选保留在面板；应用按钮保持禁用，重新选区后才允许实际应用并保留新增前缀。')

    assert(stub.requestCount() === 4, `Expected four loopback rewrite requests, received ${stub.requestCount()}.`)
    result = { checks, requestCount: stub.requestCount(), screenshots: [] }
    if (captureScreenshot) {
      await captureScreenshot(client, screenshots.final ?? 'reading-rewrite-final.png')
      result.screenshots.push(screenshots.final ?? 'reading-rewrite-final.png')
    }
  } catch (error) {
    failure = error
    try {
      if (captureScreenshot) await captureScreenshot(client, 'reading-rewrite-failure.png')
      const state = await evaluate(`(async () => ({
        notices: [...document.querySelectorAll('.reader-message,.confirm-dialog,.ai-rewrite-menu')].map(item => item.textContent?.slice(0, 600)),
        progress: await window.novelDirector.ai.getCallProgress({})
      }))()`)
      failure = new Error(error.message + '\nReading fixture diagnostics: ' + JSON.stringify({ requests: stub?.requestCount(), state }))
    } catch { /* Keep the original failure if the renderer has already exited. */ }
  } finally {
    const cleanupErrors = []
    try {
      await evaluate(`(async () => {
        await window.novelDirector.credentials.deleteApiKey()
        await window.novelDirector.data.save(${JSON.stringify(originalData)})
      })()`)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      if (stub?.server) await closeServer(stub.server)
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length === 1) cleanupFailure = cleanupErrors[0]
    if (cleanupErrors.length > 1) cleanupFailure = new AggregateError(cleanupErrors, 'Reading rewrite QA cleanup failed.')
  }

  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'Reading rewrite QA and cleanup both failed.')
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  return result
}

export async function runQuickRewritePersistenceQA({
  client,
  evaluate,
  waitFor,
  clickButton,
  captureScreenshot,
  buttons: buttonOverrides = {},
  selectors: selectorOverrides = {},
  actions = {},
  screenshots = {}
}) {
  for (const [name, value] of Object.entries({ client, evaluate, waitFor, clickButton })) {
    assert(value && (name === 'client' || typeof value === 'function'), `Missing quick rewrite persistence QA dependency: ${name}`)
  }

  const buttons = mergedButtons({ confirmReplaceCandidate: '生成新候选', ...buttonOverrides })
  const selectors = mergedSelectors(selectorOverrides)
  const invoke = async (name, context = {}) => {
    if (typeof actions[name] === 'function') return actions[name]({ client, evaluate, waitFor, clickButton, selectors, buttons, ...context })
    return clickConfigured({ clickButton, buttons }, name)
  }
  const fixture = makeFixture()
  const targetChapter = fixture.find((item) => item.id === READING_REWRITE_FIXTURE.targetChapterId)
  const otherChapter = fixture.find((item) => item.id === READING_REWRITE_FIXTURE.previousChapterId)
  assert(targetChapter && otherChapter, 'Quick rewrite persistence fixture is missing its target chapters.')
  const editedCandidateText = '跨页返回后保留的人工编辑候选。'
  const checks = []
  const originalData = await evaluate(`(async () => (await window.novelDirector.data.load()).data)()`)
  let stub
  let result
  let failure
  let cleanupFailure

  try {
    const projectExists = await evaluate(`(async () => (await window.novelDirector.data.load()).data.projects.some((item) => item.id === ${JSON.stringify(READING_REWRITE_FIXTURE.projectId)}))()`)
    assert(projectExists, `Quick rewrite persistence fixture requires project ${READING_REWRITE_FIXTURE.projectId}.`)
    stub = await startPersistenceRewriteStub([
      READING_REWRITE_FIXTURE.localText,
      READING_REWRITE_FIXTURE.otherCandidateText
    ])
    await evaluate(`(async () => {
      await window.novelDirector.credentials.setApiKey('TEST_QUICK_REWRITE_PERSISTENCE_KEY')
      const loaded = await window.novelDirector.data.load()
      await window.novelDirector.data.save({
        ...loaded.data,
        chapters: [...loaded.data.chapters.filter((item) => item.projectId !== ${JSON.stringify(READING_REWRITE_FIXTURE.projectId)}), ...${JSON.stringify(fixture)}],
        quickRewriteDrafts: [],
        settings: {
          ...loaded.data.settings,
          apiProvider: 'compatible',
          hasApiKey: true,
          apiKey: '',
          baseUrl: ${JSON.stringify(stub.baseUrl)},
          modelName: 'qa-quick-rewrite-persistence-stub',
          retryEnabled: false,
          maxRetries: 0,
          requestTimeoutMs: 15000
        }
      })
    })()`)

    await reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons)
    const beforeCandidate = await readState(evaluate, [targetChapter.id])
    const beforeOtherChapter = await readState(evaluate, [otherChapter.id])
    await selectReaderText({ evaluate }, selectors, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.targetText)
    await waitFor(`Boolean(document.querySelector('.ai-rewrite-menu'))`, 10_000)
    await invoke('rewriteAction')
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === READING_REWRITE_FIXTURE.localText, 'Initial quick rewrite candidate did not appear.')
    await waitForQuickRewriteSaved({ waitFor }, selectors)
    await waitForQuickRewriteDraft(evaluate, waitFor, READING_REWRITE_FIXTURE.targetChapterId, READING_REWRITE_FIXTURE.localText)
    const initialDrafts = await readQuickRewriteDrafts(evaluate)
    assert(initialDrafts.exists, 'AppData.quickRewriteDrafts is not available to the persistence QA.')
    assert(initialDrafts.drafts.length === 1, `Expected one persisted target candidate, received ${initialDrafts.drafts.length}.`)
    assert(initialDrafts.drafts[0].targetKind === 'chapter' && initialDrafts.drafts[0].chapterId === targetChapter.id, 'The persisted target candidate is not bound to targetKind=chapter and the expected chapterId.')
    const afterCandidate = await readState(evaluate, [targetChapter.id])
    assert(bodyOf(afterCandidate, targetChapter.id) === bodyOf(beforeCandidate, targetChapter.id), 'Generating a persisted candidate changed chapter正文 before apply.')
    assert(afterCandidate.chapterVersionCount === beforeCandidate.chapterVersionCount, 'Generating a persisted candidate created a chapter version before apply.')
    assert(afterCandidate.revisionCommitCount === beforeCandidate.revisionCommitCount, 'Generating a persisted candidate created a revision commit before apply.')
    const afterTargetCandidateOther = await readState(evaluate, [otherChapter.id])
    assert(bodyOf(afterTargetCandidateOther, otherChapter.id) === bodyOf(beforeOtherChapter, otherChapter.id), 'Generating a target candidate changed another chapter正文.')
    assert(afterTargetCandidateOther.chapterVersionCount === beforeOtherChapter.chapterVersionCount, 'Generating a target candidate created a version for another chapter.')
    assert(afterTargetCandidateOther.revisionCommitCount === beforeOtherChapter.revisionCommitCount, 'Generating a target candidate created a revision commit for another chapter.')
    checks.push('生成候选后，quickRewriteDrafts 持久化了当前章节候选，正文未被提前修改。')

    await invoke('backToChapters')
    await waitFor(`Boolean(document.querySelector('.chapters-view'))`, 15_000)
    await invoke('openReader', { chapterId: READING_REWRITE_FIXTURE.targetChapterId })
    await waitForReader({ evaluate, waitFor }, selectors)
    await selectReaderChapter({ evaluate, waitFor }, selectors, READING_REWRITE_FIXTURE.targetChapterOrder)
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === READING_REWRITE_FIXTURE.localText, 'Candidate disappeared after leaving and returning to the same chapter.')
    checks.push('离开阅读页再返回同章节，候选仍在。')

    await reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons)
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === READING_REWRITE_FIXTURE.localText, 'Candidate disappeared after an app reload.')
    await waitForQuickRewriteSaved({ waitFor }, selectors)
    checks.push('整页 reload 后重新进入阅读，候选仍从本地存储恢复。')

    await editCandidateText({ client, evaluate, waitFor }, selectors, editedCandidateText)
    await waitForQuickRewriteSaved({ waitFor }, selectors)
    await invoke('saveCandidate')
    await waitForQuickRewriteSaved({ waitFor }, selectors)
    await waitForQuickRewriteDraft(evaluate, waitFor, READING_REWRITE_FIXTURE.targetChapterId, editedCandidateText)
    const afterCandidateEdit = await readState(evaluate, [targetChapter.id])
    assert(bodyOf(afterCandidateEdit, targetChapter.id) === bodyOf(beforeCandidate, targetChapter.id), 'Editing the candidate changed ordinary chapter正文 before apply.')
    assert(afterCandidateEdit.chapterVersionCount === beforeCandidate.chapterVersionCount, 'Editing the candidate created a chapter version before apply.')
    assert(afterCandidateEdit.revisionCommitCount === beforeCandidate.revisionCommitCount, 'Editing the candidate created a revision commit before apply.')
    await invoke('backToChapters')
    await waitFor(`Boolean(document.querySelector('.chapters-view'))`, 15_000)
    await invoke('openReader', { chapterId: READING_REWRITE_FIXTURE.targetChapterId })
    await waitForReader({ evaluate, waitFor }, selectors)
    await selectReaderChapter({ evaluate, waitFor }, selectors, READING_REWRITE_FIXTURE.targetChapterOrder)
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === editedCandidateText, 'Edited candidate text did not survive leaving and returning.')
    checks.push('编辑候选后离开再返回，编辑后的文本仍保留。')

    await selectReaderChapter({ evaluate, waitFor }, selectors, otherChapter.order)
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.resultPanel)})`, 10_000)
    await selectReaderText({ evaluate }, selectors, otherChapter.id, READING_REWRITE_FIXTURE.otherTargetText)
    await waitFor(`Boolean(document.querySelector('.ai-rewrite-menu'))`, 10_000)
    const beforeOtherCandidate = await readState(evaluate, [otherChapter.id])
    await invoke('rewriteAction')
    if (await evaluate('Boolean(document.querySelector(\'.confirm-dialog\'))')) await clickButton(buttons.confirmReplaceCandidate)
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === READING_REWRITE_FIXTURE.otherCandidateText, 'The other chapter did not receive its own candidate.')
    await waitForQuickRewriteSaved({ waitFor }, selectors)
    await waitForQuickRewriteDraft(evaluate, waitFor, otherChapter.id, READING_REWRITE_FIXTURE.otherCandidateText)
    const afterOtherCandidate = await readState(evaluate, [otherChapter.id])
    assert(bodyOf(afterOtherCandidate, otherChapter.id) === bodyOf(beforeOtherCandidate, otherChapter.id), 'Generating another chapter candidate changed its canonical正文.')
    assert(afterOtherCandidate.chapterVersionCount === beforeOtherCandidate.chapterVersionCount, 'Generating another chapter candidate created a chapter version before apply.')
    assert(afterOtherCandidate.revisionCommitCount === beforeOtherCandidate.revisionCommitCount, 'Generating another chapter candidate created a revision commit before apply.')
    const separatedDrafts = await readQuickRewriteDrafts(evaluate)
    assert(separatedDrafts.drafts.some((item) => item.targetKind === 'chapter' && item.chapterId === READING_REWRITE_FIXTURE.targetChapterId && item.text === editedCandidateText), 'Target chapter draft was overwritten by the other chapter candidate.')
    assert(separatedDrafts.drafts.some((item) => item.targetKind === 'chapter' && item.chapterId === otherChapter.id && item.text === READING_REWRITE_FIXTURE.otherCandidateText), 'Other chapter draft was not stored under its own chapter key.')

    await selectReaderChapter({ evaluate, waitFor }, selectors, targetChapter.order)
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === editedCandidateText, 'Switching chapters mixed the other chapter candidate into the target chapter.')
    checks.push('不同章节的候选按 chapter key 隔离，切回目标章节仍恢复其编辑版本。')

    const beforeApply = await readState(evaluate, [targetChapter.id])
    const expectedAppliedBody = targetChapter.body.replace(READING_REWRITE_FIXTURE.targetText, editedCandidateText)
    await invoke('applyToSelection')
    await waitForStoredBody({ evaluate, waitFor }, targetChapter.id, expectedAppliedBody)
    await waitForNoQuickRewriteDraft(evaluate, waitFor, targetChapter.id)
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.resultPanel)})`, 10_000)
    const afterApply = await readState(evaluate, [targetChapter.id])
    assert(bodyOf(afterApply, targetChapter.id) === expectedAppliedBody, 'Applying the persisted candidate did not store the edited target text.')
    assert(afterApply.chapterVersionCount > beforeApply.chapterVersionCount, 'Applying the persisted candidate did not create a chapter version.')
    assert(afterApply.revisionCommitCount > beforeApply.revisionCommitCount, 'Applying the persisted candidate did not create a revision commit.')
    const afterTargetApplyOther = await readState(evaluate, [otherChapter.id])
    assert(bodyOf(afterTargetApplyOther, otherChapter.id) === bodyOf(beforeOtherChapter, otherChapter.id), 'Applying the target candidate changed another chapter正文.')
    assert(afterTargetApplyOther.chapterVersionCount === beforeOtherChapter.chapterVersionCount, 'Applying the target candidate created a version for another chapter.')
    assert(afterTargetApplyOther.revisionCommitCount === beforeOtherChapter.revisionCommitCount, 'Applying the target candidate created a revision commit for another chapter.')
    checks.push('明确应用后当前候选移除，正文、chapter version 和 revision commit 均真实持久化。')

    await reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons)
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.resultPanel)})`, 10_000)
    await selectReaderChapter({ evaluate, waitFor }, selectors, otherChapter.order)
    await waitForCandidate({ waitFor }, selectors)
    assert(await candidateValue(evaluate, selectors) === READING_REWRITE_FIXTURE.otherCandidateText, 'The other chapter candidate was lost while applying the target chapter candidate.')
    const beforeOtherDiscard = await readState(evaluate, [otherChapter.id])
    await invoke('discardCandidate')
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.resultPanel)})`, 10_000)
    await waitForNoQuickRewriteDraft(evaluate, waitFor, otherChapter.id)
    const afterOtherDiscard = await readState(evaluate, [otherChapter.id])
    assert(bodyOf(afterOtherDiscard, otherChapter.id) === bodyOf(beforeOtherDiscard, otherChapter.id), 'Discarding the other chapter candidate changed chapter正文.')
    assert(afterOtherDiscard.chapterVersionCount === beforeOtherDiscard.chapterVersionCount, 'Discarding the other chapter candidate created a chapter version.')
    assert(afterOtherDiscard.revisionCommitCount === beforeOtherDiscard.revisionCommitCount, 'Discarding the other chapter candidate created a revision commit.')
    await reloadIntoReader({ client, evaluate, waitFor, clickButton }, selectors, buttons)
    await selectReaderChapter({ evaluate, waitFor }, selectors, otherChapter.order)
    await waitFor(`!document.querySelector(${JSON.stringify(selectors.resultPanel)})`, 10_000)
    const finalDrafts = await readQuickRewriteDrafts(evaluate)
    assert(finalDrafts.drafts.length === 0, `Discarded quick rewrite candidate reappeared after reload: ${JSON.stringify(finalDrafts.drafts)}`)
    checks.push('放弃候选后 reload 不复活，两个章节的 quickRewriteDrafts 均已清理。')

    assert(stub.requestCount() === 2, `Expected two loopback quick rewrite requests, received ${stub.requestCount()}.`)
    result = { checks, requestCount: stub.requestCount(), screenshots: [] }
    if (captureScreenshot) {
      await captureScreenshot(client, screenshots.persistence ?? 'reading-rewrite-persistence-final.png')
      result.screenshots.push(screenshots.persistence ?? 'reading-rewrite-persistence-final.png')
    }
  } catch (error) {
    failure = new Error(error.message + '\nPersistence fixture completed checks: ' + JSON.stringify(checks))
    try { if (captureScreenshot) await captureScreenshot(client, 'reading-persistence-failure.png') } catch { /* Preserve the original QA failure. */ }
  } finally {
    const cleanupErrors = []
    try {
      await evaluate(`(async () => {
        await window.novelDirector.credentials.deleteApiKey()
        await window.novelDirector.data.save(${JSON.stringify(originalData)})
      })()`)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      if (stub?.server) await closeServer(stub.server)
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length === 1) cleanupFailure = cleanupErrors[0]
    if (cleanupErrors.length > 1) cleanupFailure = new AggregateError(cleanupErrors, 'Quick rewrite persistence QA cleanup failed.')
  }

  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'Quick rewrite persistence QA and cleanup both failed.')
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  return result
}
