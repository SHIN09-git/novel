import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const scanRoots = [
  'README.md',
  'ROADMAP.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'TESTING.md',
  'QUICKSTART.md',
  'PUBLIC_RELEASE_CHECKLIST.md',
  'docs',
  'scripts',
  'src'
]

const ignoredDirs = new Set([
  '.git',
  '.electron-builder-cache',
  'node_modules',
  'out',
  'release',
  'release-fixed',
  'tmp'
])

const scannedExtensions = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.json', '.md', '.css', '.html'])
const publicDocFiles = new Set([
  'README.md',
  'ROADMAP.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'TESTING.md',
  'QUICKSTART.md',
  'PUBLIC_RELEASE_CHECKLIST.md'
])

const cleanChineseTerms = [
  '简体中文',
  '路线图',
  '当前状态',
  '章节',
  '角色',
  '伏笔',
  '需要',
  '生成',
  '上下文',
  '硬设定',
  '质量门禁',
  '阶段摘要',
  '时间线',
  '错误',
  '保存',
  '导入',
  '导出',
  '修订',
  '任务',
  '预算',
  '当前',
  '项目',
  '用户',
  '安全',
  '数据',
  '路径',
  '设置',
  '确认',
  '候选',
  '正文',
  '草稿',
  '上一章',
  '下一章',
  '流水线',
  '工作台',
  '小说',
  '圣经',
  '公开',
  '安装包',
  '本地',
  '接受',
  '覆盖',
  '章节复盘',
  '角色更新',
  '伏笔更新',
  '提取失败',
  '正式修订提交',
  '未命名修订',
  '状态事实',
  '缺少章节正文草稿',
  '无法复盘',
  '无法提取角色更新',
  '无法提取伏笔更新'
]

function decodeUtf8BytesAs(encoding, text) {
  const bytes = Buffer.from(text, 'utf8')
  return new TextDecoder(encoding, { fatal: false }).decode(bytes)
}

function mojibakeVariants(term) {
  return [
    decodeUtf8BytesAs('gb18030', term),
    decodeUtf8BytesAs('windows-1252', term)
  ].filter((value) => value && value !== term && value.length >= 2)
}

function fromCodePoints(values) {
  return String.fromCodePoint(...values)
}

const generatedMojibakePatterns = [...new Set(cleanChineseTerms.flatMap(mojibakeVariants))]

// Keep literal mojibake out of this source file; construct high-confidence markers
// from code points so the validator can also scan itself safely.
const highConfidenceMarkers = [
  [0xfffd],
  [0x93ba, 0x30e5],
  [0x947d, 0x592f],
  [0x7f02, 0x54c4],
  [0x7455, 0x55d9],
  [0x6dc7, 0xe186],
  [0x59dd, 0x548c],
  [0x9418, 0x8216],
  [0x936e, 0x5d86],
  [0x9435, 0x7190]
].map(fromCodePoints)

function walk(target, files = []) {
  const absolute = path.join(root, target)
  if (!fs.existsSync(absolute)) return files
  const stat = fs.statSync(absolute)
  if (stat.isFile()) {
    files.push(absolute)
    return files
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue
    const child = path.join(target, entry.name)
    const childAbsolute = path.join(root, child)
    if (entry.isDirectory()) {
      walk(child, files)
    } else if (scannedExtensions.has(path.extname(entry.name))) {
      files.push(childAbsolute)
    }
  }
  return files
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function findMojibakeMarker(line) {
  const privateUseMatch = line.match(/[\uE000-\uF8FF]/u)
  if (privateUseMatch) return `private-use marker ${JSON.stringify(privateUseMatch[0])}`
  const marker = [...highConfidenceMarkers, ...generatedMojibakePatterns].find((pattern) => line.includes(pattern))
  return marker ? `marker ${JSON.stringify(marker)}` : null
}

for (const term of cleanChineseTerms) {
  assert(!findMojibakeMarker(term), `validate-no-mojibake clean term list contains corrupted text: ${JSON.stringify(term)}`)
}

const files = [...new Set(scanRoots.flatMap((target) => walk(target)))]
const failures = []

for (const file of files) {
  const rel = relative(file)
  const buffer = fs.readFileSync(file)
  const text = buffer.toString('utf8')
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const marker = findMojibakeMarker(lines[index])
    if (marker) {
      failures.push(`${rel}:${index + 1}: suspicious mojibake ${marker} in ${JSON.stringify(lines[index].slice(0, 180))}`)
      break
    }
  }

  if (publicDocFiles.has(rel)) {
    assert(!buffer.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${rel}: public docs should be UTF-8 without BOM`)
  }
}

assert(fs.existsSync(path.join(root, '.editorconfig')), '.editorconfig must exist')
const editorConfig = fs.readFileSync(path.join(root, '.editorconfig'), 'utf8')
assert(editorConfig.includes('charset = utf-8'), '.editorconfig must enforce UTF-8')
assert(failures.length === 0, `Detected mojibake or encoding corruption:\n${failures.join('\n')}`)

console.log(`validate-no-mojibake: ok (${files.length} files scanned)`)
