import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog'
import { HardCanonView } from '../../src/renderer/src/views/HardCanonView'
import type { SaveDataHandler } from '../../src/renderer/src/utils/saveDataState'
import type { AppData } from '../../src/shared/types'

// This renderer only has the two loopback endpoints of the temporary book.
export async function verifyDesktop() {
  const load = async (): Promise<AppData> => (await fetch('/book')).json()
  let data = await load(), writes = 0, pending: Promise<unknown> = Promise.resolve()
  const root = createRoot(document.getElementById('root')!)
  const render = () => flushSync(() => root.render(<ConfirmProvider>
    <HardCanonView data={data} project={data.projects[0]} saveData={save} />
  </ConfirmProvider>))
  const save: SaveDataHandler = (input) => {
    const operation = (async () => {
      const next = typeof input === 'function' ? input(data) : input
      const response = await fetch('/book', { method: 'POST', body: JSON.stringify(next) })
      if (!response.ok) throw new Error(await response.text())
      data = await load()
      writes++
      render()
      return { ok: true as const }
    })()
    pending = operation
    return operation
  }
  const editor = () => document.querySelector('.hard-canon-draft')!
  const article = (title: string) => [...document.querySelectorAll('article')].find((el) => el.querySelector('strong')?.textContent === title)!
  const expect = (ok: unknown, label: string) => { if (!ok) throw new Error('Desktop: ' + label) }
  const field = (name: string) => {
    const label = [...editor().querySelectorAll('label')].find((node) => node.querySelector('.field-label')?.textContent === name)
    if (!label) throw new Error('Missing field: ' + name)
    return label.querySelector('input,textarea,select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  }
  function fill(name: string, value: string) {
    const el = field(name)
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!
    setter.call(el, value)
    flushSync(() => el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })))
  }
  async function click(name: string, container: Element = editor()) {
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === name)
    if (!btn) throw new Error('Missing button: ' + name)
    flushSync(() => btn.click())
    await pending
    await new Promise((done) => setTimeout(done, 16))
  }
  const notice = () => editor().querySelector('[role=status]')?.textContent ?? ''
  render()
  expect(article('旧纸条')?.textContent?.includes('只作写作提示'), 'legacy prose gained a check')
  expect(article('坏条件')?.textContent?.includes('只作写作提示'), 'malformed data gained a check')
  fill('标题', '封笺提示'); fill('内容', '封笺不得提前拆开。')
  await click('复用已有条目')
  expect(writes === 0 && notice().includes('复用') && notice().includes('停用'), 'MCP record changed during desktop reuse')

  function literal(title: string) {
    fill('标题', title); fill('内容', '印笺上少用暮纹。'); fill('检查方式', 'terms')
    fill('检查用语（每行一项）', '暮纹\n暮印'); fill('例外用语（每行一项）', '暮纹阁')
    fill('核查结果', 'block')
  }
  literal('01. 暮纹')
  fill('全书次数上限', '三次')
  await click('新增条目')
  expect(writes === 0 && notice().includes('check.maxPerBook'), 'invalid cap became a chapter ban')
  fill('全书次数上限', '2'); fill('起始章（含）', '4'); fill('结束章（含）', '2')
  await click('新增条目')
  expect(writes === 0 && notice().includes('check.toChapter'), 'reversed range was accepted')
  fill('起始章（含）', ''); fill('结束章（含）', '')
  await click('新增条目')
  const stored = article('01. 暮纹')
  expect(stored?.textContent?.includes('全书最多 2 次') && !stored.textContent.includes('本章禁止'), 'book-only cap display')
  await click('编辑', stored)
  expect(field('本章次数上限').value === '' && field('全书次数上限').value === '2', 'reopened caps')
  fill('全书次数上限', '3')
  await click('保存修改')
  literal('02. 暮纹'); fill('全书次数上限', '3')
  expect(editor().querySelector('.hard-canon-comparison')?.textContent?.includes('01. 暮纹'), 'unnumbered comparison result missing')
  await click('另存为独立条目')

  await click('编辑', article('袖扣规则'))
  expect(field('绑定角色卡（可选）').value === 'c1' && field('侧别').value === '右' && field('动作（每行一项）').value === '扣紧', 'MCP role condition failed to refill')
  fill('角色别名（每行一项）', '阿迟\n南窗'); fill('适用状态（可选）', '手腕固定')
  fill('动作要求', 'allow'); fill('侧别', '左'); fill('物件（每行一项）', '袖扣\n表带')
  fill('结束章（含）', '9')
  await click('保存修改')

  fill('标题', '外文字形'); fill('内容', '正文避免外文字形。'); fill('检查方式', 'latin')
  fill('例外用语（每行一项）', 'AQUA-9')
  await click('新增条目')
  expect(article('外文字形')?.textContent?.includes('本章禁止出现') && article('外文字形').textContent?.includes('仅提示复核'), 'default literal limit or enforcement')
  await click('编辑', article('坏条件'))
  fill('检查方式', 'latin'); fill('指定外文用语（每行一项，可留空）', 'ember\nmast')
  await click('保存修改')
  await click('编辑', article('坏条件'))
  expect(field('指定外文用语（每行一项，可留空）').value === 'ember\nmast', 'Latin filter did not survive saving')
  fill('检查方式', 'hint')
  await click('保存修改')
  expect(article('坏条件').textContent?.includes('只作写作提示'), 'explicit removal from desktop retained the check')
  return { writes }
}
