import assert from 'node:assert/strict'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { repoRoot } from './repo-root.mjs'

export const PROSE_VIEWPORTS = Object.freeze([
  { width: 1280, height: 720 }, { width: 1440, height: 900 },
  { width: 1920, height: 1080 }, { width: 1024, height: 768 }
].map(Object.freeze))

// Selectors may be overridden by the parent, but every workspace needs a real
// body and at least one reversible, read-only disclosure. Never pass AI/save actions.
export const PROSE_WORKSPACES = Object.freeze({
  pipeline: { root: '.generation-view', main: '.pipeline-main', body: '.pipeline-draft-body',
    minMainRatio: 0.55, tools: [
      { name: 'config', trigger: '.pipeline-config-tools > summary', panel: '.pipeline-config-stack' },
      { name: 'history', trigger: '.pipeline-job-list > summary', panel: '.pipeline-job-items' },
      { name: 'diagnostics', trigger: '.pipeline-original-reports > summary',
        panel: '.pipeline-original-reports-body', firstScreen: false }
    ] },
  reading: { root: '.reading-view', main: '.reader-continuous-main', body: '.reader-chapter-body',
    minMainRatio: 0.48, tools: [
      { name: 'navigation', trigger: '.reader-chapter-rail details > summary', panel: '.reader-chapter-rail-list' }
    ] },
  revision: { root: '.revision-view', main: '.revision-compare',
    body: 'textarea.revision-textarea.revised, .revision-diff-body', minMainRatio: 0.55, tools: [
      { name: 'source', trigger: '.revision-source-disclosure > summary',
        panel: '.revision-source-disclosure textarea.original', firstScreen: false },
      { name: 'diagnostics', trigger: '.revision-version-meta > summary',
        panel: '.revision-version-meta > p', firstScreen: false }
    ] }
})

export function withinDirectory(parent, child) {
  const path = relative(resolve(parent), resolve(child))
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

export function assertProseLayout(sample, { minMainRatio = 0.55 } = {}) {
  assert(sample?.root && sample.main && sample.body, 'Missing visible workspace/main/prose body.')
  assert(sample.body.hasText, 'The visible body must contain the expected fixture prose, not a placeholder.')
  assert(sample.root.width > 0 && sample.main.width > 0 && sample.body.width > 0, 'Zero-width prose workspace.')
  assert(sample.main.width / sample.root.width >= minMainRatio,
    `Prose main is too narrow: ${JSON.stringify(sample)}`)
  assert(sample.body.width / sample.main.width >= 0.7, 'Prose body is squeezed inside its main column.')
  assert(sample.body.visibleHeight >= Math.min(sample.body.height, sample.body.lineHeight * 2),
    'At least two prose lines (or the entire shorter body) must be visible before scrolling.')
  assert(sample.body.hit, 'First-screen prose is clipped or covered by another element.')
  assert(sample.documentWidth <= sample.viewport.width && sample.bodyWidth <= sample.viewport.width,
    'The document has horizontal overflow.')
  assert.deepEqual(sample.overflow, [], 'Visible workspace content overflows horizontally.')
  assert.deepEqual(sample.unlabelledTools, [], 'Visible tools need accessible labels.')
  assert(sample.primaryContrasts.length > 0 && sample.primaryContrasts.every((item) => item.ratio >= 4.5),
    `Enabled primary actions need readable text contrast: ${JSON.stringify(sample.primaryContrasts)}`)
  return { mainRatio: sample.main.width / sample.root.width, bodyWidth: sample.body.width,
    visibleProseLines: sample.body.visibleHeight / sample.body.lineHeight,
    minimumPrimaryContrast: Math.min(...sample.primaryContrasts.map((item) => item.ratio)) }
}

// Serialized into the current renderer; no React internals, storage writes or DOM clicks.
export function inspectProseDOM(spec) {
  const rect = (element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
  }
  const visible = (element) => {
    if (!element || !element.getClientRects().length) return false
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      if (node.tagName === 'DETAILS' && !node.open && !node.querySelector(':scope > summary')?.contains(element)) return false
    }
    return true
  }
  const root = [...document.querySelectorAll(spec.root)].find(visible)
  const main = root && [...root.querySelectorAll(spec.main)].find(visible)
  const body = main && [...main.querySelectorAll(spec.body)].find(visible)
  if (!root || !main || !body) return null
  const clipped = (element) => {
    const box = rect(element)
    let left = Math.max(0, box.left), top = Math.max(0, box.top)
    let right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom)
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node), bounds = rect(node)
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left); right = Math.min(right, bounds.right)
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom)
      }
    }
    return { left, top, right, bottom }
  }
  const clip = clipped(body), style = getComputedStyle(body)
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
  const hit = document.elementFromPoint((clip.left + clip.right) / 2, clip.top + Math.min(lineHeight, (clip.bottom - clip.top) / 2))
  const overflow = [], unlabelledTools = []
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const luminance = (color) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const primaryContrasts = []
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!visible(element)) continue
    const box = rect(element)
    if (!box.width || !box.height) continue
    // A single CSS pixel accounts for integer scrollWidth vs fractional box rounding.
    const clippedX = /^(hidden|clip)$/.test(getComputedStyle(element).overflowX)
    if (!clippedX && element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0 || box.left < -1 || box.right > innerWidth + 1) {
      overflow.push(`${element.tagName}.${element.className}`)
    }
    if (element.matches('button, summary, [role="button"]')) {
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '').join('').trim()
      if (!(element.textContent?.trim() || element.getAttribute('aria-label')?.trim() || labelledBy || element.title)) {
        unlabelledTools.push(`${element.tagName}.${element.className}`)
      }
    }
    if (element.matches('button.primary-button:not(:disabled)')) {
      const style = getComputedStyle(element)
      const a = luminance(style.color), b = luminance(style.backgroundColor)
      primaryContrasts.push({ label: element.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
    }
  }
  const normalize = (text) => String(text).replace(/\s+/g, '')
  return { root: rect(root), main: rect(main), body: { ...rect(body), lineHeight,
    visibleHeight: Math.max(0, clip.bottom - clip.top), hit: Boolean(hit && body.contains(hit)),
    hasText: normalize(body.value ?? body.textContent ?? '').includes(normalize(spec.expectedText)) },
    viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body?.scrollWidth ?? 0, overflow, unlabelledTools, primaryContrasts,
    theme: document.documentElement.getAttribute('data-theme'),
    colorScheme: getComputedStyle(root).colorScheme,
    forcedColors: matchMedia('(forced-colors: active)').matches }
}

