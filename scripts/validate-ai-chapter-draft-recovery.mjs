import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'validation-ai-chapter-draft-recovery')
const source = await readFile(join(repoRoot, 'src', 'services', 'AIJsonParser.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    useDefineForClassFields: true,
    verbatimModuleSyntax: false
  }
}).outputText

await mkdir(outDir, { recursive: true })
const modulePath = join(outDir, 'AIJsonParser.mjs')
await writeFile(modulePath, compiled, 'utf8')
const { parseWithFallback, safeParseJson } = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)

function check(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`)
  console.log(`✓ ${message}`)
}

const brokenNewline = '{"title":"周六","body":"第一段\n第二段"}'
const strictNewline = safeParseJson(brokenNewline, '章节正文草稿')
const recoveredNewline = parseWithFallback(brokenNewline, '章节正文草稿')
check(!strictNewline.ok, 'strict JSON parsing still rejects literal control characters')
check(
  recoveredNewline.ok && recoveredNewline.data.title === '周六' && recoveredNewline.data.body === '第一段\n第二段',
  'AI-only fallback repairs an unescaped literal newline without changing the prose',
  recoveredNewline
)

const fencedBrokenTabs = '```json\n{"title":"周六","body":"第一段\t第二段\r\n第三段"}\n```'
const recoveredTabs = parseWithFallback(fencedBrokenTabs, '章节正文草稿')
check(
  recoveredTabs.ok && recoveredTabs.data.body === '第一段\t第二段\r\n第三段',
  'control-character repair also works inside a complete JSON code fence',
  recoveredTabs
)

const valid = parseWithFallback('{"title":"周六","body":"第一段\\n第二段"}', '章节正文草稿')
check(
  valid.ok && valid.source === 'direct' && valid.data.body === '第一段\n第二段',
  'valid JSON keeps the original strict parsing path',
  valid
)

const brokenQuotes = '{"title":"周六","body":"她说："先洗菜"。"}'
const irreparable = parseWithFallback(brokenQuotes, '章节正文草稿')
check(!irreparable.ok, 'unescaped dialogue quotes are not guessed or silently rewritten', irreparable)

const doubleObject = '{"title":"一","body":"正文一"}{"title":"二","body":"正文二"}'
const multiple = parseWithFallback(doubleObject, '章节正文草稿')
check(!multiple.ok, 'multiple JSON objects remain rejected instead of merging unrelated output', multiple)
