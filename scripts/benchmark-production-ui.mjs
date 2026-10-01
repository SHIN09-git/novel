#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const electronExecutable = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const workDir = join(root, 'tmp', 'performance', 'production-ui')
const userDataDir = join(workDir, 'user-data')
const verbose = process.argv.includes('--verbose')

function log(message) {
  if (verbose) process.stderr.write(`[ui-perf] ${message}\n`)
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function summarize(values) {
  return {
    minMs: round(Math.min(...values)),
    p50Ms: round(percentile(values, 0.5)),
    p95Ms: round(percentile(values, 0.95)),
    maxMs: round(Math.max(...values)),
    meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    if (this.socket.readyState === WebSocket.CLOSED) {
      throw new Error('CDP WebSocket closed before it became ready.')
    }
    await Promise.race([
      new Promise((resolvePromise, reject) => {
        this.socket.addEventListener('open', resolvePromise, { once: true })
        this.socket.addEventListener('error', reject, { once: true })
        this.socket.addEventListener('close', () => reject(new Error('CDP WebSocket closed while opening.')), { once: true })
      }),
      wait(10_000).then(() => {
        throw new Error('Timed out opening the CDP WebSocket.')
      })
    ])
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result ?? {})
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('CDP WebSocket closed before the command completed.'))
      }
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}: CDP WebSocket is not open.`))
    }
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for CDP command ${method}.`))
      }, 15_000)
      this.pending.set(id, { resolve: resolvePromise, reject, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function discoverRenderer(port, timeoutMs = 30_000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const renderer = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (renderer) return renderer
    } catch {
      // The debugging endpoint is not ready yet.
    }
    await wait(50)
  }
  throw new Error(`Electron renderer did not expose CDP on port ${port} within ${timeoutMs} ms.`)
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Renderer evaluation failed.')
  return result.result?.value
}

async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (await evaluate(client, expression)) return
    await wait(25)
  }
  throw new Error(`Timed out waiting for renderer condition: ${expression}`)
}

async function clickButton(client, label) {
  const encoded = JSON.stringify(label)
  const clicked = await evaluate(
    client,
    `(() => { const label = ${encoded}; const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label); if (!button) return false; button.click(); return true })()`
  )
  if (!clicked) throw new Error(`Could not find button "${label}".`)
}

async function captureScreenshot(client, outputPath) {
  await client.send('Page.enable')
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, Buffer.from(result.data, 'base64'))
}

async function verifyNoveltyDiagnostics(client) {
  const plan = {
    chapterTitle: 'Electron 诊断回归章',
    chapterGoal: '沿用已有门禁规则脱困',
    conflictToPush: '禁止新增救命条款',
    characterBeats: '', foreshadowingToUse: '', foreshadowingNotToReveal: '', endingHook: '',
    readerEmotionTarget: '紧张', estimatedWordCount: '3000', openingContinuationBeat: '',
    carriedPhysicalState: '', carriedEmotionalState: '', unresolvedMicroTensions: '', forbiddenResets: '',
    allowedNovelty: '无', forbiddenNovelty: '禁止新增救命规则、系统权限、管理员和重大设定'
  }
  const requestJson = JSON.stringify({ plan })
  return evaluate(client, `(async () => {
    const { plan } = ${requestJson};
    const benignText = '管理员工位旁的灯坏了。这里没有附加条款，也不存在临时权限。她走进源头书店。';
    const riskyText = '门禁即将处决主角，系统面板突然弹出附加条款：主角获得临时权限，立即强制放行并脱困。';
    const benign = await window.novelDirector.diagnostics.auditNovelty({ generatedText: benignText, context: '', chapterPlan: plan });
    const risky = await window.novelDirector.diagnostics.auditNovelty({ generatedText: riskyText, context: '已知规则：门禁倒计时结束前必须离开。', chapterPlan: plan });
    const loaded = await window.novelDirector.data.load();
    const quality = await window.novelDirector.diagnostics.evaluateQualityGate({
      settings: loaded.data.settings,
      projectId: 'perf-project', jobId: 'perf-job', chapterId: 'perf-chapter-24', draftId: 'perf-draft',
      chapterDraft: { title: '诊断回归章', body: riskyText.repeat(40) },
      context: '已知规则：门禁倒计时结束前必须离开。', chapterPlan: plan,
      consistencyReports: [], noveltyAuditResult: risky, characterStateFacts: [], characters: []
    });
    const count = (audit) => ['newNamedCharacters','newWorldRules','newSystemMechanics','newOrganizationsOrRanks','majorLoreReveals','suspiciousDeusExRules','untracedNames'].reduce((sum, key) => sum + audit[key].length, 0);
    return {
      benignSeverity: benign.severity,
      benignFindingCount: count(benign),
      riskySeverity: risky.severity,
      riskyDeusExCount: risky.suspiciousDeusExRules.length,
      qualityNoveltyIssueTypes: quality.issues.filter((issue) => ['unauthorized_new_rule','unauthorized_new_organization','unauthorized_lore_reveal','deus_ex_rule_patch'].includes(issue.type)).map((issue) => issue.type)
    };
  })()`)
}

