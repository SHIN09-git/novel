import type { AppDataArrayKey } from '../../shared/appDataCollections'

export type SqliteValue = string | number | null

export interface SqliteStatement {
  run(...values: SqliteValue[]): unknown
  get(...values: SqliteValue[]): Record<string, unknown> | undefined
  all(...values: SqliteValue[]): Array<Record<string, unknown>>
}

export interface SqliteDatabase {
  backup(destinationFile: string): Promise<unknown>
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  pragma(sql: string): unknown
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult
  close(): void
}

export interface SqliteOpenOptions {
  readonly?: boolean
  fileMustExist?: boolean
}

export type SqliteDatabaseConstructor = new (path: string, options?: SqliteOpenOptions) => SqliteDatabase

export type { AppDataArrayKey } from '../../shared/appDataCollections'

export interface SqliteEntityEntry {
  collection: AppDataArrayKey
  value: unknown
  indexJobId?: string | null
}
