import type { RevisionGenerationRequest, RevisionRequestType } from '../../shared/types'
import { LESS_AI_TONE_REVISION_GUIDANCE } from './LessAiToneSkill'

export const REVIEW_SYSTEM_PROMPT = [
  '你不是小说续写助手，而是小说编辑和长篇上下文管理员。',
  '你的任务是从章节正文中提取对后续创作有长期影响的信息。',
  '不要把普通描写、一次性情绪、无后续影响的对白都记录下来。',
  '优先提取会影响人物关系、主线推进、伏笔回收、世界规则和未来冲突的信息。',
  '必须输出严格 JSON。不要输出 Markdown、解释、代码块或额外废话。'
].join('\n')

export const CHAPTER_PLAN_SYSTEM_PROMPT = [
  '你是长篇小说章节导演，负责把权威上下文整理成可执行的目标章节任务书。',
  '只规划本章，不写正文，不改写已经发生的事实。',
  '目标为第一章时直接建立自然开场，不得伪造上一章或未发生的前情；只有后续章节才承接上一章结尾。角色硬状态、伏笔 treatmentMode 和硬设定不可违背。',
  '不要输出思考过程、Markdown、代码块或额外解释。',
  '必须直接输出符合用户字段要求的严格 JSON。'
].join('\n')

export const OPENING_CHAPTER_PLAN_SYSTEM_PROMPT = [
  '你是中文长篇小说第一章导演，只把权威章节任务整理成可执行计划。',
  '本次没有上一章，也不使用旧章节、未来设定、既有伏笔或中期剧情导向；不要暗示这些资料存在。',
  '只规划任务要求的当下生活场景。可以安排无剧情功能的普通生活细节，不得新增专名、背景、线索、机制、危险或额外钩子。',
  '不要输出思考过程、Markdown、代码块或额外解释。',
  '必须直接输出符合用户字段要求的严格 JSON。'
].join('\n')

export const CHAPTER_DRAFT_SYSTEM_PROMPT = [
  '你是长篇小说正文作者，负责根据已经批准的章节任务书创作完整目标章节。',
  '直接写正文，不做复盘、提取、分析或任务规划。',
  '第一章必须自然建立开场且不得伪造前情；只有第二章及以后才承接上一章结尾。始终遵守角色硬状态、伏笔 treatmentMode、硬设定和禁止事项。',
  '不要输出思考过程、Markdown、代码块或 JSON 之外的解释。',
  '必须直接输出严格 JSON，且 body 必须包含完整、非空、可阅读的章节正文。'
].join('\n')

export const OPENING_CHAPTER_DRAFT_SYSTEM_PROMPT = [
  '你是中文长篇小说第一章正文作者，根据权威章节任务创作完整正文。',
  '直接写正文，不做复盘、提取、分析或任务规划；自然建立当下场景，不伪造前情。',
  '日常细节可以具体、松弛、有生活气，但不得新增带剧情功能的人物、背景、线索、机制、危险或额外钩子。',
  '不要输出思考过程、Markdown、代码块或 JSON 之外的解释。',
  '必须直接输出严格 JSON，且 body 必须包含完整、非空、可阅读的章节正文。'
].join('\n')

export const REVISION_SYSTEM_PROMPT = [
  '你是小说修订编辑，不是续写作者。',
  '你的任务是在不改变剧情事实、人物状态和伏笔状态的前提下，提高文本表现力。',
  '当修订类型为 reduce_ai_tone 时，白名单式去 AI 味合同优先于通用润色要求：不得新增动作、感官细节或潜台词，未命中规则的文字必须逐字保留。',
  '当任务涉及章节衔接或冗余压缩时，你同时是小说连续性编辑和压缩编辑。',
  '必须让本章自然承接上一章结尾，删除重复、空泛、已经解释过的描写，但不要重写成新剧情。',
  '不要擅自新增重大设定。',
  '不要提前解释悬念。',
  '不要让人物把潜台词直接说透。',
  '不要写总结性废话。',
  '优先使用具体动作、场景细节、对话张力和情绪留白。',
  '必须输出严格 JSON，不要输出 Markdown、解释、代码块或额外废话。'
].join('\n')

