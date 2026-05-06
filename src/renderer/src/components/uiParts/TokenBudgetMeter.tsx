export function TokenBudgetMeter({
  value,
  max,
  label = 'Token 预算'
}: {
  value: number
  max: number
  label?: string
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const over = value > max

  return (
    <div className={`token-meter ${over ? 'over' : ''}`}>
      <div className="token-meter-head">
        <span>{label}</span>
        <strong>
          {value.toLocaleString()} / {max.toLocaleString()}
        </strong>
      </div>
      <div className="token-meter-track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{over ? '已超出预算，建议压缩旧章节和低权重信息。' : `已使用 ${percent}%`}</small>
    </div>
  )
}
