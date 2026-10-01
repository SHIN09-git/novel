import { createServer } from 'node:http'

const SCREENSHOT_WAITING = '11-ai-rewrite-cancellation-waiting.png'
const SCREENSHOT_RECOVERED = '12-ai-rewrite-cancellation-recovered.png'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitUntil(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await wait(25)
  }
  throw new Error(message)
}

function revisionPayload(revisedText) {
  return JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          revisedText,
          changedSummary: '本地 QA stub 仅改写选区。',
          risks: '',
          preservedFacts: '保留章节其余正文。'
        })
      }
    }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
  })
}

async function startRewriteStub(revisedText, timing) {
  let requestCount = 0
  let firstConnectionClosed = false
  let resolveFirstRequest
  const firstRequest = new Promise((resolve) => { resolveFirstRequest = resolve })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'POST' || url.pathname !== '/chat/completions') {
      response.writeHead(404).end()
      return
    }

    request.resume()
    request.once('end', () => {
      requestCount += 1
      if (requestCount === 1) {
        timing.firstRequestAt = Date.now()
        response.once('close', () => {
          if (response.writableEnded) return
          firstConnectionClosed = true
          timing.firstConnectionClosedAt = Date.now()
        })
        resolveFirstRequest()
        return
      }

      timing.secondRequestAt = Date.now()
      const payload = revisionPayload(revisedText)
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        connection: 'close'
      })
      response.end(payload)
      timing.secondResponseAt = Date.now()
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object' && address.address === '127.0.0.1', 'Rewrite QA stub did not bind to loopback.')
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    firstRequest,
    firstConnectionClosed: () => firstConnectionClosed,
    requestCount: () => requestCount
  }
}

async function closeServer(server) {
  server.closeAllConnections?.()
  if (!server.listening) return
  await new Promise((resolve) => server.close(resolve))
}

async function openChapterRewriteMenu(client, evaluate, selectionStart, selectionEnd) {
  const opened = await evaluate(client, `(() => {
    const textarea = document.querySelector('textarea.manuscript-textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) return false
    textarea.focus()
    textarea.setSelectionRange(${selectionStart}, ${selectionEnd})
    const rect = textarea.getBoundingClientRect()
    textarea.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + Math.min(120, rect.width / 2)),
      clientY: Math.round(rect.top + 48)
    }))
    return true
  })()`)
  assert(opened, 'Could not open the chapter AI rewrite menu from the real textarea selection.')
}

