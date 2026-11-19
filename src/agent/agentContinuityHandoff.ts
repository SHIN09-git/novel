import type { AppData, ChapterContinuityBridge, ChapterTask } from '../shared/types'
import { redactSensitiveText } from '../shared/errorUtils'
import { readCandidateDraftSource } from '../services/CandidateDraftSource'
import { combinedTaskText, inferRequiredStateCategories, inferSceneType, negativeTaskText, textMentions } from '../services/contextNeedPlanner/rules'
import { compact } from './agentReadableText'

export function readAgentContinuityHandoff(
  data: AppData, projectId: string, chapterOrder: number, task: ChapterTask,
  jobId?: string, bridge: ChapterContinuityBridge | null = null
) {
  if (chapterOrder <= 1) return null
  const trace = jobId && data.generationRunTraces.find(item => item.jobId === jobId && item.projectId === projectId)
  const plan = trace ? data.contextNeedPlans.find(item =>
    item.id === trace.contextNeedPlanId && item.projectId === projectId && item.targetChapterOrder === chapterOrder) : null
  const text = combinedTaskText(task)
  const forbidden = [task.forbiddenPayoffs, negativeTaskText(task)].filter(Boolean).join('\n')
  const scene = inferSceneType(task, bridge)
  const chapters = new Map(data.chapters.filter(item => item.projectId === projectId).map(item => [item.id, item.order]))
  const findings: Array<{ kind: 'memory' | 'character_state'; candidateId: string; chapterId: string;
    chapterOrder: number; title: string; evidence: string }> = []
  const short = (value: string) => compact(redactSensitiveText(value, [data.settings.apiKey]), 180)
  const add = (kind: 'memory' | 'character_state', candidate:
    AppData['memoryUpdateCandidates'][number] | AppData['characterStateChangeCandidates'][number], title: string) => {
    const source = readCandidateDraftSource(data, candidate)
    if (source.status !== 'current_chapter' || !source.chapterId) return
    const order = chapters.get(source.chapterId)
    if (!order || order >= chapterOrder) return
    findings.push({ kind, candidateId: candidate.id, chapterId: source.chapterId,
      chapterOrder: order, title: short(title), evidence: short(candidate.evidence) })
  }
  for (const candidate of data.characterStateChangeCandidates) {
    if (candidate.projectId !== projectId || candidate.status !== 'pending') continue
    const fact = candidate.proposedFact ?? data.characterStateFacts.find(item =>
      item.id === candidate.targetFactId && item.projectId === projectId && item.characterId === candidate.characterId)
    if (!fact || fact.trackingLevel !== 'hard') continue
    const character = data.characters.find(item => item.projectId === projectId && item.id === candidate.characterId)
    if (!character) continue
    const categories = plan?.requiredStateFactCategories[character.id] ?? (textMentions(text, character.name)
      ? inferRequiredStateCategories(character, task, scene) : [])
    if (categories.includes(fact.category)) add('character_state', candidate, `${character.name}：${fact.label}`)
  }
  for (const candidate of data.memoryUpdateCandidates) {
    if (candidate.projectId !== projectId || candidate.status !== 'pending') continue
    const patch = candidate.proposedPatch
    if (patch.kind === 'foreshadowing_status_update') {
      const item = data.foreshadowings.find(foreshadowing =>
        foreshadowing.projectId === projectId && foreshadowing.id === patch.foreshadowingId)
      if (item && !plan?.forbiddenForeshadowingIds.includes(item.id) && !textMentions(forbidden, item.title) &&
        (plan?.requiredForeshadowingIds.includes(item.id) ||
          (item.treatmentMode !== 'hidden' && item.treatmentMode !== 'pause' && textMentions(text, item.title)))) {
        add('memory', candidate, item.title)
      }
    } else if (patch.kind === 'foreshadowing_create' && textMentions(text, patch.candidate.title) &&
      !textMentions(forbidden, patch.candidate.title)) {
      add('memory', candidate, patch.candidate.title)
    }
  }
  if (!findings.length) return null
  return {
    status: 'related_candidates_pending' as const,
    note: '这些候选尚未写入账本；可以核对后决定，或避开依赖它们的剧情。其他候选不影响本章。',
    total: findings.length,
    candidates: findings.sort((a, b) => b.chapterOrder - a.chapterOrder || a.candidateId.localeCompare(b.candidateId))
      .slice(0, 6).map(item => ({ ...item, read: { tool: 'agent.getCandidateDetail', arguments: { candidateId: item.candidateId } } }))
  }
}
