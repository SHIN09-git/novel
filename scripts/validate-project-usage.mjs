import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createLongNovelFixture, LONG_NOVEL_PROJECT_ID as book, LONG_NOVEL_SECOND_PROJECT_ID as other } from './fixtures/long-novel-performance.mjs'
import { repoRoot } from './utils/repo-root.mjs'

const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive:true })
const work = await mkdtemp(join(tmp, 'book-usage-test-'))
try {
  const outfile = join(work, 'tests.mjs')
  const entries = ['shared/defaults','services/projectUsageHistory','services/ProjectUsageService','storage/projectUsageJournal',
    'storage/readProjectUsage','storage/JsonStorageService','storage/SqliteStorageService','agent/tools/AgentToolService']
  await build({ stdin:{ resolveDir:repoRoot, contents:entries.map(m => 'export * from "./src/' + m + '"').join('\n') },
    outfile, bundle:true, format:'esm',platform:'node',target:'node22',external:['electron','better-sqlite3'],logLevel:'silent' })
  const api = await import(pathToFileURL(outfile))
  const base = createLongNovelFixture(1), job = base.chapterGenerationJobs[0].id
  const trace = base.generationRunTraces[0], tpl = trace.aiCalls[1]
  const origin = 'https://meter.invalid', second = 'https://second.invalid', model = 'synthetic'
  const old = (id, input, output, attempts = 1) => ({ ...tpl, id, callId:id, provider:'compatible',model,
    usage:{promptTokens:input,completionTokens:output,totalTokens:input+output}, attempts })
  trace.aiCalls = [old('live',900,100), old('archive',8,2,2)]
  base.qualityGateReports[0].aiTelemetry = trace.aiCalls[1]
  trace.aiCalls[1].usageJournalIncomplete = true
  base.chapterCommitBundles[0].generationRunTrace = { ...trace, aiCalls:[...trace.aiCalls,old('commit-only',1,2)] }
  base.chapterGenerationJobs.push({ ...base.chapterGenerationJobs[0],id:'silent',status:'failed' })
  base.projects.find(p => p.id === book).modelRates = [
    {provider:'compatible',endpoint:origin,model,currency:'CNY',inputPerMillionTokens:1,outputPerMillionTokens:2,cachedInputPerMillionTokens:0.25},
    {provider:'compatible',endpoint:second,model,currency:'USD',inputPerMillionTokens:2,outputPerMillionTokens:4}
  ]
  const data = api.normalizeAppData(base)
  const at = (id,callId,phase,usage,extra = {}) => ({ id,callId,phase,usage,startedAt:'2026-11-11T02:00:00Z',
    provider:'compatible',model,runId:job,projectId:book,endpoint:origin,outcome:'success',...extra })
  const records = [at('a1','live','writing',undefined,{outcome:'failed'}),
    at('a2','live','writing',{promptTokens:100,completionTokens:20,cachedPromptTokens:25},
      {endpoint:'https://private:DO_NOT_STORE@meter.invalid/v1?token=DO_NOT_STORE',providerRequestId:'remote-2', prompt:'NEVER_STORE_PROSE'}),
    at('r','unaccepted','revision',{promptTokens:10,completionTokens:5},{endpoint:second,runId:'independent-revision'}),
    at('cli','subscription','other',undefined,{provider:'codex_cli',endpoint:''}),
    at('q1','format','review',{promptTokens:40,completionTokens:4,cachedPromptTokens:0}),
    at('q2','format','review',{promptTokens:40,completionTokens:8,cachedPromptTokens:40}),
    at('partial','unpriced','planning',{totalTokens:7},{model:'no-rate'})]
  for (const [ext,Service] of [['json',api.JsonStorageService],['sqlite',api.SqliteStorageService]]) {
    const dir = join(work,ext); await mkdir(dir)
    const path = join(dir,'novel-director-data.'+ext), storage = new Service(path)
    try {
      await storage.save(data)
      const rev = (await storage.loadSnapshot()).revision
      const journal = api.projectUsagePath(path,book)
      const empty = await api.readProjectUsage(storage,other)
      assert.equal(empty.totals.tokens.totalTokens,null)
      assert.equal(empty.totals.requests,0)
      await assert.rejects(readdir(dirname(journal)), { code:'ENOENT' })
      await Promise.all([api.appendProjectUsageAttempts(path, records.slice(0,3)),api.appendProjectUsageAttempts(path,records.slice(3))])
      await api.appendProjectUsageAttempts(path,[records[1],at('other','live','writing',{totalTokens:9999},{projectId:other})])
      await appendFile(journal,'\n{"interrupted":', 'utf8')
      await api.appendProjectUsageAttempts(path,[records[0]])
      const report = await api.readProjectUsage(storage,book)
      const mcp = await api.AgentToolService.callTool({ name:'agent.getProjectUsage',arguments:{projectId:book,storagePath:path,userDataPath:dir} })
      assert.deepEqual(mcp.data,report)
      assert.equal(report.totals.requests,7); assert.equal(report.totals.failedRequests,1)
      assert.equal(report.totals.tokens.totalTokens,247)
      assert.equal(report.totals.tokens.reasoningTokens,null)
      assert.equal(report.totals.unknownUsageRequests,2)
      assert.equal(report.totals.partialUsageRequests,1); assert.equal(report.totals.subscriptionRequests,1)
      assert.equal(report.totals.unpricedRequests,2)
      assert.deepEqual(report.totals.costs,[{currency:'CNY',amount:0.00019525,pricedRequests:3},{currency:'USD',amount:0.00004,pricedRequests:1}])
      assert.equal(report.byPhase.find(p=>p.phase==='revision').tokens.totalTokens,15)
      assert.equal(report.coverage.legacyCalls,2)
      assert.equal(report.coverage.unreportedRequests,1)
      assert(report.warnings.some(w=>w.includes('1 次调用曾报告用量记录未完整保存')))
      assert.equal(report.coverage.legacyJobsWithoutUsage,1);assert.equal(report.coverage.invalidRecords,1)
      assert.equal(report.balance,null)
      assert.equal((await api.readProjectUsage(storage,other)).totals.tokens.totalTokens,9999)
      const estimate = await api.AgentToolService.callTool({name:'agent.estimateProjectUsage',
        arguments:{projectId:book,storagePath:path,userDataPath:dir,provider:'compatible',endpoint:origin,model,inputTokens:120,maxOutputTokens:64}})
      assert.deepEqual(estimate.data.inputTokens,{min:120,max:120})
      assert.deepEqual(estimate.data.outputTokens,{min:0,max:64}); assert.equal(estimate.data.cost.currency,'CNY')
      await assert.rejects(api.AgentToolService.callTool({name:'agent.estimateProjectUsage',arguments:{projectId:other,storagePath:path,userDataPath:dir,
        provider:'compatible',endpoint:origin,model,snapshotId:'perf-snapshot-1',maxOutputTokens:64}}),/找不到/)
      const fromSnap = await api.AgentToolService.callTool({name:'agent.estimateProjectUsage',arguments:{projectId:book,storagePath:path,userDataPath:dir,
        provider:'compatible',endpoint:origin,model,snapshotId:'perf-snapshot-1',maxOutputTokens:64}})
      assert.equal(fromSnap.data.inputBasis,'snapshot_only'); assert(fromSnap.data.inputTokens.min>100)
      const raw = await readFile(journal,'utf8')
      assert.doesNotMatch(raw,/DO_NOT_STORE|NEVER_STORE_PROSE/)
      assert.doesNotMatch(JSON.stringify([report,fromSnap]),/NEVER_STORE_PROSE|核对第1条线索/)
      assert.equal((await storage.loadSnapshot()).revision,rev, 'usage writes do not make the current manuscript stale')
      await storage.saveIfCurrent(data,rev)
      assert.deepEqual(await api.readProjectUsage(storage,book),report,'a full manuscript save cannot erase receipts')
      if (ext === 'json') {
        const sibling = new api.SqliteStorageService(join(dir, 'novel-director-data.sqlite'))
        try {
          await sibling.save(data)
          const siblingReport = await api.readProjectUsage(sibling, book)
          assert.equal(siblingReport.totals.requests, 0)
          assert.deepEqual((await api.AgentToolService.callTool({name:'agent.getProjectUsage',
            arguments:{projectId:book,storagePath:path,userDataPath:dir}})).data, report)
          const missing = join(dir, 'not-created.json')
          await assert.rejects(api.readProjectUsage(new api.JsonStorageService(missing), book), {code:'ENOENT'})
          await assert.rejects(readFile(missing), {code:'ENOENT'})
        } finally { sibling.close() }
      }
      console.log('PASS '+ext+': two projects, unaccepted work, real sends, deduplication, old/missing counts, two currencies, crash tail, MCP quotes, privacy and independent saves')
    } finally { storage.close?.() }
  }
  const history = { projectId:book,rates:data.projects[0].modelRates,finishedJobs:[],calls:[] }
  const same = {...records[1],endpoint:origin}, repeated = api.buildProjectUsageReport(history,[same,{...same,id:'other-send'}])
  assert.equal(repeated.totals.requests,2)
  assert.equal(repeated.totals.tokens.totalTokens,120)
  const ambiguous = api.buildProjectUsageReport(history,[same,{...same,usage:{promptTokens:901}}])
  assert.equal(ambiguous.totals.tokens.totalTokens,null); assert.equal(ambiguous.coverage.invalidRecords,1)
  const lateLink = api.buildProjectUsageReport({...history, finishedJobs:[job], calls:[{jobId:job, phase:'writing',
    telemetry:old('live',100,20)}]}, [{...same,runId:undefined}])
  assert.equal(lateLink.totals.tokens.totalTokens,120)
  assert.equal(lateLink.coverage.legacyJobsWithoutUsage,0)
  console.log('PASS duplicate provider receipts and conflicting counts are not billed twice')
} finally { await rm(work,{recursive:true,force:true,maxRetries:3}) }