export async function runRewriteCancellation({ client, evaluate, waitFor, clickButton, captureScreenshot }) {
  for (const [name, value] of Object.entries({ client, evaluate, waitFor, clickButton, captureScreenshot })) {
    assert(value && (name === 'client' || typeof value === 'function'), `Missing rewrite QA dependency: ${name}`)
  }

  const timing = { startedAt: Date.now() }
  const checks = []
  let originalSettings
  let stub
  let result
  let failure
  let cleanupFailure

  try {
    const source = await evaluate(client, `(async () => {
      const loaded = await window.novelDirector.data.load()
      const chapter = loaded.data.chapters.find((item) => item.id === 'qa-chapter' && item.projectId === 'qa-project')
      if (!chapter?.body) return null
      return { settings: loaded.data.settings, body: chapter.body }
    })()`)
    assert(source?.settings && source.body, 'Could not load qa-project/qa-chapter for rewrite cancellation QA.')
    originalSettings = source.settings
    const selectionStart = 0
    const punctuation = source.body.search(/[，。！？\n]/u)
    const selectionEnd = punctuation > 1 ? punctuation : Math.min(source.body.length, 8)
    const selectedText = source.body.slice(selectionStart, selectionEnd)
    const revisedText = '林默重新握紧银钥匙'
    const expectedBody = `${revisedText}${source.body.slice(selectionEnd)}`
    stub = await startRewriteStub(revisedText, timing)

    await evaluate(client, `(async () => {
      await window.novelDirector.credentials.setApiKey('TEST_LOCAL_QA_CREDENTIAL')
      const loaded = await window.novelDirector.data.load()
      await window.novelDirector.data.save({
        ...loaded.data,
        settings: {
          ...loaded.data.settings,
          apiProvider: 'compatible',
          hasApiKey: true,
          apiKey: '',
          baseUrl: ${JSON.stringify(stub.baseUrl)},
          modelName: 'qa-rewrite-stub',
          retryEnabled: false,
          maxRetries: 0,
          requestTimeoutMs: 15000
        }
      })
    })()`)

    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(client, `Boolean([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入'))`, 30_000)
    await clickButton(client, '进入')
    await waitFor(client, `Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`, 30_000)
    await clickButton(client, '章节')
    await waitFor(client, `document.querySelector('textarea.manuscript-textarea')?.value === ${JSON.stringify(source.body)}`, 30_000)

    await openChapterRewriteMenu(client, evaluate, selectionStart, selectionEnd)
    await waitFor(client, `Boolean([...document.querySelectorAll('.ai-rewrite-menu button')].some((item) => item.textContent?.trim() === '空白重写'))`)
    await clickButton(client, '空白重写')
    await Promise.race([
      stub.firstRequest,
      wait(10_000).then(() => { throw new Error('The first rewrite request did not reach the local stub.') })
    ])
    await waitFor(client, `Boolean([...document.querySelectorAll('.ai-rewrite-menu button')].some((item) => item.textContent?.trim() === '取消本次'))`)
    await waitFor(client, `Boolean(document.querySelector('.ai-rewrite-menu [data-ai-call-progress]')?.textContent.includes('qa-rewrite-stub'))`, 10_000)
    const progressCopy = await evaluate(client, `document.querySelector('.ai-rewrite-menu [data-ai-call-progress]')?.textContent ?? ''`)
    assert(progressCopy.includes('已耗时') && !progressCopy.includes('%'), 'Live call progress needs real elapsed time and must not invent a completion percentage.')
    checks.push('The held call shows live main-process model and elapsed status in the rewrite menu, without a fake percentage.')
    await captureScreenshot(client, SCREENSHOT_WAITING)

    timing.cancelClickedAt = Date.now()
    await clickButton(client, '取消本次')
    await waitUntil(stub.firstConnectionClosed, 'Cancelling the rewrite did not close the local HTTP connection.')
    await waitFor(client, `document.querySelector('textarea.manuscript-textarea')?.value === ${JSON.stringify(source.body)}`)
    const cancelledBody = await evaluate(client, `(async () => (await window.novelDirector.data.load()).data.chapters
      .find((item) => item.id === 'qa-chapter' && item.projectId === 'qa-project')?.body)()`)
    assert(cancelledBody === source.body, 'The cancelled rewrite changed the persisted chapter body.')
    checks.push('Single-call cancellation closed the held loopback HTTP connection.')
    checks.push('The cancelled response did not change the chapter textarea.')

    await openChapterRewriteMenu(client, evaluate, selectionStart, selectionEnd)
    await waitFor(client, `Boolean([...document.querySelectorAll('.ai-rewrite-menu button')].some((item) => item.textContent?.trim() === '空白重写'))`)
    await clickButton(client, '空白重写')
    await waitFor(client, `document.querySelector('.ai-rewrite-result-text')?.value === ${JSON.stringify(revisedText)}`, 30_000)
    assert(await evaluate(client, `document.querySelector('textarea.manuscript-textarea')?.value === ${JSON.stringify(source.body)}`),
      'Receiving a rewrite candidate must not automatically change the chapter.')
    await clickButton(client, '应用到选区')
    await waitFor(client, `document.querySelector('textarea.manuscript-textarea')?.value === ${JSON.stringify(expectedBody)}`, 30_000)
    await waitFor(client, `document.querySelector('.chapter-body-save-state')?.textContent?.trim() === '正文已保存'`, 30_000)
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.chapters
      .find((item) => item.id === 'qa-chapter' && item.projectId === 'qa-project')?.body === ${JSON.stringify(expectedBody)})()`, 30_000)
    timing.rewriteAppliedAt = Date.now()
    assert(stub.requestCount() === 2, `Expected exactly two local AI requests, received ${stub.requestCount()}.`)
    const finalBody = await evaluate(client, `document.querySelector('textarea.manuscript-textarea')?.value`)
    assert(finalBody === expectedBody, 'The successful retry changed text outside the selected range.')
    checks.push('A new call succeeded after cancellation and replaced only the selected range.')
    await captureScreenshot(client, SCREENSHOT_RECOVERED)

    result = {
      checks,
      screenshots: [SCREENSHOT_WAITING, SCREENSHOT_RECOVERED],
      timing: {
        firstRequestMs: timing.firstRequestAt - timing.startedAt,
        cancelToConnectionCloseMs: timing.firstConnectionClosedAt - timing.cancelClickedAt,
        secondResponseMs: timing.secondResponseAt - timing.secondRequestAt,
        totalMs: timing.rewriteAppliedAt - timing.startedAt
      }
    }
  } catch (error) {
    failure = error
  } finally {
    const cleanupErrors = []
    try {
      if (originalSettings) {
        await evaluate(client, `(async () => {
          const loaded = await window.novelDirector.data.load()
          await window.novelDirector.data.save({ ...loaded.data, settings: ${JSON.stringify(originalSettings)} })
        })()`)
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await evaluate(client, `window.novelDirector?.credentials?.deleteApiKey?.()`)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      if (stub?.server) await closeServer(stub.server)
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length === 1) cleanupFailure = cleanupErrors[0]
    if (cleanupErrors.length > 1) cleanupFailure = new AggregateError(cleanupErrors, 'Rewrite cancellation QA cleanup failed.')
  }

  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'Rewrite cancellation QA and cleanup both failed.')
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  return result
}
