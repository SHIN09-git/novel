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

    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return
    }

    const deficit = tokens - this.tokens
    const waitMs = Math.ceil((deficit / this.refillRate) * 1000)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    this.refill()
    this.tokens = Math.max(0, this.tokens - tokens)
  }

  getAvailableTokens(): number {
    this.refill()
    return Math.floor(this.tokens)
  }
}
