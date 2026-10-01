export const PROMPT_TAB_IDS = Object.freeze({
  task: 'prompt-workspace-tab-task',
  editor: 'prompt-workspace-tab-editor',
  context: 'prompt-workspace-tab-context',
  history: 'prompt-workspace-tab-history'
})

export const PROMPT_PANEL_IDS = Object.freeze({
  task: 'prompt-workspace-panel-task',
  editor: 'prompt-workspace-panel-editor',
  context: 'prompt-workspace-panel-context',
  history: 'prompt-workspace-panel-history'
})

export const PROMPT_TAB_LABELS = Object.freeze({ task: '任务', editor: 'Prompt', context: '上下文', history: '历史' })

export const TASK_FIELD_LABELS = Object.freeze([
  '本章目标',
  '本章必须推进的冲突',
  '本章必须保留的悬念',
  '本章允许回收的伏笔',
  '本章禁止回收的伏笔',
  '本章结尾钩子',
  '本章读者应该产生的情绪',
  '本章预计字数',
  '文风要求'
])

export const HOME_SELECTORS = Object.freeze({
  root: '.home',
  projectList: '.home-project-list',
  projectRows: '.project-row',
  search: '[data-testid="project-search"], input[aria-label="搜索项目"], input[placeholder="搜索项目"]',
  newProjectToggle: '.home-header-action.primary-button',
  newProjectForm: '#create-project-form',
  editForm: '.home-edit-form',
  saveStatus: '.workspace-save-state,[role="status"],.notice.danger'
})

export const PROMPT_SELECTORS = Object.freeze({
  root: '.prompt-view',
  tablist: '[role="tablist"][aria-label="Prompt 工作区"]',
  commandBar: '.prompt-command-bar',
  textarea: 'textarea.prompt-editor[aria-label="最终 Prompt"]'
})

export const AUTHOR_WORKSPACE_SELECTOR_CONTRACT = Object.freeze({
  prompt: {
    tablist: PROMPT_SELECTORS.tablist,
    tabs: Object.fromEntries(Object.entries(PROMPT_TAB_IDS).map(([key, id]) => [key, `#${id}[role="tab"]`])),
    panels: Object.fromEntries(Object.entries(PROMPT_PANEL_IDS).map(([key, id]) => [key, `#${id}`])),
    commandBar: PROMPT_SELECTORS.commandBar,
    buildButton: `${PROMPT_SELECTORS.commandBar} button`,
    editor: PROMPT_SELECTORS.textarea
  },
  home: {
    root: HOME_SELECTORS.root,
    projectList: HOME_SELECTORS.projectList,
    projectRows: HOME_SELECTORS.projectRows,
    search: HOME_SELECTORS.search,
    newProjectToggle: HOME_SELECTORS.newProjectToggle,
    newProjectForm: HOME_SELECTORS.newProjectForm,
    editForm: HOME_SELECTORS.editForm,
    fieldLookup: 'label.field > .field-label + input/textarea, or a stable data-testid per field',
    saveStatus: HOME_SELECTORS.saveStatus
  }
})

export function json(value) {
  return JSON.stringify(value)
}

export function firstSelector(selectors, root = 'document') {
  return `[...${json(selectors)}].map((selector) => ${root}.querySelector(selector)).find(Boolean)`
}

export function buttonWithText(labels, root = 'document') {
  return `[...(${root}).querySelectorAll('button')].find((button) => ${json(labels)}.includes(button.textContent.trim()))`
}

export function fieldByLabel(label, root = 'document') {
  return `([...(${root}).querySelectorAll('label')].find((field) => field.querySelector('.field-label')?.textContent.trim() === ${json(label)})?.querySelector('input,textarea') ?? null)`
}

export function projectRowByName(name) {
  return `([...document.querySelectorAll(${json(HOME_SELECTORS.projectRows)})].find((row) => row.querySelector('h3')?.textContent.trim() === ${json(name)}) ?? null)`
}

export function contrastInspectionExpression() {
  return `(() => {
    const parse = (value) => {
      const match = value.match(/rgba?\\(([^)]+)\\)/i)
      if (!match) return null
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
      return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 }
    }
    const composite = (foreground, background) => {
      const alpha = foreground.a + background.a * (1 - foreground.a)
      if (!alpha) return { r: 255, g: 255, b: 255, a: 0 }
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha
      }
    }
    const opaqueBackground = (element) => {
      let node = element
      let background = { r: 255, g: 255, b: 255, a: 0 }
      while (node) {
        const color = parse(getComputedStyle(node).backgroundColor)
        if (color) background = composite(background, color)
        if (background.a >= 0.999) break
        node = node.parentElement
      }
      return composite(background, { r: 255, g: 255, b: 255, a: 1 })
    }
    const luminance = (color) => {
      const channel = (value) => { const normalized = value / 255; return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4 }
      return channel(color.r) * 0.2126 + channel(color.g) * 0.7152 + channel(color.b) * 0.0722
    }
    const ratio = (foreground, background) => {
      const a = luminance(foreground), b = luminance(background)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const inspect = (selector, sampleSelector = selector, pseudo = null) => {
      const element = document.querySelector(selector)
      const sample = document.querySelector(sampleSelector) ?? element
      if (!element || !sample) return { selector, missing: true }
      const styles = getComputedStyle(sample, pseudo)
      const foreground = parse(styles.color)
      const background = opaqueBackground(sample)
      return { selector, position: styles.position, color: styles.color, backgroundColor: styles.backgroundColor,
        ratio: foreground ? ratio(composite(foreground, background), background) : 0,
        rect: (() => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, width: box.width, height: box.height } })() }
    }
    return { textarea: inspect(${JSON.stringify('.prompt-editor')}, ${JSON.stringify(PROMPT_SELECTORS.textarea)}),
      header: inspect('.sticky-title-row'),
      homeSearch: inspect('.home-project-search input'),
      homeSearchPlaceholder: inspect('.home-project-search input', '.home-project-search input', '::placeholder'),
      homeCreate: inspect('.home .page-header .primary-button'),
      homeImport: inspect('.home .page-header .ghost-button') }
  })()`
}
