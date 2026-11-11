import type { HardCanonActorActionCheck } from '../../shared/types'
import type { ActorIdentity, actorDirectory, StateBasis } from './actorState'
import { alternatives, type Clause, type Span } from './text'

const pronoun = /^(?:他们|她们|他|她|它|我|你|对方|那人|此人|自己)/
const otherAgent = /看见|看着|看到|望见|目睹|发现|注视|听见|听到|任由|命令|吩咐|要求|提醒|劝|让|叫来|教会|交给|递给|被|目送|(?:的|身旁的|身后的)(?:助手|同伴|朋友|妹妹|哥哥|弟弟|姐姐|师父|师傅|徒弟|部下|人)/
const negative = /(?:并非|不是|不曾|从未|从没|未曾|没有|并未|没能|未能|不能|无法|不肯|不愿|不敢|不再|没再|拒绝|放弃|险些|差点|差一点|禁止|不许|不得|未|没|不)/
const noResult = /^(?:不(?:住|起|动|成|到|了|出|开|上|下)|不得|未遂)|(?:未遂|未果|失败|(?:并未|从未|从没)发生过?|是假的|是不可能的|的力气也没有)$/
const uncertainAction = /似乎|好像|仿佛|想要|打算|准备|试图|尝试|正要|将要|本该|应该|必须|能否|会不会|能不能|假装|佯装|谎称|以为|声称|据说|传说|听说|梦到|梦见|不一定/
const limb = /[左右](?:侧的?|边的?)?(?:手腕|手臂|手掌|手肘|手背|手指|手心|肩膀|胳膊|膝盖|眼睛|手|臂|肩|腕|掌|肘|腿|脚|膝|足|眼|耳|翼)(?:上|中|里)?/gu
const possessiveOther = /(?:[他她它你我]们?|别人|对方|那人)(?:的|那只)|(?:左|右)手[边旁侧]/
const preamble = /^(?:(?:此刻|这时|现在|如今|眼下|随后|接着|于是|只见|随即|紧接着|转眼|突然|忽然|接下来)\s*)*$/
const preModifiers = /^(?:正(?:在)?|仍(?:然|旧)?|依(?:然|旧)|已经|终于|猛地|轻轻(?:地)?|缓缓(?:地)?|慢慢(?:地)?|紧紧(?:地)?|立刻|立即|突然|忽然|随即|顺手|反手|亲手|悄悄(?:地)?|悄然|直接|试探性地|又|便|才|已|也|就|一把|用|以|的|那只|这只|一只|自己|\s)*$/u
const aspect = /^(?:起来|[住着了过起出紧开上下在\s])*$/u
const classifier = /^(?:[了着过住起出紧开上下]|起来|自己(?:的)?|[这那一两][把柄支只盏张根枚本块条扇面个件副]|\s)*$/u
const movement = /^(?:抬|举|挥|伸|活动|挪|转动|扭|摆|弯曲|动|扬|抬高|放下|收回|使用|用)/
const limbState = /^(?:受伤|骨折|骨裂|流血|出血|疼(?:痛)?|发抖|痊愈|麻木|红肿|失去知觉)$/
const disposal = /(?:把|将)\s*(?:[这那一两][把柄支只盏张根枚本块条扇面个件副])?\s*$/u

export interface ActionEvidence extends Span {
  actionStart: number
  actionEnd: number
  doubt?: string
}

function subject(prefix: string, tail: string, clause: Clause, who: ActorIdentity, dir: ReturnType<typeof actorDirectory>) {
  const mentions = [...prefix.matchAll(dir.pattern)]
  const last = mentions.at(-1)
  if (last) {
    if (!who.names.includes(last[0])) return null
    const lead = prefix.slice(0, last.index), gap = prefix.slice(last.index! + last[0].length)
    if (otherAgent.test(gap) && !gap.includes('自己')) return null
    if (/(?:和|与|跟|替|帮|给|对|向|叫|请|扶着|身后的|身旁的)[\p{Script=Han}]{1,6}$/u.test(gap.replace(limb, ''))) return null
    const doubt = pronoun.exec(last[0])?.[0] === last[0] ? '代词没有明确绑定到该角色' :
      (dir.ambiguous(last[0]) || who.unresolvedId) ? '姓名或别名不能唯一确定角色' :
      !preamble.test(lead) ? '句中有其他成分，不能确定动作归属' : undefined
    return { gap, lead, doubt }
  }
  const p = pronoun.exec(prefix)
  if (p && !who.names.some((name) => tail.includes(name))) {
    return { gap: prefix.slice(p[0].length), lead: '', doubt: '代词没有明确绑定到该角色' }
  }
  if (who.names.some((name) => clause.previous.includes(name)) && preModifiers.test(prefix.replace(limb, ''))) {
    return { gap: prefix, lead: '', doubt: '本分句省略主语，不能沿用前一分句的角色' }
  }
  return null
}