async function closeProcess(child, client) {
  try {
    // Chromium often closes the CDP socket before replying to Browser.close.
    // Bound the await so an unresolved CDP promise cannot let Node exit early.
    if (client) await Promise.race([client.send('Browser.close').catch(() => undefined), wait(250)])
  } catch {
    // Fall through to terminating the owned process.
  }
  client?.close()
  const exited = child.exitCode !== null
    ? true
    : await Promise.race([
        new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
        wait(5_000).then(() => false)
      ])
  if (!exited && child.exitCode === null) child.kill()
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolvePromise) => child.once('exit', resolvePromise)),
      wait(5_000)
    ])
  }
  if (child.exitCode === null) throw new Error(`Electron process ${child.pid} did not exit after benchmark cleanup.`)
}

async function launchElectron(port) {
  const logChunks = []
  const electronArgs = [`--remote-debugging-port=${port}`]
  if (process.argv.includes('--disable-gpu')) {
    electronArgs.push('--disable-gpu', '--disable-gpu-compositing')
  }
  electronArgs.push(root)
  const child = spawn(electronExecutable, electronArgs, {
    cwd: root,
    env: {
      ...process.env,
      NOVEL_DIRECTOR_SMOKE_USER_DATA: userDataDir,
      ELECTRON_ENABLE_LOGGING: '0'
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => logChunks.push(String(chunk)))
  child.stderr.on('data', (chunk) => logChunks.push(String(chunk)))
  return { child, logChunks }
}

async function bootstrapData() {
  log('preparing isolated synthetic userData')
  await rm(userDataDir, { recursive: true, force: true })
  await mkdir(userDataDir, { recursive: true })
  const now = new Date().toISOString()
  const chapters = Array.from({ length: 24 }, (_, index) => ({
    id: `perf-chapter-${index + 1}`,
    projectId: 'perf-project',
    order: index + 1,
    title: `性能样例第 ${index + 1} 章`,
    body: `这是隔离性能样例第 ${index + 1} 章。`.repeat(120),
    summary: `第 ${index + 1} 章摘要。`,
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '走廊尽头的灯熄灭了。',
    riskWarnings: '',
    includedInStageSummary: index < 18,
    createdAt: now,
    updatedAt: now
  }))
  const fixture = {
    schemaVersion: 3,
    projects: [{
      id: 'perf-project',
      name: '隔离性能基线项目',
      genre: '悬疑',
      description: '仅用于本机生产构建性能测量的虚构数据。',
      targetReaders: '成年读者',
      coreAppeal: '连续调查与规则推理',
      style: '克制、清晰',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    }],
    chapters,
    characters: Array.from({ length: 16 }, (_, index) => ({
      id: `perf-character-${index + 1}`,
      projectId: 'perf-project',
      name: `样例角色${index + 1}`,
      role: index === 0 ? '主角' : '配角',
      roleFunction: '', surfaceGoal: '', deepNeed: '', coreFear: '', decisionLogic: '', abilitiesAndResources: '', weaknessAndCost: '', relationshipTension: '', futureHooks: '',
      createdAt: now,
      updatedAt: now
    })),
    foreshadowings: Array.from({ length: 36 }, (_, index) => ({
      id: `perf-foreshadowing-${index + 1}`,
      projectId: 'perf-project',
      title: `样例伏笔 ${index + 1}`,
      description: '走廊记录里有一处不一致。',
      expectedPayoff: '后续调查中解释。',
      status: 'planted',
      weight: index % 4 === 0 ? 'high' : 'medium',
      treatmentMode: index % 5 === 0 ? 'pause' : 'hint',
      relatedChapterIds: [],
      createdAt: now,
      updatedAt: now
    })),
    timelineEvents: Array.from({ length: 20 }, (_, index) => ({
      id: `perf-timeline-${index + 1}`,
      projectId: 'perf-project',
      title: `时间锚点 ${index + 1}`,
      chapterOrder: index + 1,
      result: '调查继续。',
      downstreamImpact: '影响后续路线。',
      createdAt: now,
      updatedAt: now
    })),
    memoryUpdateCandidates: [{
      id: 'perf-memory-candidate-1',
      projectId: 'perf-project',
      jobId: 'perf-job-24',
      type: 'foreshadowing',
      targetId: null,
      proposedPatch: {
        schemaVersion: 1,
        kind: 'foreshadowing_create',
        summary: '走廊尽头的熄灯规律可能成为伏笔',
        sourceChapterOrder: 24,
        warnings: [],
        candidate: {
          title: '走廊尽头的熄灯规律',
          description: '每次调查接近关键证据时，走廊尽头的灯都会熄灭。',
          firstChapterOrder: 24,
          suggestedWeight: 'medium',
          expectedPayoff: '后续调查中验证熄灯与监控盲区的关系。',
          relatedCharacterIds: ['perf-character-1'],
          recommendedTreatmentMode: 'hint',
          notes: '隔离性能样例。'
        }
      },
      evidence: '走廊尽头的灯在主角接近档案柜时再次熄灭。',
      confidence: 0.76,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }],
    characterStateChangeCandidates: [{
      id: 'perf-state-candidate-1',
      projectId: 'perf-project',
      jobId: 'perf-job-24',
      characterId: 'perf-character-1',
      chapterId: 'perf-chapter-24',
      chapterOrder: 24,
      candidateType: 'create_fact',
      targetFactId: null,
      proposedFact: {
        id: 'perf-state-fact-1',
        projectId: 'perf-project',
        characterId: 'perf-character-1',
        category: 'physical',
        key: 'left-hand-burn',
        label: '左手灼伤',
        valueType: 'text',
        value: '左手掌有新鲜灼伤，握持重物时疼痛。',
        unit: '',
        linkedCardFields: ['weaknessAndCost', 'abilitiesAndResources'],
        trackingLevel: 'hard',
        promptPolicy: 'when_relevant',
        status: 'active',
        sourceChapterId: 'perf-chapter-24',
        sourceChapterOrder: 24,
        evidence: '她松开门把，左手掌已经烫出一片红痕。',
        confidence: 0.89,
        createdAt: now,
        updatedAt: now
      },
      proposedTransaction: null,
      beforeValue: null,
      afterValue: '左手掌有新鲜灼伤，握持重物时疼痛。',
      evidence: '她松开门把，左手掌已经烫出一片红痕。',
      confidence: 0.89,
      riskLevel: 'high',
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }],
    settings: {}
  }
  await writeFile(join(userDataDir, 'novel-director-data.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')

  const port = await findFreePort()
  log(`bootstrapping SQLite on CDP port ${port}`)
  const { child, logChunks } = await launchElectron(port)
  let client = null
  try {
    const renderer = await discoverRenderer(port)
    client = new CdpClient(renderer.webSocketDebuggerUrl)
    await client.open()
    await client.send('Runtime.enable')
    await waitFor(client, `Boolean(window.novelDirector?.data?.load && [...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入'))`, 30_000)
    log('bootstrap renderer ready')
  } catch (error) {
    throw new Error(`${error.message}\nElectron output:\n${logChunks.join('')}`)
  } finally {
    await closeProcess(child, client)
  }
}

async function measureRun(runNumber, screenshotDir = null) {
  const port = await findFreePort()
  const startedAt = performance.now()
  const { child, logChunks } = await launchElectron(port)
  log(`run ${runNumber}: launched process ${child.pid} on CDP port ${port}`)
  let client = null
  try {
    const renderer = await discoverRenderer(port)
    client = new CdpClient(renderer.webSocketDebuggerUrl)
    await client.open()
    await client.send('Runtime.enable')
    await client.send('Performance.enable')

    await waitFor(client, `Boolean(window.novelDirector?.data?.load && [...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入') && !document.querySelector('.loading-screen,.view-loading'))`, 30_000)
    log(`run ${runNumber}: renderer interactive`)
    const interactiveMs = performance.now() - startedAt
    if (screenshotDir) {
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '01-projects.png'))
    }

    const workbenchStartedAt = performance.now()
    await clickButton(client, '进入')
    await waitFor(client, `Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`)
    log(`run ${runNumber}: project workbench ready`)
    const projectWorkbenchMs = performance.now() - workbenchStartedAt
    if (screenshotDir) {
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '02-dashboard.png'))

      await clickButton(client, '决策收件箱')
      await waitFor(client, `Boolean(document.querySelector('.decision-inbox-view') && !document.querySelector('.view-loading'))`, 30_000)
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '02b-decision-inbox.png'))
    }

    const pipelineStartedAt = performance.now()
    await clickButton(client, '生产流水线')
    await waitFor(client, `Boolean(document.querySelector('.generation-view') && !document.querySelector('.view-loading'))`, 30_000)
    log(`run ${runNumber}: first pipeline ready`)
    const firstPipelineMs = performance.now() - pipelineStartedAt
    if (screenshotDir) {
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '03-pipeline.png'))
    }

    await clickButton(client, '工作台')
    await waitFor(client, `Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`)
    const warmPipelineStartedAt = performance.now()
    await clickButton(client, '生产流水线')
    await waitFor(client, `Boolean(document.querySelector('.generation-view') && !document.querySelector('.view-loading'))`)
    log(`run ${runNumber}: warm pipeline ready`)
    const warmPipelineMs = performance.now() - warmPipelineStartedAt

    const promptStartedAt = performance.now()
    await clickButton(client, 'Prompt 构建器')
    await waitFor(client, `Boolean(document.querySelector('.prompt-view') && !document.querySelector('.view-loading'))`, 30_000)
    log(`run ${runNumber}: prompt builder ready`)
    const firstPromptBuilderMs = performance.now() - promptStartedAt
    if (screenshotDir) {
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '04-prompt-builder.png'))
    }

    const metrics = await client.send('Performance.getMetrics')
    const metricMap = Object.fromEntries((metrics.metrics ?? []).map((metric) => [metric.name, metric.value]))
    const resources = await evaluate(client, `performance.getEntriesByType('resource').filter((item) => item.initiatorType === 'script').map((item) => ({ name: item.name.split('/').pop(), durationMs: item.duration, transferSize: item.transferSize }))`)
    const browserVersion = await client.send('Browser.getVersion')
    const noveltyDiagnosticsVerification = await verifyNoveltyDiagnostics(client)
    if (
      noveltyDiagnosticsVerification.benignSeverity !== 'pass' ||
      noveltyDiagnosticsVerification.benignFindingCount !== 0 ||
      noveltyDiagnosticsVerification.riskySeverity !== 'fail' ||
      noveltyDiagnosticsVerification.riskyDeusExCount < 1 ||
      !noveltyDiagnosticsVerification.qualityNoveltyIssueTypes.includes('deus_ex_rule_patch')
    ) {
      throw new Error(`Electron Novelty/Quality chain verification failed: ${JSON.stringify(noveltyDiagnosticsVerification)}`)
    }
    if (screenshotDir) {
      await clickButton(client, '章节')
      await waitFor(client, `Boolean(document.querySelector('.chapters-view') && !document.querySelector('.view-loading'))`, 30_000)
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '05-chapters.png'))

      await clickButton(client, '修订工作台')
      await waitFor(client, `Boolean(document.querySelector('.revision-view') && !document.querySelector('.view-loading'))`, 30_000)
      await wait(100)
      await captureScreenshot(client, join(screenshotDir, '06-revision.png'))
    }
    return {
      runNumber,
      timings: {
        processColdToRendererInteractiveMs: round(interactiveMs),
        projectWorkbenchRenderMs: round(projectWorkbenchMs),
        firstGenerationPipelineMs: round(firstPipelineMs),
        warmGenerationPipelineMs: round(warmPipelineMs),
        firstPromptBuilderMs: round(firstPromptBuilderMs)
      },
      rendererMemoryObservation: {
        jsHeapUsedBytes: metricMap.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: metricMap.JSHeapTotalSize ?? null,
        nodes: metricMap.Nodes ?? null
      },
      browserVersion,
      noveltyDiagnosticsVerification,
      loadedScriptResources: resources
    }
  } catch (error) {
    throw new Error(`${error.message}\nElectron output:\n${logChunks.join('')}`)
  } finally {
    await closeProcess(child, client)
  }
}

