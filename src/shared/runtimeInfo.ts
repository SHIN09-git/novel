export type RuntimeMode = 'development' | 'preview' | 'packaged'

export interface RuntimeInfo {
  version: string
  buildTime: string
  electronVersion: string
  execPath: string
  mode: RuntimeMode
}
