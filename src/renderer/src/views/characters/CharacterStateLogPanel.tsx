import type {
  Chapter,
  CharacterCardField,
  CharacterStateLog,
  ID,
  StateFactCategory
} from '../../../../shared/types'
import type { CharacterStateFactDraft } from '../../../../services/CharacterStateService'
import { SelectField, TextInput } from '../../components/FormFields'
import { StatusBadge } from '../../components/UI'
import { formatDate } from '../../utils/format'
import { CARD_FIELD_LABELS, STATE_CATEGORY_OPTIONS } from './characterStateUi'

export type CharacterLogSaveMode = 'log_only' | 'fact' | 'candidate'

interface CharacterStateLogPanelProps {
  draftKey: string
  chapters: Chapter[]
  logs: CharacterStateLog[]
  logNote: string
  logChapter: number | null
  logSaveMode: CharacterLogSaveMode
  conversionLogId: ID | null
  conversionDraft: CharacterStateFactDraft | null
  logSaving: boolean
  logMessage: string
  conversionSaving: boolean
  conversionMessage: string
  onLogNoteChange: (value: string) => void
  onLogChapterChange: (value: number | null) => void
  onLogSaveModeChange: (value: CharacterLogSaveMode) => void
  onRecordLog: () => void
  onBeginConvertLog: (log: CharacterStateLog) => void
  onConvertLogToCandidate: (log: CharacterStateLog) => void
  onPatchConversionDraft: (patch: Partial<CharacterStateFactDraft>) => void
  onConfirmConvertLogToFact: (log: CharacterStateLog) => void
  onCancelConversion: () => void
}

export function CharacterStateLogPanel({
  draftKey,
  chapters,
  logs,
  logNote,
  logChapter,
  logSaveMode,
  conversionLogId,
  conversionDraft,
  logSaving,
  logMessage,
  conversionSaving,
  conversionMessage,
  onLogNoteChange,
  onLogChapterChange,
  onLogSaveModeChange,
  onRecordLog,
  onBeginConvertLog,
  onConvertLogToCandidate,
  onPatchConversionDraft,
  onConfirmConvertLogToFact,
  onCancelConversion
}: CharacterStateLogPanelProps) {
  return (
    <div className="panel character-log-panel">
      <h2>状态日志 / 历史记录</h2>
      <p className="muted">日志只记录一次状态变化，不会自动进入动态状态账本；需要选择同步入账，或在日志卡片上点击“转为状态事实 / 转为候选”。</p>
      <div className="inline-form">
        <select aria-label="日志来源章节" value={logChapter ?? ''} onChange={(event) => onLogChapterChange(event.target.value ? Number(event.target.value) : null)}>
          <option value="">未关联章节</option>
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.order}>
              第 {chapter.order} 章
            </option>
          ))}
        </select>
        <input aria-label="状态变化内容" value={logNote} placeholder="记录这次状态变化" onChange={(event) => onLogNoteChange(event.target.value)} />
        <select aria-label="日志保存方式" value={logSaveMode} onChange={(event) => onLogSaveModeChange(event.target.value as CharacterLogSaveMode)}>
          <option value="log_only">仅记录日志</option>
          <option value="fact">同步写入动态状态账本</option>
          <option value="candidate">创建待确认候选</option>
        </select>
        <button className="primary-button" disabled={logSaving || !logNote.trim()} onClick={onRecordLog}>{logSaving ? '保存中…' : '记录'}</button>
      </div>
      <p className="character-form-status" role="status">{logMessage}</p>
      <p className="character-form-status" role="status" hidden={!conversionMessage}>{conversionMessage}</p>
      <div className="log-list">
        {logs.map((log) => (
          <article key={log.id}>
            <strong>{log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}</strong>
            <p>{log.note}</p>
            <small>{formatDate(log.createdAt)}</small>
            {log.linkedFactId ? <StatusBadge tone="success">已转入账本：{log.linkedFactId}</StatusBadge> : null}
            {log.linkedCandidateId ? <StatusBadge tone="info">已转为候选：{log.linkedCandidateId}</StatusBadge> : null}
            {!log.linkedFactId && !log.linkedCandidateId ? (
              <div className="row-actions">
                <button className="ghost-button" onClick={() => onBeginConvertLog(log)}>转为状态事实</button>
                <button className="ghost-button" disabled={conversionSaving} onClick={() => onConvertLogToCandidate(log)}>转为候选</button>
              </div>
            ) : null}
            {conversionLogId === log.id && conversionDraft ? (
              <div className="state-log-conversion-form">
                <div className="form-grid compact">
                  <TextInput label="状态名称" value={conversionDraft.label} bufferKey={`${draftKey}:${conversionLogId}`} onChange={(label) => onPatchConversionDraft({ label, key: label })} />
                  <SelectField
                    label="类别"
                    value={conversionDraft.category ?? 'custom'}
                    options={STATE_CATEGORY_OPTIONS}
                    onChange={(category: StateFactCategory) => onPatchConversionDraft({ category })}
                  />
                  <TextInput label="状态值" value={String(conversionDraft.value ?? '')} bufferKey={`${draftKey}:${conversionLogId}`} onChange={(value) => onPatchConversionDraft({ value, valueType: 'text' })} />
                  <SelectField
                    label="追踪等级"
                    value={conversionDraft.trackingLevel ?? 'hard'}
                    options={[
                      { value: 'hard', label: '硬状态' },
                      { value: 'soft', label: '软状态' },
                      { value: 'note', label: '参考备注' }
                    ]}
                    onChange={(trackingLevel) => onPatchConversionDraft({ trackingLevel })}
                  />
                  <SelectField
                    label="Prompt 策略"
                    value={conversionDraft.promptPolicy ?? 'when_relevant'}
                    options={[
                      { value: 'always', label: '始终引入' },
                      { value: 'when_relevant', label: '相关时引入' },
                      { value: 'manual_only', label: '仅手动引入' }
                    ]}
                    onChange={(promptPolicy) => onPatchConversionDraft({ promptPolicy })}
                  />
                </div>
                <div className="checkbox-grid">
                  {Object.entries(CARD_FIELD_LABELS).map(([fieldKey, fieldLabel]) => (
                    <label key={fieldKey}>
                      <input
                        type="checkbox"
                        checked={(conversionDraft.linkedCardFields ?? []).includes(fieldKey as CharacterCardField)}
                        onChange={(event) => {
                          const currentFields = conversionDraft.linkedCardFields ?? []
                          onPatchConversionDraft({
                            linkedCardFields: event.target.checked
                              ? [...new Set([...currentFields, fieldKey as CharacterCardField])]
                              : currentFields.filter((field) => field !== fieldKey)
                          })
                        }}
                      />
                      {fieldLabel}
                    </label>
                  ))}
                </div>
                <div className="row-actions">
                  <button className="primary-button" disabled={conversionSaving} onClick={() => onConfirmConvertLogToFact(log)}>{conversionSaving ? '保存中…' : '确认转入账本'}</button>
                  <button className="ghost-button" onClick={onCancelConversion}>取消</button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