function protectedData(data) {
  const { settings, projects, ...collections } = data
  return { ...collections, projects: projects.map(({ lastOpenedAt, updatedAt, ...project }) => project) }
}

export function assertProseFixture(loaded, fixture) {
  assert(fixture?.projectId?.startsWith('qa-'), 'Supply an explicit synthetic qa-* project ID.')
  const { data } = loaded
  assert(data.projects.length > 0 && data.projects.every((project) => project.id.startsWith('qa-')),
    'Refusing a profile containing non-synthetic projects.')
  assert(!data.settings.apiKey && !data.settings.hasApiKey, 'Use a credential-free isolated fixture.')
  assert(!data.chapterGenerationJobs.some((job) => job.status === 'running'), 'A generation job is running.')
  assert(data.projects.some((project) => project.id === fixture.projectId), 'Fixture project is missing.')
  for (const [collection, key] of [['chapters', 'chapterId'], ['generatedChapterDrafts', 'draftId'], ['revisionVersions', 'versionId']]) {
    const item = data[collection]?.find((entry) => entry.id === fixture[key])
    assert(item?.body?.trim(), `Supply retained fixture prose: ${collection}/${key}.`)
    if (item.projectId) assert.equal(item.projectId, fixture.projectId)
    if (key === 'draftId') assert(data.chapterGenerationJobs.some((job) => job.id === item.jobId && job.projectId === fixture.projectId), 'Draft job is missing.')
    if (key === 'versionId') {
      const session = data.revisionSessions.find((entry) => entry.id === item.sessionId)
      assert(session?.projectId === fixture.projectId, 'Revision session belongs to another project.')
    }
  }
  if (fixture.planJobId) {
    const job = data.chapterGenerationJobs.find((item) => item.id === fixture.planJobId && item.projectId === fixture.projectId)
    assert(job, 'Plan-only job is missing.')
    assert(!data.generatedChapterDrafts.some((draft) => draft.jobId === job.id), 'Plan-only scenario already has a draft.')
    const step = data.chapterGenerationSteps.find((item) => item.jobId === job.id && item.type === 'generate_chapter_plan' && item.status === 'completed')
    assert(step?.output?.trim() && JSON.parse(step.output).chapterGoal, 'Plan-only scenario needs a valid completed plan.')
  }
}

