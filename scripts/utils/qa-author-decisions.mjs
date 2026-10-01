// Real renderer -> preload -> main -> isolated SQLite journeys; no remote AI.
export async function runAuthorDecisions({ client, evaluate, waitFor, clickButton, openEvent, clickCandidateButton, captureScreenshot, assertNoHorizontalOverflow }) {
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const checks = []
  const stateValue = '左手掌烫痕已包扎，仍不能握紧重物。'
  const title = '钟楼票据的缺角'
  const body = '林默停在钟楼门前，先把湿透的票据收好，再慢慢推开木门。'
  await evaluate(client, `(async () => {
    const { data } = await window.novelDirector.data.load()
    const at = new Date().toISOString()
    const memory = data.memoryUpdateCandidates.find(item => item.id === 'qa-batch-memory')
    const state = data.characterStateChangeCandidates.find(item => item.id === 'qa-batch-state')
    if (!memory || !state) throw new Error('Missing author-decision fixture sources.')
    const newMemory = { ...memory, id: 'qa-edit-memory', status: 'pending', evidence: '编辑验收事件：钟楼票据。',
      proposedPatch: { ...memory.proposedPatch, candidate: { ...memory.proposedPatch.candidate, title: '钟楼票据', description: '票据缺了一角。' } }, createdAt: at, updatedAt: at }
    const newState = { ...state, id: 'qa-edit-state', status: 'pending', targetFactId: null, evidence: '编辑验收状态：左掌包扎。',
      proposedFact: { ...state.proposedFact, id: 'qa-edit-fact', key: 'bandaged-palm', label: '左掌包扎' }, createdAt: at, updatedAt: at }
    const oldJob = data.chapterGenerationJobs.find(item => item.id === 'qa-job')
    const oldDraft = data.generatedChapterDrafts.find(item => item.id === 'qa-draft')
    const job = { ...oldJob, id: 'qa-unreviewed-job', targetChapterOrder: 4, status: 'failed', currentStep: 'generate_chapter_review',
      errorMessage: '隔离验收：审稿暂未完成。', createdAt: at, updatedAt: at }
    const draft = { ...oldDraft, id: 'qa-unreviewed-draft', jobId: job.id, chapterId: null,
      title: '未审稿采纳验收', body: ${JSON.stringify(body)}, status: 'draft', createdAt: at, updatedAt: at }
    const failedStep = { id: 'qa-unreviewed-failed-step', jobId: job.id, type: 'generate_chapter_review',
      status: 'failed', input: '', output: '', errorMessage: job.errorMessage, startedAt: at, completedAt: at,
      createdAt: at, updatedAt: at }
    await window.novelDirector.data.save({ ...data,
      chapterGenerationJobs: [job, ...data.chapterGenerationJobs], generatedChapterDrafts: [draft, ...data.generatedChapterDrafts],
      chapterGenerationSteps: [failedStep, ...data.chapterGenerationSteps],
      memoryUpdateCandidates: [newMemory, ...data.memoryUpdateCandidates], characterStateChangeCandidates: [newState, ...data.characterStateChangeCandidates] })
  })()`)
  await client.send('Page.reload', { ignoreCache: true })
  await waitFor(client, `Boolean([...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '进入'))`, 30_000)
  await clickButton(client, '进入')
  await waitFor(client, `Boolean([...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '决策收件箱'))`)
  await clickButton(client, '决策收件箱')
  await waitFor(client, `Boolean(document.querySelector('[data-candidate-id="qa-edit-memory"]'))`)

  async function setField(label, text) {
    await client.send('Page.bringToFront')
    const focused = await evaluate(client, `(() => {
      const field = [...document.querySelectorAll('.inbox-amendment-editor .inbox-amendment-field')]
        .find(item => item.querySelector('span')?.textContent?.trim() === ${JSON.stringify(label)})
      const input = field?.querySelector('input:not([type=checkbox]), textarea')
      if (!input) return false
      input.scrollIntoView({ block: 'center' }); input.focus(); input.setSelectionRange(0, input.value.length)
      return document.activeElement === input
    })()`)
    assert(focused, `Could not focus amendment field ${label}.`)
    await client.send('Input.insertText', { text })
    await waitFor(client, `Boolean([...document.querySelectorAll('.inbox-amendment-editor input, .inbox-amendment-editor textarea')].find(item => item.value === ${JSON.stringify(text)}))`)
  }

  await openEvent(client, '编辑验收事件')
  await clickCandidateButton(client, 'qa-edit-memory', '编辑后接受')
  await waitFor(client, `Boolean(document.querySelector('.inbox-amendment-editor'))`)
  await setField('标题', title)
  await clickButton(client, '取消')
  const cancelled = await evaluate(client, `(async () => (await window.novelDirector.data.load()).data.memoryUpdateCandidates.find(item => item.id === 'qa-edit-memory'))()`)
  assert(cancelled.status === 'pending' && cancelled.proposedPatch.candidate.title === '钟楼票据', 'Cancelling amendment changed the stored candidate.')
  checks.push('Cancelling a typed memory amendment leaves its original proposal and pending status intact.')
  await clickCandidateButton(client, 'qa-edit-memory', '编辑后接受')
  await setField('标题', title)
  await waitFor(client, `document.querySelector('.inbox-amendment-preview')?.textContent.includes(${JSON.stringify(title)})`)
  await assertNoHorizontalOverflow(client, 'memory amendment editor')
  await captureScreenshot(client, '14-memory-amendment.png')
  await clickButton(client, '预览后接受')
  // The original proposal's warnings determine whether a confirmation is needed.
  await waitFor(client, `(async () => Boolean(document.querySelector('.confirm-dialog')) || (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some(item => item.id === 'qa-edit-memory' && item.status === 'accepted'))()`)
  if (await evaluate(client, `Boolean(document.querySelector('.confirm-dialog'))`)) await clickButton(client, '确认处理')
  await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.foreshadowings.some(item => item.title === ${JSON.stringify(title)}))()`)
  const receipt = await evaluate(client, `(async () => (await window.novelDirector.data.load()).data.candidateDecisionReceipts.find(item => item.decisions.some(decision => decision.candidateId === 'qa-edit-memory')))()`)
  assert(receipt?.amendments?.[0]?.before.patch.candidate.title === '钟楼票据' && receipt.amendments[0].after.patch.candidate.title === title,
    'Edited acceptance did not store both the original and adopted proposals.')
  checks.push('Memory editing uses the shared preview and atomically persists the edited fact and before/after receipt.')

  await openEvent(client, '编辑验收状态')
  await clickCandidateButton(client, 'qa-edit-state', '编辑后接受')
  await waitFor(client, `Boolean(document.querySelector('.inbox-amendment-editor'))`)
  await setField('目标值', stateValue)
  await waitFor(client, `document.querySelector('.inbox-amendment-preview')?.textContent.includes(${JSON.stringify(stateValue)})`)
  await captureScreenshot(client, '15-state-amendment.png')
  await clickButton(client, '预览后接受')
  await waitFor(client, `Boolean(document.querySelector('.confirm-dialog'))`)
  assert(await evaluate(client, `document.querySelector('.confirm-dialog').textContent.includes('高风险')`), 'State amendment concealed the original risk.')
  await clickButton(client, '确认处理')
  await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.characterStateFacts.some(item => item.value === ${JSON.stringify(stateValue)}))()`)
  checks.push('A physical-state amendment retains its risk confirmation and writes the reviewed final value to the ledger.')

  await clickButton(client, '生产流水线')
  await waitFor(client, `Boolean([...document.querySelectorAll('.pipeline-job-item')].find(item => item.querySelector('strong')?.textContent === '第 4 章'))`)
  await evaluate(client, `(() => { const history = document.querySelector('details.pipeline-job-list'); if (history && !history.open) history.querySelector('summary').click() })()`)
  await evaluate(client, `[...document.querySelectorAll('.pipeline-job-item')].find(item => item.querySelector('strong')?.textContent === '第 4 章').click()`)
  await waitFor(client, `document.querySelector('.pipeline-draft-body')?.value === ${JSON.stringify(body)}`)
  await clickButton(client, '接受章节草稿')
  await waitFor(client, `document.body.textContent.includes('当前正文尚未完成匹配的审稿')`)
  await clickButton(client, '未完成审稿，直接采纳')
  await waitFor(client, `Boolean(document.querySelector('.confirm-dialog'))`)
  await captureScreenshot(client, '16-unreviewed-acceptance.png')
  await clickButton(client, '确认未审稿采纳')
  await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.generatedChapterDrafts.some(item => item.id === 'qa-unreviewed-draft' && item.status === 'accepted'))()`)
  const accepted = await evaluate(client, `(async () => {
    const { data } = await window.novelDirector.data.load()
    const commit = data.chapterCommitBundles.find(item => item.generatedDraftId === 'qa-unreviewed-draft')
    return { review: commit?.acceptanceReview, chapter: data.chapters.find(item => item.id === commit?.chapterId),
      reports: data.qualityGateReports.filter(item => item.draftId === 'qa-unreviewed-draft').length }
  })()`)
  assert(accepted.review?.mode === 'unreviewed' && accepted.review.qualityStatus === 'not_available' && accepted.reports === 0 && accepted.chapter?.body === body,
    'Unreviewed acceptance did not preserve its explicit provenance or invented a passing report.')
  await waitFor(client, `document.querySelector('.pipeline-draft-accepted')?.textContent.includes('未审稿采纳')`)
  assert(await evaluate(client, `[...document.querySelectorAll('button')].some(item => item.textContent?.trim() === '生成第 5 章' && !item.disabled)`), 'Unreviewed acceptance did not make the next-chapter action available.')
  await clickButton(client, '章节')
  await waitFor(client, `Boolean([...document.querySelectorAll('.list-pane .list-item')].find(item => item.textContent.includes('未审稿采纳验收')))`)
  await evaluate(client, `[...document.querySelectorAll('.list-pane .list-item')].find(item => item.textContent.includes('未审稿采纳验收')).click()`)
  await clickButton(client, '版本历史')
  await waitFor(client, `document.querySelector('.version-history-panel')?.textContent.includes('未审稿采纳')`)
  assert(await evaluate(client, `(() => {
    const panel = document.querySelector('.version-history-panel')
    return panel.textContent.includes('1 个已保存版本') && !panel.textContent.includes('暂无历史版本')
  })()`), 'The first accepted current version must count as saved history, not an empty version chain.')
  await evaluate(client, `document.querySelector('.version-history-panel').scrollIntoView({ block: 'start', behavior: 'instant' })`)
  await waitFor(client, `(() => {
    const rect = document.querySelector('.version-history-panel')?.getBoundingClientRect()
    return rect && rect.top >= 0 && rect.top < window.innerHeight - 100
  })()`)
  await captureScreenshot(client, '17-unreviewed-history.png')
  checks.push('Explicit unreviewed acceptance creates a version without synthetic reports, unlocks the next chapter and remains visibly labelled in version history.')
  return checks
}
