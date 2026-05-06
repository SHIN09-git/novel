import type { RevisionGenerationRequest, RevisionRequestType } from '../../shared/types'

export const REVIEW_SYSTEM_PROMPT = [
  '你不是小说续写助手，而是小说编辑和长篇上下文管理员。',
  '你的任务是从章节正文中提取对后续创作有长期影响的信息。',
  '不要把普通描写、一次性情绪、无后续影响的对白都记录下来。',
  '优先提取会影响人物关系、主线推进、伏笔回收、世界规则和未来冲突的信息。',
  '必须输出严格 JSON。不要输出 Markdown、解释、代码块或额外废话。'
].join('\n')

export const REVISION_SYSTEM_PROMPT = [
  '你是小说修订编辑，不是续写作者。',
  '你的任务是在不改变剧情事实、人物状态和伏笔状态的前提下，提高文本表现力。',
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

export function buildRevisionUserPrompt(request: RevisionPromptInput, context: string): string {
  const isLocal = request.revisionScope === 'local'
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
    '',
    `项目上下文：\n${context || '暂无'}`,
    '',
    `fullChapterText（完整章节，${isLocal ? '仅作上下文，不要整体返回' : '全文修订对象'}）：\n${request.fullChapterText || '暂无正文'}`,
    '',
    isLocal
      ? `targetRange（唯一待修订片段，revisedText 只返回该片段的修订结果）：\n${request.targetRange || '暂无局部目标'}`
      : 'targetRange：<none>'
  ].join('\n')
}
