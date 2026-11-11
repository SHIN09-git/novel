import { fstatSync, lstatSync, type Stats } from 'node:fs'

export function assertReservedLibraryFile(path: string, fd?: number): void {
  const reserved = (s: Stats) => s.isFile() && s.size === 0 && s.nlink === 1
  const pathStat = lstatSync(path)
  const stat = fd === undefined ? pathStat : fstatSync(fd)
  if (!reserved(pathStat) || !reserved(stat) || pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) {
    throw new Error('新建书库需要独占预留的零字节普通文件。')
  }
}
