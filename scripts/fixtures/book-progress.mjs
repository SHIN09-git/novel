// Synthetic only. Order 66 is missing; a failed revision of 92 leaves its old text intact.
export const progressBookId = 'progress-book'
export const fixtureTime = '2026-10-01T10:00:00.000Z'
export const wideText = '甲 \n𠮷。'
export function bookProgressFixture() {
  const p = progressBookId, t = fixtureTime
  const chapter = order => ({ id: 'c' + order, projectId: p, order, title: '样章 ' + order, body: wideText,
    summary: '', newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '',
    endingHook: '', riskWarnings: '', includedInStageSummary: false, createdAt: t, updatedAt: t })
  const job = order => ({ id: 'j' + order, projectId: p, targetChapterOrder: order, status: 'completed',
    currentStep: 'await_user_confirmation', createdAt: t, updatedAt: t })
  const draft = order => ({ id: 'd' + order, projectId: p, chapterId: null, jobId: 'j' + order, title: '草稿 ' + order,
    body: '这是只存在草稿里的内容。', status: 'draft', createdAt: t, updatedAt: t })
  const chapters = Array.from({ length: 96 }, (_, i) => i + 1).filter(n => n !== 66 && n !== 74).map(chapter)
  Object.assign(chapters.find(c => c.order === 80), { body: ' \n ' })
  Object.assign(chapters.find(c => c.order === 88), { archivedAt: t })
  return { projects: [{ id: p, name: '全书进度样书', bookWordTarget: { min: 15276, max: 20000 }, createdAt: t, updatedAt: t },
    { id: 'other-book', name: '另一本样书', createdAt: t, updatedAt: t }],
    chapters: [...chapters, { ...chapter(66), id: 'other-c66', projectId: 'other-book', body: '不能串书。' }],
    chapterGenerationJobs: [job(66), job(74), job(92)],
    generatedChapterDrafts: [draft(74), { ...draft(92), body: '重写。' }, { ...draft(66), status: 'rejected' }],
    chapterWritebackFailures: [{ id: 'sample-failure', projectId: p, chapterId: 'c92', chapterOrder: 92,
      kind: 'revision_commit', commitId: 'failed-r92', versionId: 'failed-v92', revisionSessionId: 's92', revisionVersionId: 'rv92',
      attemptedAt: t, reason: '正式修订未写入。' }] }
}
