import { isChapterArchived } from '../../services/ChapterLifecycleService'
import { chapterSlots } from '../../services/bookProgress/manuscript'
import { redactSensitiveText } from '../../shared/errorUtils'
import { loadAgentBookProjection } from './agentBookProjection'
import { requiredString } from './agentToolArguments'
import type { AgentToolCallResult } from './agentToolTypes'

const maxWindow = 10
const allowedArgs = new Set(['projectId', 'fromChapter', 'toChapter', 'storagePath', 'userDataPath'])

function chapterNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive safe integer.`)
  }
  return value
}

export async function exportManuscriptRange(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  for (const key of Object.keys(args)) {
    if (!allowedArgs.has(key)) throw new Error(`Unsupported manuscript range argument: ${key}.`)
  }
  for (const key of ['storagePath', 'userDataPath']) {
    if (args[key] !== undefined) requiredString(args, key)
  }
  const requestedId = requiredString(args, 'projectId')
  const fromChapter = chapterNumber(args.fromChapter, 'fromChapter')
  const toChapter = chapterNumber(args.toChapter, 'toChapter')
  if (fromChapter > toChapter) throw new Error('fromChapter must not exceed toChapter.')
  if (toChapter - fromChapter >= maxWindow) throw new Error(`Request at most ${maxWindow} chapter numbers per window.`)

  const { data, storage, projectId } = await loadAgentBookProjection(args, ['projects', 'chapters'], { redactLegacyKey: true })
  // The shared selector also accepts book names; an export must match the exact ID.
  if (projectId !== requestedId) throw new Error(`Project not found: ${requestedId}`)
  const slots = chapterSlots(data.chapters, projectId)
  const chapters = []
  const missingChapters: number[] = []
  for (let order = fromChapter; order <= toChapter; order++) {
    const chapter = slots.get(order)
    if (!chapter || isChapterArchived(chapter) || !chapter.body.trim()) {
      missingChapters.push(order)
      continue
    }
    chapters.push({
      chapterOrder: order, chapterId: chapter.id,
      title: redactSensitiveText(chapter.title, [data.settings.apiKey]),
      body: redactSensitiveText(chapter.body, [data.settings.apiKey])
    })
  }
  return { tool: 'agent.exportManuscriptRange', ok: true, storage, data: { projectId, fromChapter, toChapter, chapters, missingChapters } }
}