async function main() {
  if (!existsSync(join(root, 'out', 'main', 'index.js')) || !existsSync(join(root, 'out', 'renderer', 'index.html'))) {
    throw new Error('Production build output is missing. Run npm.cmd run build before this benchmark.')
  }
  if (!existsSync(electronExecutable)) throw new Error(`Electron executable not found at ${electronExecutable}`)

  await mkdir(workDir, { recursive: true })
  await bootstrapData()
  log('bootstrap complete')
  const runCount = Number(argumentValue('--runs') ?? 5)
  const screenshotDirArgument = argumentValue('--screenshots')
  const screenshotDir = screenshotDirArgument ? resolve(root, screenshotDirArgument) : null
  const runs = []
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await measureRun(index + 1, index === 0 ? screenshotDir : null))
  }
  log('all measured runs complete')
  const timingNames = Object.keys(runs[0].timings)
  const aggregate = Object.fromEntries(
    timingNames.map((name) => [name, summarize(runs.map((run) => run.timings[name]))])
  )
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const report = {
    benchmark: 'production-electron-ui',
    measuredAt: new Date().toISOString(),
    buildMode: 'production electron-vite output loaded by the real Electron main/preload/renderer processes',
    readyDefinition: 'React has loaded persisted isolated data, preload data.load exists, project row is visible and clickable, and no loading boundary remains.',
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron ?? 'unknown',
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem()
    },
    methodology: {
      runCount,
      data: 'synthetic fixture in isolated NOVEL_DIRECTOR_SMOKE_USER_DATA; bootstrapped before measurement',
      coldMeaning: 'new Electron process and renderer for every run; OS disk cache is not flushed',
      memory: 'CDP renderer JS heap observation only; not a whole-process peak and not a hard conclusion',
      cleanup: 'each owned Electron process receives Browser.close and is verified exited before the next run'
    },
    aggregate,
    runs
  }
  const outputPath = resolve(root, argumentValue('--output') ?? 'tmp/performance/production-ui.json')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report.aggregate, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
