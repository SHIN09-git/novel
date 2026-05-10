import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  }
}

const types = read('src/shared/types.ts')
const defaults = read('src/shared/defaults.ts')
const service = read('src/services/StoryDirectionService.ts')
const aiService = read('src/services/AIService.ts')
const storyDirectionAI = read('src/services/ai/StoryDirectionAI.ts')
const promptBuilder = read('src/services/PromptBuilderService.ts')
const promptContext = read('src/renderer/src/utils/promptContext.ts')
const runner = read('src/renderer/src/views/generation/usePipelineRunner.ts')
const app = read('src/renderer/src/App.tsx')
const navTypes = read('src/renderer/src/components/layoutParts/types.ts')
const view = read('src/renderer/src/views/StoryDirectionView.tsx')
const runTracePanel = read('src/renderer/src/views/generation/RunTracePanel.tsx')

assert(types.includes('export interface StoryDirectionGuide'), 'StoryDirectionGuide type exists')
assert(types.includes('export interface StoryDirectionChapterBeat'), 'StoryDirectionChapterBeat type exists')
assert(types.includes('storyDirectionGuides: StoryDirectionGuide[]'), 'AppData stores storyDirectionGuides')
assert(types.includes('storyDirectionGuide: StoryDirectionGuide | null'), 'Prompt snapshots / build results can carry StoryDirectionGuide')
assert(types.includes('storyDirectionGuideId: ID | null'), 'Run trace records storyDirectionGuideId')

assert(defaults.includes('storyDirectionGuides: []'), 'EMPTY_APP_DATA initializes storyDirectionGuides')
assert(defaults.includes('normalizeStoryDirectionGuide'), 'normalizeAppData supports StoryDirectionGuide')
assert(defaults.includes('storyDirectionGuides: arrayOrEmpty<StoryDirectionGuide>'), 'normalizeAppData maps storyDirectionGuides')

assert(service.includes('getActiveGuideForChapter'), 'StoryDirectionService can select active guide')
assert(service.includes('deriveChapterTaskPatch'), 'StoryDirectionService can derive ChapterTask patch')
assert(service.includes('formatForPrompt'), 'StoryDirectionService can format prompt block')
assert(service.includes('不得覆盖上一章结尾衔接'), 'StoryDirection prompt block declares authority boundary')

assert(storyDirectionAI.includes('polishUserStoryDirectionIdea'), 'StoryDirectionAI supports polishing user idea')
assert(storyDirectionAI.includes('generateStoryDirectionGuide'), 'StoryDirectionAI supports guide generation')
assert(aiService.includes('polishStoryDirectionIdea'), 'AIService exposes polishStoryDirectionIdea')
assert(aiService.includes('generateStoryDirectionGuide'), 'AIService exposes generateStoryDirectionGuide')

assert(promptBuilder.includes("id: 'story-direction-guide'"), 'PromptBuilder includes story-direction-guide block')
assert(promptBuilder.includes("kind: 'story_direction'"), 'PromptBuilder block kind is story_direction')
assert(promptBuilder.includes('StoryDirectionService.formatForPrompt'), 'PromptBuilder formats active story guide')
assert(promptBuilder.indexOf("id: 'story-direction-guide'") > promptBuilder.indexOf("id: 'foreshadowing-operation-rules'"), 'Story guide appears after foreshadowing rules')
assert(promptBuilder.indexOf("id: 'story-direction-guide'") < promptBuilder.indexOf("id: 'current-progress'"), 'Story guide appears before current progress')

assert(promptContext.includes('storyDirectionGuide?: StoryDirectionGuide | null'), 'promptContext accepts storyDirectionGuide')
assert(promptContext.includes('storyDirectionGuide: storyDirectionGuide ?? null'), 'promptContext forwards storyDirectionGuide to PromptBuilder')

assert(runner.includes('StoryDirectionService.getActiveGuideForChapter'), 'Pipeline selects active StoryDirectionGuide')
assert(runner.includes('pipelineChapterTask(project, options, activeStoryDirectionGuide)'), 'Pipeline chapter task receives active guide')
assert(runner.includes('storyDirectionPromptText: StoryDirectionService.formatForPrompt'), 'ContextNeedPlanner receives story direction prompt text')
assert(runner.includes('storyDirectionTracePatch'), 'Pipeline writes story direction metadata into run trace')
assert(runner.includes("job.contextSource === 'prompt_snapshot'") && runner.includes('activeStoryDirectionGuide'), 'Snapshot mode avoids automatic active guide application')

assert(navTypes.includes("| 'direction'"), 'Navigation view union includes direction')
assert(navTypes.includes("direction: '剧情导向'"), 'Navigation label includes 剧情导向')
assert(app.includes('StoryDirectionView') && app.includes("case 'direction'"), 'App renders StoryDirectionView')

assert(view.includes('AI 润色纲领'), 'StoryDirectionView has polish action')
assert(view.includes('生成 AI 剧情指导'), 'StoryDirectionView has generate guide action')
assert(view.includes('设为当前导向'), 'StoryDirectionView can activate guide')
assert(view.includes('过往剧情回顾'), 'StoryDirectionView shows stage summary review')

assert(runTracePanel.includes('storyDirectionGuideId'), 'RunTracePanel exposes story direction metadata')

if (!process.exitCode) {
  console.log('Story direction board validation passed.')
}
