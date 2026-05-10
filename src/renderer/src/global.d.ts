import type { NovelDirectorAPI } from '../../preload/index'

declare global {
  interface Window {
    novelDirector: NovelDirectorAPI
  }
}

export {}
