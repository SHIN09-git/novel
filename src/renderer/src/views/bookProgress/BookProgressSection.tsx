import { lazy, Suspense, useId, useRef, useState } from 'react'
import { BookOpenCheck, ChevronDown, ListChecks, Pencil } from 'lucide-react'
import { bookWordGoal } from '../../../../shared/normalizers/bookWordTarget'
import type { ProjectProps } from '../viewTypes'
import type { BookProgressNavigation } from './navigation'
import { BookWordTargetEditor } from './BookWordTargetEditor'
import '../../styles/views/book-progress.css'

const BookProgressList = lazy(() => import('./BookProgressList'))
const BookContinuityPanel = lazy(() => import('./BookContinuityPanel'))

function goalLabel({ min, max }: ReturnType<typeof bookWordGoal>) {
  if (min !== null && max !== null) return min === max ? `目标 ${min.toLocaleString()} 字` : `目标 ${min.toLocaleString()} 至 ${max.toLocaleString()} 字`
  if (min !== null) return `目标至少 ${min.toLocaleString()} 字`
  if (max !== null) return `目标不超过 ${max.toLocaleString()} 字`
  return '未设置全书目标'
}

function distanceLabel(goal: ReturnType<typeof bookWordGoal>, totalWords: number) {
  if (goal.overMax) return `超出上限 ${goal.overMax.toLocaleString()} 字`
  if (goal.remainingToMin) return `距下限还差 ${goal.remainingToMin.toLocaleString()} 字`
  if (goal.min !== null) return '已达下限'
  if (goal.max !== null) return totalWords === goal.max ? '已达上限' : `距上限还有 ${(goal.max - totalWords).toLocaleString()} 字`
  return ''
}

export function BookProgressSection({ data, project, saveData, totalWords, ...navigation }:
ProjectProps & BookProgressNavigation & { totalWords: number }) {
  const [panel, setPanel] = useState<'progress' | 'audit' | null>(null)
  const [editing, setEditing] = useState(false)
  const listId = useId()
  const auditId = useId()
  const auditButton = useRef<HTMLButtonElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const goal = bookWordGoal(totalWords, project.bookWordTarget)
  const distance = distanceLabel(goal, totalWords)

  return <section className="book-progress" aria-label="全书进度与核对">
    <div className="book-progress-bar">
      <div className="book-progress-switches">
        <h2><button type="button" aria-expanded={panel === 'progress'} aria-controls={listId}
          onClick={() => setPanel(panel === 'progress' ? null : 'progress')}><ListChecks size={18} />全书进度与缺章<ChevronDown size={15} /></button></h2>
        <h2><button type="button" ref={auditButton} aria-expanded={panel === 'audit'} aria-controls={auditId}
          onClick={() => setPanel(panel === 'audit' ? null : 'audit')}><BookOpenCheck size={18} />全书核对<ChevronDown size={15} /></button></h2>
      </div>
      <div className="book-progress-goal">
        <span>{goalLabel(goal)}</span>
        {distance && <strong>{distance}</strong>}
        <button type="button" className="book-progress-icon" title="编辑全书目标" aria-label="编辑全书目标"
          ref={editButton} aria-expanded={editing} onClick={() => setEditing(true)}><Pencil size={15} /></button>
      </div>
    </div>
    {editing && <BookWordTargetEditor project={project} saveData={saveData}
      onClose={() => { setEditing(false); editButton.current?.focus() }} />}
    <div id={listId} hidden={panel !== 'progress'}>
      {panel === 'progress' && <Suspense fallback={<p role="status">正在读取章节清单…</p>}>
        <BookProgressList data={data} projectId={project.id} {...navigation} />
      </Suspense>}
    </div>
    <div id={auditId} hidden={panel !== 'audit'} onKeyDown={e => {
      if (e.key === 'Escape' && !e.defaultPrevented) { setPanel(null); auditButton.current?.focus() }
    }}>
      {panel === 'audit' && <Suspense fallback={<p role="status">正在核对正式正文…</p>}>
        <BookContinuityPanel key={project.id} data={data} projectId={project.id} onOpenChapter={navigation.onOpenChapter} />
      </Suspense>}
    </div>
  </section>
}