/**
 * Existing realElectron/CDP only. All callbacks are UNBOUND, as in the parent QA:
 * evaluate(client, expression), waitFor(client, expression, timeout), captureScreenshot(client, filename).
 * Required workspaces: [{id: 'pipeline'|'reading'|'revision', open: async () => ..., expectedText, ...selectorOverrides}].
 * open selects the retained fixture through UI without generating, saving or accepting anything.
 * tools: [{name, trigger, panel, close?, label?, closeLabel?, firstScreen?}]; panel selects CONTENT, not a details wrapper.
 * Hidden parent details are opened via their real summaries, then restored. Existing classes need no new data attributes.
 * pipelinePlan: {open, expectedText, selector?} selects fixture.planJobId from an existing draft tab;
 * the helper asserts the task area is visible WITHOUT clicking the task tab. Optional; omitted coverage is reported.
 * assertNoAI must assert the parent's all-request counter has not changed (including main-process AI).
 * Optional themes: [{name, enter: async () => cleanupFunction}]; enter/cleanup are parent-owned.
 * No theme callback means CURRENT theme only. No automatic light/dark/high-contrast coverage claim.
 * Caller owns initial navigation/theme/scroll setup; this helper restores device metrics and disclosures.
 */
export async function runProseFirstWorkspacesQA({ client, evaluate, waitFor, captureScreenshot,
  isolatedUserDataDir, fixture, workspaces, assertNoAI, themes = [{ name: 'current' }],
  restoreViewport, pipelinePlan }) {
  assert.equal(typeof client?.send, 'function')
  for (const fn of [evaluate, waitFor, captureScreenshot, assertNoAI]) assert.equal(typeof fn, 'function')
  assert.deepEqual(workspaces?.map((item) => item.id).sort(), ['pipeline', 'reading', 'revision'])
  if (pipelinePlan) assert(fixture?.planJobId && typeof pipelinePlan.open === 'function' && pipelinePlan.expectedText?.trim(),
    'Supply fixture.planJobId and pipelinePlan {open, expectedText} for the no-draft task regression.')
  assert(themes.length > 0, 'At least one theme is required.')
  for (const theme of themes) assert(/^[a-z0-9-]+$/i.test(theme.name), 'Theme names must be filename-safe.')
  assert(typeof isolatedUserDataDir === 'string' && withinDirectory(resolve(repoRoot, 'tmp'), isolatedUserDataDir),
    'Caller-owned isolated userData must be below repository tmp.')
  const realTmp = await realpath(resolve(repoRoot, 'tmp')), realProfile = await realpath(isolatedUserDataDir)
  assert(withinDirectory(realTmp, realProfile), 'Isolated userData resolves outside repository tmp.')
  const ev = (expression) => evaluate(client, expression)
  const until = (expression) => waitFor(client, expression, 20_000)
  const load = async () => {
    const loaded = await ev('window.novelDirector.data.load()')
    assert(typeof loaded.storagePath === 'string' && loaded.storagePath.endsWith('.sqlite') && withinDirectory(isolatedUserDataDir, loaded.storagePath),
      'Renderer is not attached to the isolated SQLite fixture.')
    assert(withinDirectory(realProfile, await realpath(loaded.storagePath)), 'SQLite escaped the isolated profile.')
    assertProseFixture(loaded, fixture)
    return loaded
  }
  const before = await load()
  const file = await open(before.storagePath, 'r')
  try {
    const header = Buffer.alloc(16)
    await file.read(header, 0, 16, 0)
    assert.equal(header.toString(), 'SQLite format 3\0')
  } finally { await file.close() }
  await assertNoAI()
  const originalViewport = await ev('({width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio})')
  const results = [], screenshots = [], errors = []
  const settle = () => ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const inspect = (spec) => ev(`(${inspectProseDOM.toString()})(${JSON.stringify(spec)})`)
  const panelVisible = (selector) => `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].some(element => {
    if (!element.getClientRects().length || !element.textContent?.trim() && !element.value?.trim() && !element.querySelector('input,select,textarea')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      if (node.tagName === 'DETAILS' && !node.open && !node.querySelector(':scope > summary')?.contains(element)) return false;
    }
    return true;
  }))()`
  async function pointer(selector, firstScreen = false, label) {
    const point = await ev(`(async () => {
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(item => item.getClientRects().length &&
        (${JSON.stringify(label ?? null)} === null || item.textContent?.trim() === ${JSON.stringify(label ?? null)}));
      if (items.length !== 1) throw new Error('Expected one visible tool: ' + ${JSON.stringify(selector)});
      const element = items[0];
      if (!element.matches('button, summary, [role="button"]') || element.disabled || element.getAttribute('aria-disabled') === 'true') return null;
      if (!${firstScreen}) element.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
      await new Promise(resolve => requestAnimationFrame(resolve));
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && hit && element.contains(hit) ? {x,y} : null;
    })()`)
    assert(point, `Tool is disabled, offscreen or covered: ${selector}`)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    await settle()
  }
  async function openAncestors(selector, firstScreen = false) {
    const summaries = await ev(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing tool: ' + ${JSON.stringify(selector)});
      const selectors = [];
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (node.tagName !== 'DETAILS' || node.open || node.querySelector(':scope > summary')?.contains(element)) continue;
        const parts = [];
        for (let part = node; part && part !== document.documentElement; part = part.parentElement) {
          parts.unshift(part.tagName.toLowerCase() + ':nth-child(' + ([...part.parentElement.children].indexOf(part) + 1) + ')');
        }
        selectors.unshift('html > ' + parts.join(' > ') + ' > summary');
      }
      return selectors;
    })()`)
    const opened = []
    try {
      for (const selector of summaries) { await pointer(selector, firstScreen && opened.length === 0); opened.push(selector) }
    } catch (error) {
      for (const selector of opened.reverse()) await pointer(selector)
      throw error
    }
    return async () => { for (const selector of opened.reverse()) await pointer(selector) }
  }
  async function captureScroll() {
    return ev(`(() => [...document.querySelectorAll('*')].filter(element =>
      element.scrollHeight > element.clientHeight && element.clientHeight > 0).map(element => {
        const parts = [];
        for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
          parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')');
        }
        return {selector: 'html' + (parts.length ? ' > ' + parts.join(' > ') : ''), top: element.scrollTop, left: element.scrollLeft};
      }))()`)
  }
  async function restoreScroll(positions) {
    await ev(`(() => {
      for (const item of ${JSON.stringify(positions)}) {
        document.querySelector(item.selector)?.scrollTo({top: item.top, left: item.left, behavior: 'instant'});
      }
    })()`)
    await settle()
  }
  try {
    for (const theme of themes) {
      let restoreTheme
      try {
        if (theme.enter) {
          restoreTheme = await theme.enter()
          assert.equal(typeof restoreTheme, 'function', 'Theme entry must return a cleanup function.')
        }
        for (const viewport of PROSE_VIEWPORTS) {
          await client.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
          for (const workspace of workspaces) {
            const spec = { ...PROSE_WORKSPACES[workspace.id], ...workspace }
            assert.equal(typeof spec.open, 'function')
            assert(typeof spec.expectedText === 'string' && spec.expectedText.trim(), 'Supply expected fixture prose for every page.')
            assert(spec.tools.length > 0, 'Do not skip all disclosure checks.')
            await spec.open()
            await settle()
            await until(`Boolean(document.querySelector(${JSON.stringify(spec.root)}) && !document.querySelector('.view-loading'))`)
            const sample = await inspect(spec)
            assert.deepEqual(sample?.viewport, viewport, 'CDP viewport did not take effect.')
            if (theme.expectedTheme) assert.equal(sample.theme, theme.expectedTheme, 'Requested renderer theme did not take effect.')
            const layout = assertProseLayout(sample, spec)
            const prefix = `prose-first-${workspace.id}-${theme.name}-${viewport.width}`
            await captureScreenshot(client, `${prefix}.png`)
            screenshots.push(`${prefix}.png`)
            const tools = []
            for (const tool of spec.tools) {
              assert(tool.name && tool.trigger && tool.panel, 'A tool needs name, trigger and content panel selectors.')
              assert(/^[a-z0-9-]+$/i.test(tool.name), 'Tool names must be filename-safe.')
              const scroll = await captureScroll()
              await until(`Boolean(document.querySelector(${JSON.stringify(tool.trigger)}))`)
              const restoreAncestors = await openAncestors(tool.trigger, tool.firstScreen !== false)
              const wasOpen = await ev(panelVisible(tool.panel))
              let opened = false
              try {
                if (wasOpen) {
                  await pointer(tool.close || tool.trigger, tool.firstScreen !== false, tool.closeLabel || tool.label)
                  await until(`!${panelVisible(tool.panel)}`)
                }
                // Re-open from the collapsed state with a physical CDP pointer, never element.click().
                await pointer(tool.trigger, tool.firstScreen !== false && !wasOpen, tool.label)
                opened = true
                await until(panelVisible(tool.panel))
                if (tool.expectedText) await until(`(() => [...document.querySelectorAll(${JSON.stringify(tool.panel)})]
                  .some(element => (element.value || element.textContent || '').includes(${JSON.stringify(tool.expectedText)})))()`)
                const expanded = await inspect(spec)
                assert(expanded, 'Opening a tool removed the prose workspace.')
                assert(expanded.documentWidth <= viewport.width && expanded.bodyWidth <= viewport.width)
                assert.deepEqual(expanded.overflow, [], `Opening ${tool.name} causes horizontal overflow.`)
                await captureScreenshot(client, `${prefix}-${tool.name}.png`)
                screenshots.push(`${prefix}-${tool.name}.png`)
                tools.push({ name: tool.name, pointerHit: true, contentOpened: true })
              } finally {
                try {
                  if (!wasOpen && opened) {
                    await pointer(tool.close || tool.trigger, false, tool.closeLabel || tool.label)
                    await until(`!${panelVisible(tool.panel)}`)
                  } else if (wasOpen && !await ev(panelVisible(tool.panel))) await pointer(tool.trigger, false, tool.label)
                } finally {
                  try { await restoreAncestors() }
                  finally { await restoreScroll(scroll) }
                }
              }
              await assertNoAI()
            }
            const after = await load()
            assert.deepEqual(protectedData(after.data), protectedData(before.data), 'Read-only workspace navigation changed protected fixture data.')
            results.push({ workspace: workspace.id, theme: theme.name, viewport, ...layout, tools,
              actualTheme: sample.theme, colorScheme: sample.colorScheme, forcedColors: sample.forcedColors })
            if (workspace.id === 'pipeline' && pipelinePlan) {
              await pipelinePlan.open()
              await settle()
              const selector = pipelinePlan.selector || '.pipeline-artifact-body'
              await until(panelVisible(selector))
              const plan = await ev(`(() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                const goal = [...element.querySelectorAll('textarea,input')].map(item => item.value).join(' ') + element.textContent;
                const box = element.getBoundingClientRect();
                return {text: goal, top: box.top, bottom: box.bottom, width: box.width};
              })()`)
              assert(plan.text.includes(pipelinePlan.expectedText), 'The displayed task is not the plan-only fixture.')
              assert(plan.width > 0 && plan.top >= 0 && plan.top < viewport.height, 'Plan-only task is below the first screen.')
              await captureScreenshot(client, `${prefix}-plan-only.png`)
              screenshots.push(`${prefix}-plan-only.png`)
              await assertNoAI()
            }
          }
        }
      } finally { if (restoreTheme) await restoreTheme() }
    }
  } catch (error) { errors.push(error) }
  finally {
    try {
      if (restoreViewport) await restoreViewport()
      else await client.send('Emulation.setDeviceMetricsOverride', { ...originalViewport, mobile: false })
    } catch (error) { errors.push(error) }
    try {
      await assertNoAI()
      assert.deepEqual(protectedData((await load()).data), protectedData(before.data), 'QA modified protected fixture data.')
    } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join('\n'))
  return { ok: true, results, screenshots,
    planOnlyCoverage: pipelinePlan ? 'passed' : 'not-run: supply pipelinePlan and fixture.planJobId; pure component regression remains separate',
    scope: 'Existing isolated renderer only; pointer disclosures and relative layout, no generation or acceptance. Theme coverage is exactly the supplied themes.' }
}
