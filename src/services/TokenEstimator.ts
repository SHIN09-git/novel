export class TokenEstimator {
  static estimate(text: string): number {
    if (!text.trim()) return 0

    let cjk = 0
    let ascii = 0
    let other = 0

    for (const char of text) {
      if (/[\u4e00-\u9fff]/.test(char)) {
        cjk += 1
      } else if (/[\x00-\x7F]/.test(char)) {
        ascii += 1
      } else {
        other += 1
      }
    }

    return Math.ceil(cjk * 1.5 + ascii / 4 + other)
  }

  static compressionAdvice(tokenCount: number, budget: number): string[] {
    if (tokenCount <= budget) return ['当前 prompt 在预算内，可以直接使用。']

    return [
      '优先压缩旧章节详细回顾，保留阶段摘要替代流水账。',
      '移除低权重或已回收伏笔，只保留中/高/回收权重伏笔。',
      '只保留主要角色和当前章节相关角色的当前状态。',
      '归档已回收信息，除非本章需要明确回看。',
      `当前超出约 ${tokenCount - budget} token，建议切换轻量模式或关闭时间线模块。`
    ]
  }
}
