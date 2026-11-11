import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ChapterTitleState, TitleVersionIndex } from '../services/ChapterTitleRenameService'
import { normalizeChapterTitleReceipts } from '../shared/normalizers/chapterTitle'
import type { AppData } from '../shared/types'
import { currentRevisionFromDatabase } from './sqlite/sqliteSnapshot'
import type { SqliteDatabase } from './sqlite/sqliteTypes'

function missingProject(): never { throw new Error('改名目标项目不存在。') }

export async function readJsonChapterTitles(path: string, projectId: string) {
  const raw = await readFile(path, 'utf8'), data = JSON.parse(raw) as Partial<AppData>
  if (!data.projects?.some(p => p.id === projectId)) missingProject()
  const state: ChapterTitleState = { projectId, chapters: (data.chapters ?? []).filter(c => c.projectId === projectId),
    receipts: normalizeChapterTitleReceipts(data.chapterTitleReceipts).filter(r => r.projectId === projectId) }
  return { data, state, revision: createHash('sha256').update(raw).digest('hex') }
}

export function readSqliteChapterTitles(db: SqliteDatabase, projectId: string) {
  if (!db.prepare("SELECT 1 FROM entities WHERE collection = 'projects' AND id = ?").get(projectId)) missingProject()
  const chapters = db.prepare(`SELECT id, project_id AS projectId, chapter_order AS "order",
    json_extract(json, '$.title') AS title, json_extract(json, '$.archivedAt') AS archivedAt
    FROM entities WHERE collection = 'chapters' AND project_id = ?`).all(projectId) as unknown as ChapterTitleState['chapters']
  const receipts = db.prepare("SELECT json FROM entities WHERE collection = 'chapterTitleReceipts' AND project_id = ?")
    .all(projectId).map(r => JSON.parse(String(r.json)))
  return { state: { chapters, projectId, receipts: normalizeChapterTitleReceipts(receipts) }, revision: currentRevisionFromDatabase(db) }
}

function addVersion(index: TitleVersionIndex, chapterId: unknown, ...ids: unknown[]) {
  if (typeof chapterId !== 'string') return
  const versions = index.get(chapterId) ?? new Set<string>()
  for (const id of ids) if (typeof id === 'string' && id) versions.add(id)
  index.set(chapterId, versions)
}

export function jsonTitleVersionIds(data: Partial<AppData>, projectId: string): TitleVersionIndex {
  const index: TitleVersionIndex = new Map()
  for (const v of data.chapterVersions ?? []) if (v.projectId === projectId) addVersion(index, v.chapterId, v.id)
  for (const c of data.chapterCommitBundles ?? []) if (c.projectId === projectId)
    addVersion(index, c.chapterId, c.chapterVersion?.id, 'chapter-commit:' + c.commitId)
  for (const r of data.revisionCommitBundles ?? []) if (r.projectId === projectId)
    addVersion(index, r.chapterId, r.chapterVersion?.id, r.newChapterVersionId, 'revision-before:' + r.revisionCommitId)
  return index
}

export function sqliteTitleVersionIds(db: SqliteDatabase, projectId: string): TitleVersionIndex {
  const index: TitleVersionIndex = new Map()
  // Fetch identifiers only, including synthetic nodes exposed by the legacy version-chain reader.
  for (const row of db.prepare("SELECT chapter_id, id FROM entities WHERE collection = 'chapterVersions' AND project_id = ?").all(projectId))
    addVersion(index, row.chapter_id, row.id)
  for (const row of db.prepare(`SELECT chapter_id, json_extract(json, '$.chapterVersion.id') AS version,
    'chapter-commit:' || json_extract(json, '$.commitId') AS legacy FROM entities
    WHERE collection = 'chapterCommitBundles' AND project_id = ?`).all(projectId))
    addVersion(index, row.chapter_id, row.version, row.legacy)
  for (const row of db.prepare(`SELECT chapter_id, json_extract(json, '$.chapterVersion.id') AS version,
    json_extract(json, '$.newChapterVersionId') AS newVersion, 'revision-before:' || json_extract(json, '$.revisionCommitId') AS legacy
    FROM entities WHERE collection = 'revisionCommitBundles' AND project_id = ?`).all(projectId))
    addVersion(index, row.chapter_id, row.version, row.newVersion, row.legacy)
  return index
}
