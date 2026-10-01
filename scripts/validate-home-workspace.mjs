import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'validate-home-workspace')

async function bundleState() {
  await mkdir(outDir, { recursive: true })
  const entry = join(outDir, 'entry.ts')
  const outfile = join(outDir, 'state.mjs')
  await writeFile(entry, "export * from '../../src/renderer/src/views/home/homeProjectState'\n", 'utf8')
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function project(id, overrides = {}) {
  return {
    id,
    name: `项目 ${id}`,
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastOpenedAt: null,
    ...overrides
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  const state = await bundleState()
  const latest = project('one', { name: '最新项目名', updatedAt: '2026-02-01T00:00:00.000Z', lastOpenedAt: '2026-02-02T00:00:00.000Z', remoteField: 'must survive' })
  const staleFields = { ...state.emptyProjectFields(), name: '本地编辑名', description: '只改简介' }
  const patched = state.applyProjectFields(latest, staleFields, '2026-03-01T00:00:00.000Z')
  assert.equal(patched.name, '本地编辑名')
  assert.equal(patched.remoteField, 'must survive', '编辑只覆盖可编辑字段，不能用陈旧项目对象抹掉新字段')
  assert.equal(patched.lastOpenedAt, latest.lastOpenedAt, '编辑不能覆盖最新的最近打开时间')

  const ordered = state.projectsByRecentOpen([
    project('old', { lastOpenedAt: '2026-01-03T00:00:00.000Z' }),
    project('new', { lastOpenedAt: '2026-02-03T00:00:00.000Z' }),
    project('fallback', { updatedAt: '2026-01-15T00:00:00.000Z' })
  ])
  assert.deepEqual(ordered.map((item) => item.id), ['new', 'fallback', 'old'], '项目保持最近打开优先，并兼容旧数据回退时间')
  assert(state.projectMatchesSearch(project('search', { name: '雾港来信', targetReaders: '悬疑读者' }), '悬疑'), '搜索覆盖补充项目资料')
  assert(!state.projectMatchesSearch(project('search'), '不存在'), '无匹配项目不会误显示')

  const home = await readFile(join(repoRoot, 'src/renderer/src/views/HomeView.tsx'), 'utf8')
  const css = await readFile(join(repoRoot, 'src/renderer/src/styles/views/home.css'), 'utf8')
  assert(home.includes('if (!saved.ok)') && home.includes("setView('dashboard')"), '首页只在保存成功后进入项目工作台')
  assert(home.includes('applyProjectFields(project, editingSnapshot.fields, now())'), '编辑基于保存队列中的当前项目合并字段')
  assert(home.includes('setBusyAction') && home.includes('disabled={isBusy}'), '首页为重复操作提供忙碌保护')
  assert(home.includes('导入后的打开项目') && home.includes('mergeBlocked'), '导入合并与其后的打开失败均有明确处理')
  assert(home.includes('projectMatchesSearch') && home.includes('visibleProjects'), '首页提供多项目搜索')
  assert(home.includes('FileUp') && home.includes('Pencil') && home.includes('title="编辑项目资料"'), '命令按钮使用图标和中文提示')
  assert(home.includes('revealCreateProjectForm') && home.includes('scrollIntoView') && home.includes('createProjectNameRef.current?.focus'), '标题栏新建会展开、滚动并聚焦项目名')
  assert(home.includes('busyActionRef') && home.includes('function beginAction') && home.includes('if (busyActionRef.current) return false'), '同步忙碌锁阻止同一帧重复操作')
  assert(home.includes('fieldset className="home-form-fieldset" disabled={busyAction === \'edit\'}') && home.includes('disabled={busyAction === \'create\'}'), '保存中以原生 fieldset 禁用编辑输入')
  assert((home.match(/finally \{\n\s*finishAction\(\)/g) || []).length >= 5 && home.includes('reportUnexpectedFailure'), '所有首页异步动作在异常后释放忙碌状态并显示错误')
  assert(!css.includes('linear-gradient') && css.includes('@media (max-width: 640px)'), '首页样式保持主题 token 并覆盖窄窗口布局')
  console.log(JSON.stringify({ ok: true, verified: ['recent-order', 'search', 'stale-edit-preservation', 'save-gated-navigation', 'busy-lock-and-recovery', 'create-form-focus', 'fieldset-save-lock', 'responsive-home-style'] }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
