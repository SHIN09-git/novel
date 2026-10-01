import type { Foreshadowing, ForeshadowingTreatmentMode, ID } from '../../../../shared/types'
import {
  effectiveTreatmentMode,
  FORESHADOWING_TREATMENT_OPTIONS,
  treatmentDescription
} from '../../../../shared/foreshadowingTreatment'
import { SelectField, Toggle } from '../../components/FormFields'
import { statusLabel, treatmentModeLabel, weightLabel } from '../../utils/format'

interface PromptManualForeshadowingPanelProps {
  foreshadowings: Foreshadowing[]
  autoForeshadowingIds: Set<ID>
  selectedForeshadowingIds: ID[]
  treatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  onToggleForeshadowing: (id: ID, checked: boolean) => void
  onTreatmentOverrideChange: (id: ID, nextMode: ForeshadowingTreatmentMode) => void
  onSaveTreatmentMode: (id: ID) => void
}

export function PromptManualForeshadowingPanel({
  foreshadowings,
  autoForeshadowingIds,
  selectedForeshadowingIds,
  treatmentOverrides,
  onToggleForeshadowing,
  onTreatmentOverrideChange,
  onSaveTreatmentMode
}: PromptManualForeshadowingPanelProps) {
  return (
    <section className="panel">
      <h2>手动选择本章相关伏笔</h2>
      <div className="stack-list">
        {foreshadowings.map((item) => {
          const isAuto = autoForeshadowingIds.has(item.id)
          const effectiveMode = effectiveTreatmentMode(item, treatmentOverrides)
          return (
            <div key={item.id} className="context-item">
              <Toggle
                label={`${item.title || '未命名伏笔'}${isAuto ? '（自动推荐）' : ''}`}
                checked={selectedForeshadowingIds.includes(item.id)}
                onChange={(checked) => onToggleForeshadowing(item.id, checked)}
              />
              <p className="muted">
                状态：{statusLabel(item.status)} · 权重：{weightLabel(item.weight)} · 预计回收：{item.expectedPayoff || '未设置'} · 本章处理：{treatmentModeLabel(effectiveMode)}
              </p>
              <div className="inline-controls">
                <SelectField<ForeshadowingTreatmentMode>
                  label="临时处理方式"
                  value={effectiveMode}
                  onChange={(nextMode) => onTreatmentOverrideChange(item.id, nextMode)}
                  options={FORESHADOWING_TREATMENT_OPTIONS}
                />
                <button className="ghost-button" onClick={() => onSaveTreatmentMode(item.id)}>保存为当前处理方式</button>
              </div>
              <p className="muted">{treatmentDescription(effectiveMode)}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
