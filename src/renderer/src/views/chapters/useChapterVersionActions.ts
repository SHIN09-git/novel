import type { ChapterVersionChainEntry } from '../../../../services/ChapterVersionChainService'
import type { ChapterVersionActionContext } from './chapterVersionActionHandlers'

const loadVersionActions = () => import('./chapterVersionActionHandlers')

export function useChapterVersionActions(context: ChapterVersionActionContext) {
  return {
    restoreChapterVersionEntry: async (entry: ChapterVersionChainEntry) =>
      (await loadVersionActions()).restoreChapterVersionEntry(context, entry),
    deleteChapterVersionEntry: async (entry: ChapterVersionChainEntry) =>
      (await loadVersionActions()).deleteChapterVersionEntry(context, entry),
    copyChapterVersionEntry: async (entry: ChapterVersionChainEntry) =>
      (await loadVersionActions()).copyChapterVersionEntry(context, entry)
  }
}
