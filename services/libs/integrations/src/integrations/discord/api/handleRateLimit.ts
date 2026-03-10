import { IProcessStreamContext } from '../../../types'
import { RateLimitError } from '@gitmesh/types'

const DISCORD_RATE_LIMIT = 100000
const DISCORD_RATE_LIMIT_TIME = 100 // 100 seconds
const REDIS_KEY = 'discord-ratelimits-requests-count'

export const getRateLimiter = (ctx: IProcessStreamContext) => {
  return ctx.getRateLimiter(DISCORD_RATE_LIMIT, DISCORD_RATE_LIMIT_TIME, REDIS_KEY)
}

export const retryWrapper = async (maxRetries: number, fn: () => Promise<any>) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await fn()
      return result
    } catch (err: any) {
      // Check if it's a RateLimitError or duck-typed as one across microservices
      const isRateLimit = err instanceof RateLimitError || err.name === 'RateLimitError' || err.rateLimitResetSeconds !== undefined

      if (isRateLimit && i < maxRetries - 1) {
        let waitSeconds = i + 1
        
        if (err.rateLimitResetSeconds !== undefined) {
            // Give an extra 1 second buffer to ensure the reset window has fully passed
            waitSeconds = err.rateLimitResetSeconds + 1
        }
        
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
        continue
      }
      throw err
    }
  }
}
