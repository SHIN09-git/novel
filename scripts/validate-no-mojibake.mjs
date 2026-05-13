import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const scanRoots = [
  'README.md',
  'ROADMAP.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'TESTING.md',
  'QUICKSTART.md',
  'PUBLIC_RELEASE_CHECKLIST.md',
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

const chineseTerms = [
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
  '本地'
]

function mojibakeVariants(term) {
  const bytes = Buffer.from(term, 'utf8')
  return [
    // Common symptom: UTF-8 bytes decoded as GBK/GB18030 before being saved again.
    new TextDecoder('gb18030', { fatal: false }).decode(bytes),
    // Common symptom: UTF-8 bytes decoded as Windows-1252 before being saved again.
    new TextDecoder('windows-1252', { fatal: false }).decode(bytes)
  ].filter((value) => value && value !== term && value.length >= 2)
}

const mojibakePatterns = [...new Set(chineseTerms.flatMap(mojibakeVariants))]
const hardFailurePatterns = [
  '\uFFFD',
  'Ã',
  'Â',
  'â€™',
  'â€œ',
  'â€',
  '鈥',
  '銆',
  '锛',
  '鐨',
  '鍦',
  '绔犺',
  '浼忕',
  '瑙掕',
  '闇€',
  '鏈',
  '鍓ф',
  '纭',
  '棰勭'
]

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

const files = [...new Set(scanRoots.flatMap((target) => walk(target)))]
const failures = []

for (const file of files) {
  const rel = relative(file)
  const buffer = fs.readFileSync(file)
  const text = buffer.toString('utf8')

  if (text.includes('\uFFFD')) {
    failures.push(`${rel}: contains UTF-8 replacement character U+FFFD`)
    continue
  }

  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = [...hardFailurePatterns, ...mojibakePatterns].find((pattern) => line.includes(pattern))
    if (match) {
      failures.push(`${rel}:${index + 1}: suspicious mojibake marker ${JSON.stringify(match)} in ${JSON.stringify(line.slice(0, 180))}`)
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
