import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const checks = []

function check(name, ok, details = '') {
  checks.push({ name, ok, details })
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function walk(dir, files = []) {
  const full = join(root, dir)
  if (!existsSync(full)) return files
  for (const entry of readdirSync(full)) {
    const relative = join(dir, entry)
    const absolute = join(root, relative)
    const stat = statSync(absolute)
    if (stat.isDirectory()) walk(relative, files)
    else files.push(relative)
  }
  return files
}

const requiredFiles = [
  'README.md',
  'ROADMAP.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/UI_NOTES.md',
  '.github/workflows/ci.yml'
]

for (const file of requiredFiles) {
  check(`required public file exists: ${file}`, existsSync(join(root, file)))
}

const launcherBinaryName = ['Novel Director Workbench', 'exe'].join('.')

const forbiddenPaths = [
  'TODO.md',
  'UI_AUDIT.md',
  `dist-launcher/${launcherBinaryName}`,
  'ui-audit/screenshots'
]

for (const file of forbiddenPaths) {
  check(`forbidden source artifact is absent: ${file}`, !existsSync(join(root, file)))
}

const packageJson = JSON.parse(read('package.json'))
check('package.json license is MIT', packageJson.license === 'MIT')

const readme = read('README.md')
check('README mentions MIT license', /MIT License|MIT/i.test(readme))
check('README documents privacy boundary', /Privacy and Local Data Boundary/.test(readme))
check('README documents AI provider boundary', /AI Provider Setup/.test(readme) && /provider/i.test(readme))
check('README declares synthetic test data', /Synthetic Test Data/.test(readme) && /雾城测试稿/.test(readme))

const testing = read('TESTING.md')
check('TESTING declares fixture text synthetic', /synthetic test data/i.test(testing) && /雾城测试稿/.test(testing))

const launcher = read('tools/NovelDirectorLauncher.cs')
check('launcher has no developer-machine fallback path', !launcher.includes('G:' + '\\' + 'novel') && !launcher.includes('FallbackProjectPath'))

const secureCredentialsTest = read('scripts/validate-secure-credentials.mjs')
const oldProviderShapedSentinel = ['sk', 'test', 'plain', 'text', 'key', 'should', 'never', 'appear'].join('-')
check('secure credentials sentinel does not look like OpenAI key', !secureCredentialsTest.includes(oldProviderShapedSentinel))

const filesToScan = walk('.')
  .filter((file) => !file.startsWith(`node_modules${'\\'}`))
  .filter((file) => !file.startsWith(`.git${'\\'}`))
  .filter((file) => !file.startsWith(`out${'\\'}`))
  .filter((file) => !file.startsWith(`tmp${'\\'}`))
  .filter((file) => !file.startsWith(`.npm-cache${'\\'}`))
  .filter((file) => !file.startsWith(`.electron-builder-cache${'\\'}`))
  .filter((file) => !file.startsWith(`dist${'\\'}`))
  .filter((file) => !file.startsWith(`dist-launcher${'\\'}`))
  .filter((file) => !file.startsWith(`release${'\\'}`))
  .filter((file) => !file.startsWith(`releases${'\\'}`))
  .filter((file) => !/\.(png|jpg|jpeg|gif|ico|exe|dll|bin)$/i.test(file))

const suspicious = []
for (const file of filesToScan) {
  let content = ''
  try {
    content = read(file)
  } catch {
    continue
  }
  if (content.includes('G:' + '\\' + 'novel')) suspicious.push(`${file}: developer path`)
  if (/sk-[A-Za-z0-9_-]{12,}/.test(content)) suspicious.push(`${file}: OpenAI-looking token`)
  if (content.includes(launcherBinaryName)) suspicious.push(`${file}: tracked launcher binary reference`)
}

check('no public-release sensitive string patterns found', suspicious.length === 0, suspicious.join('; '))

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
