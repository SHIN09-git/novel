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
    const issues = requireStringFields(obj, [
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
        ...requireStringFields(
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
    requireStringFields(obj, [
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
      'forbiddenResets'
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
      ...requireNumberFields(obj, ['overallScore']),
      ...requireBooleanField(obj, 'pass'),
      ...requireArrayFields(obj, ['issues', 'requiredFixes', 'optionalSuggestions'])
    ]
    const dimensions = asRecord(obj.dimensions)
    if (!dimensions) {
      issues.push(issue('$.dimensions', '缺少维度分数字段。'))
    } else {
      issues.push(
        ...requireNumberFields(
          dimensions,
          [
            'plotCoherence',
            'characterConsistency',
            'foreshadowingControl',
            'chapterContinuity',
            'redundancyControl',
            'styleMatch',
            'pacing',
            'emotionalPayoff',
            'originality',
            'promptCompliance'
          ],
          '$.dimensions'
        )
      )
    }
    return issues
  })

export const validateRevisionCandidateSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '修订候选', (obj) => requireStringFields(obj, ['revisionInstruction', 'revisedText']))

export const validateRevisionResultSchema: AISchemaValidator = (value) =>
  validateObjectSchema(value, '修订结果', (obj) => requireStringFields(obj, ['revisedText', 'changedSummary', 'risks', 'preservedFacts']))
