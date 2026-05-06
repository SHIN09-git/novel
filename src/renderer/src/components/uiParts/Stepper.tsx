export function Stepper({
  steps,
  labels
}: {
  steps: Array<{ id: string; status: string; type?: string }>
  labels: Partial<Record<string, string>>
}) {
  return (
    <div className="stepper">
      {steps.map((step, index) => (
        <div key={step.id} className={`stepper-item ${step.status}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{labels[step.type ?? step.id] ?? step.type ?? step.id}</strong>
            <small>{step.status}</small>
          </div>
        </div>
      ))}
    </div>
  )
}
