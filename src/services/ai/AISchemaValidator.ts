export interface AISchemaIssue {
  path: string
  message: string
}

export interface AISchemaValidationResult {
  ok: boolean
  schemaName: string
  issues: AISchemaIssue[]
}

export type AISchemaValidator = (value: unknown) => AISchemaValidationResult

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function issue(path: string, message: string): AISchemaIssue {
  return { path, message }
}

function result(schemaName: string, issues: AISchemaIssue[]): AISchemaValidationResult {
  return { ok: issues.length === 0, schemaName, issues }
}

function requireObject(value: unknown, schemaName: string): { obj: Record<string, unknown> | null; issues: AISchemaIssue[] } {
  const obj = asRecord(value)
  return obj ? { obj, issues: [] } : { obj: null, issues: [issue('$', `${schemaName} 必须是 JSON 对象。`)] }
}

function requireStringFields(obj: Record<string, unknown>, fields: string[], basePath = '$'): AISchemaIssue[] {
  return fields.flatMap((field) => {
    if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填字段。')]
    return typeof obj[field] === 'string' ? [] : [issue(`${basePath}.${field}`, '必须是字符串。')]
  })
}

function isTextLike(value: unknown): boolean {
  if (typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return true
  return typeof value === 'object' && value !== null
}

function requireTextLikeFields(obj: Record<string, unknown>, fields: string[], basePath = '$'): AISchemaIssue[] {
  return fields.flatMap((field) => {
    if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填字段。')]
    return isTextLike(obj[field]) ? [] : [issue(`${basePath}.${field}`, '必须是可转换为文本的值。')]
  })
}
function requireArrayFields(obj: Record<string, unknown>, fields: string[], basePath = '$'): AISchemaIssue[] {
  return fields.flatMap((field) => {
    if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填数组字段。')]
    return Array.isArray(obj[field]) ? [] : [issue(`${basePath}.${field}`, '必须是数组。')]
  })
}

function requireNumberFields(obj: Record<string, unknown>, fields: string[], basePath = '$'): AISchemaIssue[] {
  return fields.flatMap((field) => {
    if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填数字字段。')]
    return typeof obj[field] === 'number' && Number.isFinite(obj[field] as number)
      ? []
      : [issue(`${basePath}.${field}`, '必须是数字。')]
  })
}

function requireBooleanField(obj: Record<string, unknown>, field: string, basePath = '$'): AISchemaIssue[] {
  if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填布尔字段。')]
  return typeof obj[field] === 'boolean' ? [] : [issue(`${basePath}.${field}`, '必须是布尔值。')]
}

function requireOptionalArrayField(obj: Record<string, unknown>, field: string, basePath = '$'): AISchemaIssue[] {
  if (!(field in obj) || obj[field] === undefined || obj[field] === null) return []
  return Array.isArray(obj[field]) ? [] : [issue(`${basePath}.${field}`, '必须是数组。')]
}

function requireNullableStringField(obj: Record<string, unknown>, field: string, basePath = '$'): AISchemaIssue[] {
  if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填字段。')]
  return typeof obj[field] === 'string' || obj[field] === null ? [] : [issue(`${basePath}.${field}`, '必须是字符串或 null。')]
}

function requireNullableNumberField(obj: Record<string, unknown>, field: string, basePath = '$'): AISchemaIssue[] {
  if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填字段。')]
  return typeof obj[field] === 'number' || obj[field] === null ? [] : [issue(`${basePath}.${field}`, '必须是数字或 null。')]
}

function requireScoreFields(obj: Record<string, unknown>, fields: string[], basePath = '$'): AISchemaIssue[] {
  return fields.flatMap((field) => {
    if (!(field in obj)) return [issue(`${basePath}.${field}`, '缺少必填数字字段。')]
    const value = obj[field]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
      ? []
      : [issue(`${basePath}.${field}`, '必须是 0-100 之间的数字。')]
  })
}

function isValidSeverity(value: unknown): boolean {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isValidForeshadowingStatus(value: unknown): boolean {
  return value === 'unresolved' || value === 'partial' || value === 'resolved' || value === 'abandoned'
}

function isValidTreatmentMode(value: unknown): boolean {
  return value === undefined || value === 'hidden' || value === 'hint' || value === 'advance' || value === 'mislead' || value === 'pause' || value === 'payoff'
}

function validateObjectSchema(value: unknown, schemaName: string, validate: (obj: Record<string, unknown>) => AISchemaIssue[]): AISchemaValidationResult {
  const { obj, issues } = requireObject(value, schemaName)
  if (!obj) return result(schemaName, issues)
  return result(schemaName, validate(obj))
}

export function formatSchemaValidationError(validation: AISchemaValidationResult): string {
  const details = validation.issues
    .slice(0, 6)
    .map((item) => `${item.path}: ${item.message}`)
    .join('；')
  const suffix = validation.issues.length > 6 ? `；另有 ${validation.issues.length - 6} 个字段问题` : ''
  return `AI 返回结构不符合 ${validation.schemaName}：${details}${suffix}`
}

export const validateChapterReviewSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '章节复盘', (obj) => {
    const issues = requireTextLikeFields(obj, [
      'summary',
      'newInformation',
      'characterChanges',
      'newForeshadowing',
      'resolvedForeshadowing',
      'endingHook',
      'riskWarnings'
    ])
    const bridge = asRecord(obj.continuityBridgeSuggestion)
    if (!bridge) {
      issues.push(issue('$.continuityBridgeSuggestion', '缺少下一章衔接建议对象。'))
    } else {
      issues.push(
        ...requireTextLikeFields(
          bridge,
          [
            'lastSceneLocation',
            'lastPhysicalState',
            'lastEmotionalState',
            'lastUnresolvedAction',
            'lastDialogueOrThought',
            'immediateNextBeat',
            'mustContinueFrom',
            'mustNotReset',
            'openMicroTensions'
          ],
          '$.continuityBridgeSuggestion'
        )
      )
    }
    if (obj.characterStateChangeSuggestions !== undefined) {
      if (!Array.isArray(obj.characterStateChangeSuggestions)) {
        issues.push(issue('$.characterStateChangeSuggestions', '必须是数组。'))
      } else {
        obj.characterStateChangeSuggestions.forEach((item, index) => {
          const suggestion = asRecord(item)
          if (!suggestion) {
            issues.push(issue(`$.characterStateChangeSuggestions[${index}]`, '必须是对象。'))
            return
          }
          issues.push(
            ...requireStringFields(
              suggestion,
              ['characterId', 'category', 'key', 'label', 'changeType', 'evidence', 'riskLevel', 'suggestedTransactionType'],
              `$.characterStateChangeSuggestions[${index}]`
            )
          )
          if (!Array.isArray(suggestion.linkedCardFields)) {
            issues.push(issue(`$.characterStateChangeSuggestions[${index}].linkedCardFields`, '必须是数组。'))
          }
        })
      }
    }
    return issues
  })

export const validateCharacterSuggestionsSchema: AISchemaValidator = (value) => {
  const list = Array.isArray(value) ? value : asRecord(value)?.suggestions
  const issues: AISchemaIssue[] = []
  if (!Array.isArray(list)) return result('角色状态更新', [issue('$.suggestions', '必须是数组。')])
  list.forEach((item, index) => {
    const obj = asRecord(item)
    if (!obj) {
      issues.push(issue(`$.suggestions[${index}]`, '必须是对象。'))
      return
    }
    issues.push(...requireStringFields(obj, ['characterId', 'changeSummary'], `$.suggestions[${index}]`))
  })
  return result('角色状态更新', issues)
}

export const validateForeshadowingExtractionSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '伏笔提取', (obj) =>
    requireArrayFields(obj, [
      'newForeshadowingCandidates',
      'advancedForeshadowingIds',
      'resolvedForeshadowingIds',
      'abandonedForeshadowingCandidates',
      'statusChanges'
    ])
  )

