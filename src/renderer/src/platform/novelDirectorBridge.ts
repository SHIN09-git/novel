type NovelDirectorBridge = Window['novelDirector']

function readBridge(): NovelDirectorBridge | undefined {
  return (window as Window & { novelDirector?: NovelDirectorBridge }).novelDirector
}

export function getNovelDirectorBridge(): NovelDirectorBridge {
  const bridge = readBridge()
  if (!bridge) {
    throw new Error('应用桥接未加载。请重新启动应用，或重新构建安装包。')
  }
  return bridge
}

export function getNovelDirectorDataApi(): NovelDirectorBridge['data'] {
  const data = getNovelDirectorBridge().data
  if (!data?.load || !data.save) {
    throw new Error('数据桥接未加载。请重新启动应用，或重新构建安装包。')
  }
  return data
}

export function getNovelDirectorAppApi(): NovelDirectorBridge['app'] {
  const app = getNovelDirectorBridge().app
  if (!app?.getStoragePath || !app.selectStoragePath) {
    throw new Error('应用设置桥接未加载。请重新启动应用，或重新构建安装包。')
  }
  return app
}

export function getNovelDirectorBackupApi(): NovelDirectorBridge['backup'] {
  const backup = getNovelDirectorBridge().backup
  if (!backup?.create || !backup.list) {
    throw new Error('备份桥接未加载。请重新启动应用，或重新构建安装包。')
  }
  return backup
}

export function getNovelDirectorLogsApi(): NovelDirectorBridge['logs'] {
  const logs = getNovelDirectorBridge().logs
  if (!logs?.getPath || !logs.open) {
    throw new Error('日志桥接未加载。请重新启动应用，或重新构建安装包。')
  }
  return logs
}

export function getNovelDirectorCredentialsApi(): NovelDirectorBridge['credentials'] {
  const credentials = getNovelDirectorBridge().credentials
  if (!credentials?.hasApiKey || !credentials.setApiKey || !credentials.deleteApiKey) {
    throw new Error('凭据桥接未加载。请重新启动应用，或重新构建安装包。')
  }
  return credentials
}
