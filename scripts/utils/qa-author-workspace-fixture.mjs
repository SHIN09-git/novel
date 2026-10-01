import { loadProseFixtureDomain } from './qa-prose-first-fixture.mjs'

export const AUTHOR_WORKSPACE_FIXTURE_IDS = Object.freeze({
  longProject: 'qa-author-long-project',
  secondProject: 'qa-author-second-project',
  character: 'qa-author-character'
})

export const AUTHOR_LONG_PROJECT_NAME = '钟楼来信与失踪账簿的超长项目名称验收样本'
export const AUTHOR_SECOND_PROJECT_NAME = '雨夜档案'

const at = '2026-09-20T00:00:00.000Z'

export async function loadAuthorWorkspaceFixtureDomain() {
  return loadProseFixtureDomain()
}

export function createAuthorWorkspaceFixture(domain) {
  const ids = AUTHOR_WORKSPACE_FIXTURE_IDS
  const data = domain.normalizeAppData({
    schemaVersion: 3,
    projects: [
      {
        id: ids.longProject,
        name: AUTHOR_LONG_PROJECT_NAME,
        genre: '悬疑',
        description: '用于验证首屏项目列表、超长名称折行和编辑失败保留。',
        targetReaders: '成年读者',
        coreAppeal: '证据推理',
        style: '克制、具体、保留现场动作。',
        createdAt: at,
        updatedAt: at,
        lastOpenedAt: at
      },
      {
        id: ids.secondProject,
        name: AUTHOR_SECOND_PROJECT_NAME,
        genre: '现实',
        description: '第二个隔离项目，用于空搜索结果和列表排序。',
        targetReaders: '成年读者',
        coreAppeal: '人物关系',
        style: '细节优先。',
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
        lastOpenedAt: '2026-09-19T00:00:00.000Z'
      }
    ],
    storyBibles: [{
      projectId: ids.longProject,
      worldbuilding: '旧城档案馆与钟楼之间存在一套未公开的交接记录。',
      corePremise: '修复员从一页缺失的账簿里找到送信人的线索。',
      protagonistDesire: '找到账簿缺页的去向。',
      protagonistFear: '再次把关键证据交给错误的人。',
      mainConflict: '证据在被公开前可能被人为改写。',
      powerSystem: '',
      bannedTropes: '',
      styleSample: '以具体动作和可验证的物件推进场景。',
      narrativeTone: '克制、紧张。',
      immutableFacts: '钟楼账簿确有缺页；铜钥匙来自旧档案室。',
      updatedAt: at
    }],
    characters: [{
      id: ids.character,
      projectId: ids.longProject,
      name: '林默',
      role: '旧城档案修复员',
      roleFunction: '旧城档案修复员',
      surfaceGoal: '找到账簿的缺页',
      deepDesire: '重新相信自己的判断',
      deepNeed: '重新相信自己的判断',
      coreFear: '再次错过真相',
      protagonistRelationship: '对送信人的身份保持怀疑',
      decisionLogic: '先核对证据，再做决定',
      abilitiesAndResources: '旧地图、铜钥匙、修复工具',
      weaknessAndCost: '右手指节仍有伤',
      relationshipTension: '对送信人的身份保持怀疑',
      futureHooks: '缺页背面的印痕',
      isMain: true,
      createdAt: at,
      updatedAt: at
    }],
    settings: {
      apiProvider: 'local',
      apiKey: '',
      hasApiKey: false,
      baseUrl: 'http://127.0.0.1:9',
      modelName: 'qa-author-workspace-no-call',
      codexCliPath: '',
      codexCliModel: '',
      temperature: 0,
      maxTokens: 256,
      retryEnabled: false,
      maxRetries: 0,
      requestTimeoutMs: 1000,
      pipelineModelRoles: {},
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'light'
    }
  })

  if (!data.projects.every((project) => project.id.startsWith('qa-author-'))) {
    throw new Error('Author workspace fixture contains an unexpected project id.')
  }
  if (data.settings.apiKey || data.settings.hasApiKey) {
    throw new Error('Author workspace fixture must not contain credentials.')
  }
  return data
}
