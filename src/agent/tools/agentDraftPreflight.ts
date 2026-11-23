import { currentHardCanonAudit } from '../../services/HardCanonPreflight'
import { draftBodyFormatError, getChapterDraftEnvelopeError } from '../../services/ChapterDraftEnvelopeService'
import { visibleCharacterCount } from '../../services/chapterTaskContractText'
import { loadAgentBookProjection } from './agentBookProjection'
import { redactCandidateValue } from './agentCandidateDecisionOutput'
import { requiredPositiveInteger } from './agentToolArguments'

export async function preflightDraftText(args: Record<string, unknown>) {
  const chapterOrder = requiredPositiveInteger(args, 'chapterOrder')
  if (typeof args.body !== 'string') throw new Error('body 必须为待检查的正文。')
  const body = args.body
  const offset = args.offset ?? 0
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('offset 必须是非负整数。')
  const { data, projectId, storage } = await loadAgentBookProjection(args,
    ['projects', 'chapters', 'hardCanonPacks', 'characters', 'characterStateFacts', 'characterStateTransactions'], { redactLegacyKey: true })
  const formatError = draftBodyFormatError(body) ?? getChapterDraftEnvelopeError(body)
  const audit = currentHardCanonAudit(data, { projectId, chapterOrder, body })
  const findings = audit?.findings ?? []
  return { tool: 'agent.preflightDraftText', ok: true as const, storage, data: {
    projectId, chapterOrder, visibleCharacterCount: visibleCharacterCount(body), formatError,
    blocked: Boolean(formatError || findings.some(f => f.severity === 'block')),
    checkedRuleIds: audit?.checkedRuleIds ?? [], findingCount: findings.length,
    findings: redactCandidateValue(findings.slice(offset, offset + 20), data), nextOffset: offset + 20 < findings.length ? offset + 20 : null
  } }
}