// Consume only a small positive grammar. Mere co-occurrence outside it never blocks.
function predicate(c: HardCanonActorActionCheck, objects: RegExp, gap: string, verb: string, tail: string): string | null | undefined {
  const before = [...gap.matchAll(limb)], inVerb = [...verb.matchAll(limb)], after = [...tail.matchAll(limb)]
  const limbs = [...before, ...inVerb, ...after]
  if (c.side && limbs.length && !limbs.some((m) => m[0][0] === c.side)) return null
  let doubt: string | undefined
  if (c.side && !limbs.length) doubt = '正文没有写明动作使用哪一侧'
  if (c.side && limbs.some((m) => m[0][0] !== c.side)) doubt = '两侧同时出现，不能确定动作使用哪一侧'
  if (possessiveOther.test(gap + verb + tail)) doubt = '肢体或物件的归属不明'

  let prep = gap.replace(limb, ''), rest = tail
  if (c.objects?.length) {
    const beforeObject = [...gap.matchAll(objects)].find((m) =>
      disposal.test(gap.slice(0, m.index)) || (limbState.test(verb) &&
        before.some((part) => part.index! <= m.index! && part.index! + part[0].length >= m.index! + m[0].length)))
    const inAction = [...verb.matchAll(objects)].some((m) => verb.endsWith(m[0]))
    const afterObject = [...tail.matchAll(objects)].find((m) => {
      const part = after.find((p) => p.index! <= m.index! && p.index! + p[0].length >= m.index! + m[0].length)
      return classifier.test(tail.slice(0, part?.index ?? m.index).replace(limb, ''))
    })
    if (!beforeObject && !inAction && !afterObject) {
      if (!/^(?:了|着|过|住|起)*(它|那个|这个|此物)$/.test(tail)) return null
      doubt = '物件只用代词指称'
    }
    if (beforeObject && disposal.test(gap.slice(0, beforeObject.index))) {
      prep = (gap.slice(0, beforeObject.index).replace(disposal, '') +
        gap.slice(beforeObject.index! + beforeObject[0].length)).replace(limb, '')
    }
    if (afterObject) rest = tail.slice(afterObject.index! + afterObject[0].length)
  }
  if (c.side && !before.length && !inVerb.length && after.length && !movement.test(verb) && !/^(?:在|于)/u.test(tail)) {
    doubt = '动作后的肢体不一定属于该角色'
  }
  if (!preModifiers.test(prep) || !aspect.test(rest.replace(limb, ''))) doubt ??= '动作周围的修饰或后续成分需要核对'
  return doubt
}

function contraryTerms(state: string): RegExp {
  const terms = ['不再' + state, '没有' + state, '并未' + state, '并非' + state]
  if (state === '昏迷') terms.push('醒来', '醒转', '苏醒', '恢复意识', '恢复了意识', '清醒')
  if (/伤|骨折|骨裂/.test(state)) terms.push('痊愈', '伤愈', '伤好了', '伤势好了')
  return alternatives(terms)
}

function priorContradiction(clause: Clause, state: string, pattern: RegExp, who: ActorIdentity, dir: ReturnType<typeof actorDirectory>): boolean {
  if (clause.uncertain || uncertainAction.test(clause.text)) return false
  for (const m of clause.text.matchAll(pattern)) {
    const tail = clause.text.slice(m.index! + m[0].length)
    const owner = subject(clause.text.slice(0, m.index), tail, clause, who, dir)
    if (!owner || owner.doubt || negative.test(owner.gap) || !aspect.test(tail)) continue
    const part = owner.gap.match(limb)
    if (part?.some((p) => (state.includes('左') && p.startsWith('右')) || (state.includes('右') && p.startsWith('左')))) continue
    if (preModifiers.test(owner.gap.replace('从' + state + '中', '').replace(limb, '').replace(/^先/, ''))) return true
  }
  return false
}

export function actionEvidence(c: HardCanonActorActionCheck, basis: StateBasis, dir: ReturnType<typeof actorDirectory>, clauses: Clause[]): ActionEvidence[] {
  if (basis === 'absent') return []
  const who = dir.identities.get(c)!, verbs = alternatives(c.actions), objects = alternatives(c.objects ?? [])
  const changes = c.state && contraryTerms(c.state)
  const out: ActionEvidence[] = []
  let contrary = false
  for (const clause of clauses) {
    for (const event of clause.text.matchAll(verbs)) {
      const prefix = clause.text.slice(0, event.index), tail = clause.text.slice(event.index! + event[0].length)
      const actor = subject(prefix, tail, clause, who, dir)
      if (!actor || negative.test(actor.gap) || /(?:并非|不是|并不是|不可能是)$/.test(actor.lead) || noResult.test(tail)) continue
      const relation = predicate(c, objects, actor.gap, event[0], tail)
      if (relation === null) continue
      const doubt = actor.doubt ?? (clause.uncertain || uncertainAction.test(clause.text) ? '可能是引语、转述、回忆或非实然叙述' : undefined) ??
        relation ?? (basis === 'conflict' || contrary ? '角色状态的证据相互冲突' :
          basis === 'missing' ? '截至目标章，没有足以确认该角色条件状态的事实' : undefined)
      const actionStart = clause.start + event.index!
      out.push({ start: clause.start, end: clause.end, actionStart, actionEnd: actionStart + event[0].length, doubt })
    }
    // A forbidden transition (e.g. 醒来) is itself the event under audit; only prior
    // narrative evidence can weaken the precondition for a subsequent event.
    if (!contrary && c.state && changes && priorContradiction(clause, c.state, changes, who, dir)) contrary = true
  }
  return out
}
