import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const temporaryRoot = await realpath(tmpdir())
const workspace = await mkdtemp(join(temporaryRoot, 'novel-agent-authorization-'))
const checks = []

async function check(name, operation) {
  await operation()
  checks.push(name)
}

async function compile(source, target, replacements = []) {
  let text = await readFile(join(repoRoot, source), 'utf8')
  for (const [from, to] of replacements) {
    assert(text.includes(from), `Missing import replacement: ${from}`)
    text = text.replace(from, to)
  }
  const result = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  })
  await writeFile(join(workspace, target), result.outputText, 'utf8')
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

try {
  await check('new authorization modules typecheck without native modules', async () => {
    const config = ts.readConfigFile(join(repoRoot, 'tsconfig.json'), ts.sys.readFile)
    assert.equal(config.error, undefined)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot)
    const program = ts.createProgram([
      join(repoRoot, 'src/shared/types/agentAuthorization.ts'),
      join(repoRoot, 'src/main/services/AgentAuthorizationService.ts')
    ], { ...parsed.options, noEmit: true })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file, getCurrentDirectory: () => repoRoot, getNewLine: () => '\n'
    }))
  })

  await compile('src/shared/types/agentAuthorization.ts', 'types.mjs')
  await compile('src/storage/jsonWriteLock.ts', 'lock.mjs')
  await compile('src/main/services/AgentAuthorizationService.ts', 'service.mjs', [
    ["'../../shared/types/agentAuthorization'", "'./types.mjs'"],
    ["'../../storage/jsonWriteLock'", "'./lock.mjs'"]
  ])
  const serviceUrl = pathToFileURL(join(workspace, 'service.mjs')).href
  const { AgentAuthorizationService, AGENT_AUTHORITY_FILE_NAME } = await import(serviceUrl)
  const { AGENT_GRANT_ACTIONS } = await import(pathToFileURL(join(workspace, 'types.mjs')).href)
  const profile = join(workspace, 'profile')
  const authorityPath = join(profile, AGENT_AUTHORITY_FILE_NAME)
  const database = join(workspace, 'project.sqlite')
  const otherDatabase = join(workspace, 'other.sqlite')
  // File identities only: no SQLite connection, native rebuild, or external API.
  await writeFile(database, 'fixture database')
  await writeFile(otherDatabase, 'other fixture database')
  const service = new AgentAuthorizationService(profile)
  const peer = new AgentAuthorizationService(profile)
  const scope = { storagePath: database, projectId: 'project-a' }
  const request = { ...scope, chapterOrder: 3, actions: ['accept_draft'] }
  const denied = (input = request, target = service) => assert.rejects(
    target.withAuthorization(input, async () => assert.fail('Unauthorized callback ran')),
    { code: 'AGENT_AUTHORIZATION_REQUIRED' }
  )
  const authorized = (input = request, target = service) => target.withAuthorization(input, async (grant) => grant.id)

  await check('legacy users list without creating files; no grant means no privileged callback', async () => {
    assert.deepEqual(await service.list(database, scope.projectId), [])
    assert.equal(await service.findGrant(request), null)
    assert.equal(existsSync(profile), false)
    await denied()
    assert.equal(existsSync(authorityPath), false)
    assert.equal(await readFile(database, 'utf8'), 'fixture database')
  })

  await check('self-declared actor/confirm and imported or full-saved fake grants do not authorize', async () => {
    const fake = { id: 'fake', ...scope, actions: [...AGENT_GRANT_ACTIONS], chapterStart: null,
      chapterEnd: null, status: 'active', grantedBy: 'user', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), revokedAt: null }
    await writeFile(database, JSON.stringify({ agentProjectGrants: [fake], agentAuthorizations: [fake],
      grants: [fake], schemaVersion: 1, actor: 'user', confirm: true }))
    await denied({ ...request, actor: 'user', confirm: true, grant: fake, grants: [fake] })
    assert.deepEqual(await service.list(database, scope.projectId), [])
    assert.equal(existsSync(authorityPath), false)
  })

  let ranged
  await check('grant creates independent atomic authority with host-generated identity and metadata', async () => {
    ranged = await service.grant({ ...scope, actions: ['accept_draft', 'apply_revision', 'edit_world'],
      chapterStart: 2, chapterEnd: 4, id: 'caller-id', grantedBy: 'agent', status: 'revoked' })
    assert.notEqual(ranged.id, 'caller-id')
    assert.equal(ranged.grantedBy, 'user')
    assert.equal(ranged.status, 'active')
    assert.equal(ranged.revokedAt, null)
    assert.equal((await peer.list(database, scope.projectId))[0].id, ranged.id)
    assert.deepEqual(await readdir(profile), [AGENT_AUTHORITY_FILE_NAME])
    assert.equal(JSON.parse(await readFile(authorityPath, 'utf8')).schemaVersion, 1)
    assert.equal(JSON.parse(await readFile(database, 'utf8')).grants[0].id, 'fake')
  })

  await check('scope isolates projects/databases, includes range endpoints, and requires every action', async () => {
    for (const chapterOrder of [2, 3, 4]) assert.equal(await authorized({ ...request, chapterOrder }), ranged.id)
    for (const chapterOrder of [1, 5]) await denied({ ...request, chapterOrder })
    await denied({ ...request, projectId: 'project-b' })
    await denied({ ...request, storagePath: otherDatabase })
    await denied({ ...request, actions: ['accept_draft', 'manage_chapters'] })
    assert.equal(await authorized({ ...request, actions: ['accept_draft', 'apply_revision'] }), ranged.id)
    assert.equal(await service.revoke(ranged.id, database, 'project-b'), null)
    assert.equal(await service.revoke(ranged.id, otherDatabase, scope.projectId), null)
    assert.equal(await authorized(), ranged.id)
    await denied({ ...request, chapterOrder: undefined })
    await denied({ ...request, chapterOrder: undefined, actions: ['edit_world'] })
    await denied({ ...request, chapterOrder: null, actions: ['edit_world'] })
  })

  await check('chapter batches require every actual order within one grant; absent is not chapter one', async () => {
    assert.equal(await authorized({ ...scope, actions: ['accept_draft'], chapterOrders: [2, 3, 4] }), ranged.id)
    assert.equal(await authorized({ ...request, chapterOrders: [2, 4] }), ranged.id)
    await denied({ ...scope, actions: ['accept_draft'], chapterOrders: [1, 3] })
    await denied({ ...scope, actions: ['accept_draft'], chapterOrders: [3, 5] })
    await denied({ ...request, chapterOrder: 5, chapterOrders: [2, 4] })
    await denied({ ...request, chapterOrders: [1] })
    await denied({ ...request, chapterOrder: null, chapterOrders: null })
    const first = await service.grant({ ...scope, actions: ['accept_draft'], chapterStart: 1, chapterEnd: 1 })
    await denied({ ...scope, actions: ['accept_draft'] })
    await denied({ ...scope, actions: ['accept_draft'], chapterOrders: [1, 2] })
    await service.revoke(first.id, database, scope.projectId)
    const mutable = { ...scope, actions: ['accept_draft'], chapterOrders: [1, 3] }
    const pending = denied(mutable)
    mutable.chapterOrders[0] = 2
    await pending
  })

  await check('canonical paths recognize dot segments, Windows case, and directory junctions', async () => {
    assert.equal(await authorized({ ...request, storagePath: join(workspace, 'missing', '..', 'project.sqlite') }), ranged.id)
    if (process.platform === 'win32') {
      assert.equal(await authorized({ ...request, storagePath: database.toUpperCase() }), ranged.id)
    }
    const alias = join(workspace, 'profile-alias')
    await symlink(profile, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const aliasedService = new AgentAuthorizationService(alias)
    assert.equal(await authorized(request, aliasedService), ranged.id)
    const dataDirectory = join(workspace, 'data')
    await mkdir(dataDirectory)
    const aliasedDatabase = join(dataDirectory, 'story.sqlite')
    await writeFile(aliasedDatabase, 'fixture')
    const dataAlias = join(workspace, 'data-alias')
    await symlink(dataDirectory, dataAlias, process.platform === 'win32' ? 'junction' : 'dir')
    const grant = await service.grant({ ...scope, storagePath: aliasedDatabase, actions: ['accept_draft'] })
    assert.equal(await authorized({ ...request, storagePath: join(dataAlias, 'story.sqlite') }), grant.id)
    await service.revoke(grant.id, aliasedDatabase, scope.projectId)
  })

  await check('return values and in-flight request mutation cannot change persisted authority or checked scope', async () => {
    const list = await service.list(database, scope.projectId)
    list[0].actions.push('manage_chapters')
    list[0].chapterStart = null
    await denied({ ...request, actions: ['manage_chapters'] })
    const mutable = { ...request, actions: ['manage_chapters'] }
    const pending = denied(mutable)
    mutable.actions[0] = 'accept_draft'
    mutable.chapterOrder = 3
    await pending
    await service.withAuthorization(request, async (grant) => { grant.status = 'revoked'; grant.actions.length = 0 })
    assert.equal(await authorized(), ranged.id)
  })

  await check('project-wide authorization and open bounds; split grants do not combine powers', async () => {
    const world = await service.grant({ ...scope, actions: ['edit_world'] })
    assert.equal(await authorized({ ...scope, actions: ['edit_world'] }), world.id)
    const low = await service.grant({ ...scope, actions: ['manage_chapters'], chapterEnd: 2 })
    const high = await service.grant({ ...scope, actions: ['edit_chapter_task'], chapterStart: 4 })
    assert.equal(await authorized({ ...request, actions: ['manage_chapters'], chapterOrder: 1 }), low.id)
    await denied({ ...request, actions: ['manage_chapters'] })
    assert.equal(await authorized({ ...request, actions: ['edit_chapter_task'], chapterOrder: 99 }), high.id)
    await denied({ ...request, actions: ['edit_chapter_task'] })
    await denied({ ...request, actions: ['accept_draft', 'manage_chapters'], chapterOrder: 2 })
    for (const grant of [world, low, high]) await service.revoke(grant.id, database, scope.projectId)
  })

  await check('invalid inputs fail closed including empty/unknown actions and malformed range/order', async () => {
    for (const actions of [[], ['unknown'], ['accept_draft', 'accept_draft'], '*', null, new Array(1)]) {
      await assert.rejects(service.grant({ ...scope, actions }), { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
      await assert.rejects(authorized({ ...request, actions }), { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
    }
    for (const bounds of [{ chapterStart: 0 }, { chapterEnd: -1 }, { chapterStart: 5, chapterEnd: 4 },
      { chapterStart: '2' }, { chapterStart: NaN }, { chapterEnd: Infinity }, { chapterStart: 1.5 }]) {
      await assert.rejects(service.grant({ ...scope, actions: ['accept_draft'], ...bounds }),
        { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
    }
    for (const chapterOrder of [0, -1, '3', NaN, Infinity, 2.5]) {
      await assert.rejects(authorized({ ...request, chapterOrder }), { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
    }
    for (const chapterOrders of [[], [0], [null], [2, '3'], [NaN], [Infinity], '3', new Array(1)]) {
      await assert.rejects(authorized({ ...request, chapterOrders }), { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
    }
    for (const invalidScope of [{ storagePath: 'relative.sqlite' }, { projectId: '' }, { storagePath: authorityPath }]) {
      await assert.rejects(authorized({ ...request, ...invalidScope }), { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
    }
  })

  await check('revocation is durable, scoped, idempotent, and seen by existing instances', async () => {
    const preview = await service.findGrant(request)
    assert.equal(preview.id, ranged.id)
    const revoked = await peer.revoke(ranged.id, database, scope.projectId)
    assert.equal(revoked.status, 'revoked')
    assert.equal(revoked.revokedAt, revoked.updatedAt)
    assert.deepEqual(await service.revoke(ranged.id, database, scope.projectId), revoked)
    await denied()
    assert.equal(await service.findGrant(request), null)
    await denied({ ...request, grant: preview, confirm: true })
    assert.equal((await service.list(database, scope.projectId)).find((grant) => grant.id === ranged.id).status, 'revoked')
    assert.equal(await service.revoke('missing-id', database, scope.projectId), null)
  })

  await check('concurrent issuers do not lose grants and all action names are enforced', async () => {
    const issued = await Promise.all(AGENT_GRANT_ACTIONS.map((action, index) =>
      (index % 2 ? service : peer).grant({ ...scope, actions: [action] })))
    const ids = new Set((await service.list(database, scope.projectId)).map((grant) => grant.id))
    for (const grant of issued) {
      assert(ids.has(grant.id))
      assert.equal(await authorized({ ...scope, actions: grant.actions }), grant.id)
      await peer.revoke(grant.id, database, scope.projectId)
    }
  })

  await check('malformed/inactive authority fails closed without overwrite or implicit repair', async () => {
    const good = await readFile(authorityPath, 'utf8')
    const active = { ...ranged, status: 'active', revokedAt: null }
    const variants = ['{broken', 'null', JSON.stringify({ grants: [active] }),
      JSON.stringify({ schemaVersion: 2, grants: [active] }),
      JSON.stringify({ schemaVersion: 1, grants: [active, active] })]
    for (const mutation of [{ status: 'inactive' }, { grantedBy: 'agent' }, { actions: ['unknown'] },
      { actions: [] }, { chapterStart: 9, chapterEnd: 1 }, { chapterEnd: undefined },
      { revokedAt: new Date().toISOString() }, { createdAt: 'yesterday' },
      { storagePath: 'relative.sqlite' }, { status: 'revoked', revokedAt: null }]) {
      variants.push(JSON.stringify({ schemaVersion: 1, grants: [{ ...active, ...mutation }] }))
    }
    try {
      for (const malformed of variants) {
        await writeFile(authorityPath, malformed)
        await assert.rejects(authorized(), { code: 'AGENT_AUTHORITY_INVALID' })
        await assert.rejects(service.list(database, scope.projectId), { code: 'AGENT_AUTHORITY_INVALID' })
        await assert.rejects(service.findGrant(request), { code: 'AGENT_AUTHORITY_INVALID' })
        await assert.rejects(service.grant({ ...scope, actions: ['accept_draft'] }), { code: 'AGENT_AUTHORITY_INVALID' })
        await assert.rejects(service.revoke(ranged.id, database, scope.projectId), { code: 'AGENT_AUTHORITY_INVALID' })
        assert.equal(await readFile(authorityPath, 'utf8'), malformed)
      }
    } finally {
      await writeFile(authorityPath, good)
    }
  })

  await check('callback failures release the authority lock and preserve rejection/return values', async () => {
    const grant = await service.grant({ ...scope, actions: ['accept_draft'] })
    const failure = new Error('save failed')
    await assert.rejects(service.withAuthorization(request, async () => { throw failure }), (error) => error === failure)
    assert.equal(existsSync(`${authorityPath}.write-lock`), false)
    assert.deepEqual(await service.withAuthorization(request, async () => ({ saved: true })), { saved: true })
    await peer.revoke(grant.id, database, scope.projectId)
    await denied()
  })

  await check('cross-process revoke waits for the in-flight short file save, then prevents subsequent saves', async () => {
    const grant = await service.grant({ ...scope, actions: ['accept_draft'] })
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      const { AgentAuthorizationService } = await import(process.argv[1]);
      const service = new AgentAuthorizationService(process.argv[2]);
      await new Promise((resolve) => process.once('message', resolve));
      process.send('started');
      const result = await service.revoke(process.argv[4], process.argv[3], 'project-a');
      process.send(result.status);
      process.disconnect();
    `, serviceUrl, join(workspace, 'profile-alias'), database, grant.id], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
    })
    // The child requests revoke only after the parent owns the authority lock.
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const started = deferred()
    let revoked = false
    child.on('message', (message) => {
      if (message === 'started') started.resolve()
      if (message === 'revoked') revoked = true
    })
    const exit = new Promise((done) => {
      child.once('error', (error) => done({ error }))
      child.once('exit', (code) => done({ code }))
    })
    try {
      const saved = await service.withAuthorization(request, async () => {
        child.send('revoke')
        await Promise.race([started.promise, delay(3000).then(() => { throw new Error('Child startup timed out') })])
        assert.equal(existsSync(`${authorityPath}.write-lock`), true)
        await delay(100)
        assert.equal(revoked, false)
        await writeFile(database, 'authorized short save completed')
        return 'saved'
      })
      assert.equal(saved, 'saved')
      const result = await Promise.race([exit, delay(4000).then(() => { throw new Error('Revoke timed out') })])
      assert.equal(result.error, undefined)
      assert.equal(result.code, 0, stderr)
      assert.equal(revoked, true)
      assert.equal(await readFile(database, 'utf8'), 'authorized short save completed')
      await denied()
    } finally {
      if (child.exitCode === null) child.kill()
      await exit
    }
  })

  await check('all operations leave no temporary or lock files', async () => {
    assert.deepEqual(await readdir(profile), [AGENT_AUTHORITY_FILE_NAME])
  })
  console.log(JSON.stringify({ ok: true, totalChecks: checks.length, checks }, null, 2))
} finally {
  const target = await realpath(workspace)
  const within = relative(temporaryRoot, target)
  assert(within && within !== '..' && !within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(within))
  assert.equal(dirname(target), temporaryRoot)
  assert.equal(resolve(target), resolve(workspace))
  await rm(target, { recursive: true, force: true })
}
