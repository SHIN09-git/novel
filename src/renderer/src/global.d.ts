import type { NovelAPI, NovelDirectorAPI } from '../../preload/index'

declare global {
  interface Window {
    novelDirector: NovelDirectorAPI
    /** @deprecated Prefer window.novelDirector grouped APIs in new renderer code. */
    novelAPI: NovelAPI
  }
}

export {}