export const validateNextSuggestionsSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '下一章建议', (obj) =>
    requireStringFields(obj, [
      'nextChapterGoal',
      'conflictToPush',
      'suspenseToKeep',
      'foreshadowingToHint',
      'foreshadowingNotToReveal',
      'suggestedEndingHook',
      'readerEmotionTarget'
    ])
  )

export const validateChapterPlanSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '章节任务书', (obj) =>
    requireTextLikeFields(obj, [
      'chapterTitle',
      'chapterGoal',
      'conflictToPush',
      'characterBeats',
      'foreshadowingToUse',
      'foreshadowingNotToReveal',
      'endingHook',
      'readerEmotionTarget',
      'estimatedWordCount',
      'openingContinuationBeat',
      'carriedPhysicalState',
      'carriedEmotionalState',
      'unresolvedMicroTensions',
      'forbiddenResets',
      'allowedNovelty',
      'forbiddenNovelty'
    ])
  )

export const validateChapterDraftSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '章节正文草稿', (obj) => {
    const bodyFields = ['body', 'chapterBody', 'chapterText', 'content', 'text', 'draft', 'markdown']
    const hasBody = bodyFields.some((field) => typeof obj[field] === 'string')
    return hasBody ? [] : [issue('$.body', `缺少正文文本字段，支持字段：${bodyFields.join(', ')}。`)]
  })

