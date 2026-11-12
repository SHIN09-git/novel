import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { decodeLibraryText, parseLibraryJsonValue } from '../storage/libraryValidation'

// Bound actual expanded bytes (not the untrusted, modulo-2^32 gzip footer).
// Above this ceiling the automatic writer uses ordinary JSON, with its legacy read path.
export const MAX_GZIP_JSON_BYTES = 384 * 1024 * 1024
export const backupFileFilter = { name: '书库备份 (*.json, *.json.gz)', extensions: ['json', 'gz'] }
export const isBackupFile = (path: string): boolean => /\.json(?:\.gz)?$/i.test(path)

export async function readBackupJson(path: string, limit = MAX_GZIP_JSON_BYTES): Promise<unknown> {
  if (!isBackupFile(path)) throw new Error('请选择 .json 或 .json.gz 书库备份。')
  if (!/\.gz$/i.test(path)) return parseLibraryJsonValue(decodeLibraryText(await readFile(path)))

  const decoder = new TextDecoder('utf-8', { fatal: true }), chunks: string[] = []
  let bytes = 0, inputBytes = 0
  // Allow framing/deflate overhead even for incompressible input. Empty gzip members
  // or padding should not allow unbounded disk reads with little or no JSON output.
  const inputBudget = new Transform({ transform(chunk: Buffer, _encoding, done) {
    inputBytes += chunk.length
    if (inputBytes > limit + 1024 * 1024) done(new Error('压缩备份文件超出大小上限。请改用普通 JSON 备份。'))
    else done(null, chunk)
  } })
  try {
    await pipeline(createReadStream(path), inputBudget, createGunzip(), new Writable({
      write(chunk: Buffer, _encoding, done) {
        try {
          bytes += chunk.length
          if (bytes > limit) throw new Error('备份解压后的 JSON 超出大小上限。请改用普通 JSON 备份。')
          chunks.push(decoder.decode(chunk, { stream: true }))
          done()
        } catch (error) { done(error as Error) }
      }
    }))
    chunks.push(decoder.decode())
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw new Error('书库 JSON 不是有效的 UTF-8 文本。')
    if (code === 'Z_DATA_ERROR' || code === 'Z_BUF_ERROR') throw new Error('Gzip 备份不完整或已损坏。')
    throw error
  }
  return parseLibraryJsonValue(chunks.join(''))
}
