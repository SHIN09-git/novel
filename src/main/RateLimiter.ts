export class TokenBucketRateLimiter {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number
  ) {
    if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('Rate limiter capacity must be positive.')
    if (!Number.isFinite(refillRate) || refillRate <= 0) throw new Error('Rate limiter refill rate must be positive.')
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsedSeconds = Math.max(0, (now - this.lastRefill) / 1000)
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate)
    this.lastRefill = now
  }

  async acquire(tokens = 1): Promise<void> {
    if (!Number.isFinite(tokens) || tokens <= 0) throw new Error('Rate limiter token request must be positive.')
    this.refill()

    // Reserve before waiting so concurrent callers cannot share a refill.
    this.tokens -= tokens
    if (this.tokens >= 0) return

    const waitMs = Math.ceil((-this.tokens / this.refillRate) * 1000)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    this.refill()
  }

  getAvailableTokens(): number {
    this.refill()
    return Math.max(0, Math.floor(this.tokens))
  }
}