export function revisionTypeLabel(type: RevisionRequestType): string {
  const labels: Record<RevisionRequestType, string> = {
    polish_style: '润色文风',
    reduce_ai_tone: '去 AI 味',
    strengthen_conflict: '加强冲突',
    improve_dialogue: '优化对白',
    compress_pacing: '压缩节奏',
    enhance_emotion: '增强情绪',
    fix_ooc: '修复 OOC',
    fix_continuity: '修复连续性',
    fix_worldbuilding: '修复设定冲突',
    fix_character_knowledge: '修复角色知识越界',
    fix_foreshadowing: '修复伏笔误用',
    fix_plot_logic: '修复剧情逻辑',
    improve_continuity: '加强章节衔接',
    reduce_redundancy: '减少冗余',
    compress_description: '压缩描写',
    remove_repeated_explanation: '删除重复解释',
    strengthen_chapter_transition: '强化转场承接',
    rewrite_section: '重写局部段落',
    custom: '自定义修订'
  }
  return labels[type]
}

export type RevisionPromptInput = RevisionGenerationRequest

function trimmedText(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

export function buildRevisionUserPrompt(request: RevisionPromptInput, context: string): string {
  const isLocal = request.revisionScope === 'local'
  const lessAiToneSection = request.type === 'reduce_ai_tone' ? LESS_AI_TONE_REVISION_GUIDANCE : ''
  const contextText = trimmedText(context)
  const fullChapterText = trimmedText(request.fullChapterText)
  const targetRange = trimmedText(request.targetRange)
  const contextSection = contextText
    ? `项目上下文：\n${contextText}`
    : '项目上下文：未提供。修订时只依据章节正文、修订类型和用户指令；不要补写背景设定。'
  const fullChapterSection = fullChapterText
    ? `fullChapterText（完整章节，${isLocal ? '仅作上下文，不要整体返回' : '全文修订对象'}）：\n${fullChapterText}`
    : [
        `fullChapterText（完整章节，${isLocal ? '仅作上下文，不要整体返回' : '全文修订对象'}）：<missing>`,
        '未提供完整章节正文。不要凭空生成章节内容；revisedText 必须返回空字符串。'
      ].join('\n')
  const targetRangeSection = isLocal
    ? targetRange
      ? `targetRange（唯一待修订片段，revisedText 只返回该片段的修订结果）：\n${targetRange}`
      : [
          'targetRange（唯一待修订片段）：<missing>',
          '未提供局部目标。不要凭空生成局部修订；revisedText 必须返回空字符串。'
        ].join('\n')
    : 'targetRange：<none>'
  return [
    '请根据修订类型与用户指令修订文本。只输出严格 JSON：',
    '{"revisedText":"","changedSummary":"","risks":"","preservedFacts":""}',
    `修订类型：${request.type}（${revisionTypeLabel(request.type)}）`,
    `revisionScope：${request.revisionScope}`,
    `用户指令：${request.instruction || '按修订类型处理'}`,
    '',
    '输出合约：',
    isLocal
      ? '- local 模式：revisedText 必须只包含 targetRange 修订后的目标片段。不要返回完整章节。程序会负责把片段合并回 fullChapterText。'
      : '- full 模式：revisedText 必须返回完整章节正文。',
    isLocal
      ? '- local 模式：除 targetRange 对应文本外，不要改写、复述或返回其他章节内容。'
      : '- full 模式：可以对整章做统一修订，但不得改变剧情事实、角色状态和伏笔状态。',
    '',
    '修订约束：',
    '- 不改变剧情事实、角色当前状态、伏笔状态和世界规则。',
    '- 不新增重大设定。',
    '- 不提前解释悬念，不擅自回收伏笔。',
    '- 修复一致性问题时，只处理指定问题，不改动无关剧情；必须保留伏笔 treatmentMode 的限制。',
    '- 如果修订类型是加强章节衔接、强化转场承接：开头必须接住上一章结尾的动作、身体状态和情绪余波，不要用时间跳跃逃避钩子。',
    '- 如果修订类型是减少冗余、压缩描写、删除重复解释：优先删减重复环境描写、抽象强化词和已解释过的机制说明，保留人物动作、对白和关键伏笔。',
    ...(lessAiToneSection ? ['', lessAiToneSection] : []),
    '',
    contextSection,
    '',
    fullChapterSection,
    '',
    targetRangeSection
  ].join('\n')
}
