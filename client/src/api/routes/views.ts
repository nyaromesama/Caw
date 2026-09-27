import { Router } from 'express'
import { trackView, trackBulkViews, getTrendingByViews } from '../../services/ViewTracker'
import crypto from 'crypto'
import type { Request } from 'express'
import { extractSession } from '../middleware/auth'

const router = Router()

/**
 * Helper to hash IP address for privacy
 */
function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'default-salt')).digest('hex')
}

/**
 * The viewer's tokenId for de-duplication, only when the request's session is
 * authorized for it. x-user-id alone is a client-supplied header: trusting it
 * let one client count as a different viewer on every request, so views (and
 * the trending list built from them) could be inflated without limit, and the
 * per-caw viewer set grew with every made-up id. Without a matching session the
 * view is keyed by IP hash, as for a signed-out viewer.
 */
async function authorizedViewerId(req: Request): Promise<number | undefined> {
  const raw = req.header('x-user-id')
  if (!raw || !/^[0-9]+$/.test(raw)) return undefined
  const claimed = Number(raw)
  if (req.sessionData === undefined) await extractSession(req)
  return req.sessionData?.authorizedTokenIds.includes(claimed) ? claimed : undefined
}

/**
 * POST /api/views/track
 * Track a single view for a caw
 */
router.post('/track', async (req, res) => {
  try {
    const { cawId } = req.body
    const userId = await authorizedViewerId(req)
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const ipHash = hashIP(ip)

    if (!cawId) {
      return res.status(400).json({ error: 'cawId is required' })
    }

    await trackView({
      cawId: Number(cawId),
      userId,
      ipHash
    })

    return res.json({ success: true })

  } catch (error) {
    console.error('POST /api/views/track error:', error)
    return res.status(500).json({ error: 'Failed to track view' })
  }
})

/**
 * POST /api/views/track-bulk
 * Track views for multiple caws at once (efficient for feed loading)
 */
router.post('/track-bulk', async (req, res) => {
  try {
    const { cawIds } = req.body
    const userId = await authorizedViewerId(req)
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const ipHash = hashIP(ip)

    if (!cawIds || !Array.isArray(cawIds)) {
      return res.status(400).json({ error: 'cawIds array is required' })
    }

    // Limit to 100 caws per request for safety. Drop any non-finite values
    // so a stray null/undefined/NaN in the array can't poison the batch.
    const limitedCawIds = cawIds
      .slice(0, 100)
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0)

    if (limitedCawIds.length === 0) {
      return res.json({ success: true, tracked: 0 })
    }

    await trackBulkViews(limitedCawIds, userId, ipHash)

    return res.json({ success: true, tracked: limitedCawIds.length })

  } catch (error) {
    // View tracking is best-effort — don't surface infra errors (Redis hiccup,
    // etc.) as 500s that pollute the client console. Log and return success.
    console.error('POST /api/views/track-bulk error:', error)
    return res.json({ success: true, tracked: 0 })
  }
})

/**
 * GET /api/views/trending
 * Get caws trending by view count
 */
router.get('/trending', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)

    const trendingCawIds = await getTrendingByViews(limit)

    return res.json({ cawIds: trendingCawIds })

  } catch (error) {
    console.error('GET /api/views/trending error:', error)
    return res.status(500).json({ error: 'Failed to get trending caws' })
  }
})

export default router