export const validateConsistencyReviewSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '一致性审稿', (obj) => [
    ...requireArrayFields(obj, [
      'timelineProblems',
      'settingConflicts',
      'characterOOC',
      'foreshadowingMisuse',
      'pacingProblems',
      'emotionPayoffProblems',
      'suggestions',
      'issues'
    ]),
    ...requireStringFields(obj, ['severitySummary'])
  ])

export const validateQualityGateSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '质量门禁', (obj) => {
    const issues = [
      ...requireScoreFields(obj, ['overallScore']),
      ...requireBooleanField(obj, 'pass'),
      ...requireArrayFields(obj, ['issues', 'requiredFixes', 'optionalSuggestions'])
    ]
    const dimensions = asRecord(obj.dimensions)
    if (!dimensions) {
      issues.push(issue('$.dimensions', '缺少维度分数字段。'))
    } else {
      issues.push(
        ...requireScoreFields(
          dimensions,
          [
            'plotCoherence',
            'characterConsistency',
            'characterStateConsistency',
            'foreshadowingControl',
            'chapterContinuity',
            'redundancyControl',
            'styleMatch',
            'pacing',
            'emotionalPayoff',
            'originality',
            'promptCompliance',
            'contextRelevanceCompliance'
          ],
          '$.dimensions'
        )
      )
    }
    if (Array.isArray(obj.issues)) {
      obj.issues.forEach((item, index) => {
        const gateIssue = asRecord(item)
        if (!gateIssue) {
          issues.push(issue(`$.issues[${index}]`, '必须是对象。'))
          return
        }
        issues.push(...requireStringFields(gateIssue, ['type', 'description', 'evidence', 'suggestedFix'], `$.issues[${index}]`))
        if (!('severity' in gateIssue)) {
          issues.push(issue(`$.issues[${index}].severity`, '缺少严重程度。'))
        } else if (!isValidSeverity(gateIssue.severity)) {
          issues.push(issue(`$.issues[${index}].severity`, '必须是 low / medium / high。'))
        }
      })
    }
    return issues
  })

export const validateRevisionCandidateSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '修订候选', (obj) => requireStringFields(obj, ['revisionInstruction', 'revisedText']))

export const validateRevisionResultSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '修订结果', (obj) => [
    ...requireStringFields(obj, ['revisedText']),
    ...requireTextLikeFields(obj, ['changedSummary', 'risks', 'preservedFacts'])
  ])

export const validateMemoryUpdatePatchSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '长期记忆候选补丁', (obj) => {
    const issues = [
      ...requireNumberFields(obj, ['schemaVersion']),
      ...requireStringFields(obj, ['kind', 'summary']),
      ...requireOptionalArrayField(obj, 'warnings')
    ]
    if (obj.sourceChapterOrder !== undefined && obj.sourceChapterOrder !== null && typeof obj.sourceChapterOrder !== 'number') {
      issues.push(issue('$.sourceChapterOrder', '必须是数字或 null。'))
    }

    if (obj.kind === 'chapter_review_update') {
      issues.push(...requireNullableStringField(obj, 'targetChapterId'))
      issues.push(...requireNullableNumberField(obj, 'targetChapterOrder'))
      const review = asRecord(obj.review)
      if (!review) {
        issues.push(issue('$.review', '缺少章节复盘对象。'))
      } else {
        issues.push(
          ...requireStringFields(review, ['summary', 'newInformation', 'characterChanges', 'newForeshadowing', 'resolvedForeshadowing', 'endingHook', 'riskWarnings'], '$.review')
        )
      }
      if (obj.continuityBridgeSuggestion !== null && obj.continuityBridgeSuggestion !== undefined && !asRecord(obj.continuityBridgeSuggestion)) {
        issues.push(issue('$.continuityBridgeSuggestion', '必须是对象或 null。'))
      }
    } else if (obj.kind === 'character_state_update') {
      issues.push(
        ...requireStringFields(obj, ['characterId', 'changeSummary', 'newCurrentEmotionalState', 'newRelationshipWithProtagonist', 'newNextActionTendency']),
        ...requireNullableStringField(obj, 'relatedChapterId'),
        ...requireNullableNumberField(obj, 'relatedChapterOrder')
      )
    } else if (obj.kind === 'foreshadowing_create') {
      const candidate = asRecord(obj.candidate)
      if (!candidate) {
        issues.push(issue('$.candidate', '缺少新增伏笔候选对象。'))
      } else {
        issues.push(...requireStringFields(candidate, ['title', 'description', 'expectedPayoff', 'notes'], '$.candidate'))
        issues.push(...requireNullableNumberField(candidate, 'firstChapterOrder', '$.candidate'))
        issues.push(...requireArrayFields(candidate, ['relatedCharacterIds'], '$.candidate'))
        if (!('suggestedWeight' in candidate)) {
          issues.push(issue('$.candidate.suggestedWeight', '缺少伏笔权重。'))
        }
      }
    } else if (obj.kind === 'foreshadowing_status_update') {
      issues.push(...requireStringFields(obj, ['foreshadowingId', 'evidenceText', 'notes']))
      if (!('suggestedStatus' in obj) || !isValidForeshadowingStatus(obj.suggestedStatus)) {
        issues.push(issue('$.suggestedStatus', '必须是 unresolved / partial / resolved / abandoned。'))
      }
      if (!isValidTreatmentMode(obj.recommendedTreatmentMode)) {
        issues.push(issue('$.recommendedTreatmentMode', '必须是合法伏笔处理方式。'))
      }
      if (obj.actualPayoffChapter !== undefined && obj.actualPayoffChapter !== null && typeof obj.actualPayoffChapter !== 'number') {
        issues.push(issue('$.actualPayoffChapter', '必须是数字或 null。'))
      }
    } else if (obj.kind === 'stage_summary_create') {
      if (!asRecord(obj.stageSummary)) issues.push(issue('$.stageSummary', '缺少阶段摘要对象。'))
    } else if (obj.kind === 'timeline_event_create') {
      if (!asRecord(obj.event)) issues.push(issue('$.event', '缺少时间线事件对象。'))
    } else if (obj.kind === 'legacy_raw') {
      issues.push(...requireStringFields(obj, ['rawText']))
    } else if ('kind' in obj) {
      issues.push(issue('$.kind', '未知的记忆补丁类型。'))
    }
    return issues
  })

