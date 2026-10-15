/**
 * SponsorRepayIndexer — a failed DB write must hold the cursor.
 *
 * The handlers used to catch every DB error and only log it, so processEvents
 * resolved and the poll loop advanced its checkpoint past an event that was
 * never written. These tests pin:
 *   - handlers rethrow DB failures (P2025 on Swept/Forgiven = no row, skipped)
 *   - a rejected processEvents leaves the checkpoint where it was, re-reads the
 *     same window, and backs off instead of re-polling every 250ms
 *
 * No DB, Redis or RPC: Prisma is injected via _setPrismaForTest, and the
 * provider / contract / redis handed to makePollLoop are plain stubs.
 */

import { describe, it, afterEach } from 'mocha'
import { expect } from 'chai'
import { _forTests, _setPrismaForTest } from '../../../src/services/SponsorRepayIndexer'

const {
  makePollLoop,
  handleSponsorRepaySet,
  handleSponsorRepayRegistered,
  handleSponsorRepaySwept,
  handleSponsorRepayForgiven,
} = _forTests

function prismaThatFails(err: any): any {
  const fail = async () => { throw err }
  return { sponsorRepay: { upsert: fail, update: fail } }
}

function p2025(): any {
  const err: any = new Error('Record to update not found.')
  err.code = 'P2025'
  return err
}

async function rejects(p: Promise<unknown>): Promise<boolean> {
  try { await p; return false } catch { return true }
}

// args shaped like ethers.Result: (tokenId, sponsorTokenId, a, b)
const args = [7, 1, 10n ** 18n, 5n] as any

describe('SponsorRepayIndexer handlers', () => {
  afterEach(() => _setPrismaForTest(null))

  it('SponsorRepaySet rethrows a DB failure', async () => {
    _setPrismaForTest(prismaThatFails(new Error('db down')))
    expect(await rejects(handleSponsorRepaySet(args, '0xabc'))).to.equal(true)
  })

  it('SponsorRepayRegistered rethrows a DB failure', async () => {
    _setPrismaForTest(prismaThatFails(new Error('db down')))
    expect(await rejects(handleSponsorRepayRegistered(args, '0xabc'))).to.equal(true)
  })

  it('SponsorRepaySwept / Forgiven rethrow a DB failure', async () => {
    _setPrismaForTest(prismaThatFails(new Error('db down')))
    expect(await rejects(handleSponsorRepaySwept(args))).to.equal(true)
    expect(await rejects(handleSponsorRepayForgiven(args))).to.equal(true)
  })

  it('SponsorRepaySwept / Forgiven skip a missing row (P2025)', async () => {
    _setPrismaForTest(prismaThatFails(p2025()))
    expect(await rejects(handleSponsorRepaySwept(args))).to.equal(false)
    expect(await rejects(handleSponsorRepayForgiven(args))).to.equal(false)
  })

  it('handlers resolve when the write succeeds', async () => {
    const ok = async () => ({})
    _setPrismaForTest({ sponsorRepay: { upsert: ok, update: ok } } as any)
    expect(await rejects(handleSponsorRepaySet(args, '0xabc'))).to.equal(false)
    expect(await rejects(handleSponsorRepayRegistered(args, '0xabc'))).to.equal(false)
    expect(await rejects(handleSponsorRepaySwept(args))).to.equal(false)
    expect(await rejects(handleSponsorRepayForgiven(args))).to.equal(false)
  })
})

describe('SponsorRepayIndexer poll loop', () => {
  const realSetTimeout = global.setTimeout
  afterEach(() => { (global as any).setTimeout = realSetTimeout })

  it('holds the checkpoint when processEvents rejects, re-reads the window, and backs off', async () => {
    const POLL_MS = 60_000
    const windows: Array<[number, number]> = []
    const saved: string[] = []
    const scheduled: Array<{ fn: () => void; ms: number }> = []
    let failWrites = true

    // Record the loop's next-poll timer instead of arming it.
    ;(global as any).setTimeout = (fn: () => void, ms: number) => {
      scheduled.push({ fn, ms })
      return 0 as any
    }

    const provider: any = { getBlockNumber: async () => 110 }
    const contract: any = {
      filters: { SponsorRepaySet: () => ({}) },
      queryFilter: async (_f: unknown, from: number, to: number) => {
        windows.push([from, to])
        return [{ blockNumber: 105, index: 0, args, eventName: 'SponsorRepaySet', transactionHash: '0xabc' }]
      },
    }
    const redis: any = { set: async (_k: string, v: string) => { saved.push(v) } }

    const loop = makePollLoop({
      label: 'test',
      provider,
      contract,
      redis,
      cpKey: 'k',
      startBlock: 100,
      maxBlocks: 1000,
      pollMs: POLL_MS,
      heartbeat: () => {},
      alive: () => true,
      processEvents: async () => { if (failWrites) throw new Error('db down') },
    })

    const nextTick = async (n: number) => {
      for (let i = 0; i < 200 && scheduled.length < n; i++) {
        await new Promise(r => setImmediate(r))
      }
      expect(scheduled.length).to.equal(n)
    }

    loop.start()
    await nextTick(1)
    expect(windows).to.deep.equal([[101, 110]])
    expect(saved).to.deep.equal([])            // cursor held
    expect(scheduled[0].ms).to.equal(POLL_MS)  // not the 250ms catch-up rate

    scheduled[0].fn()
    await nextTick(2)
    expect(windows).to.deep.equal([[101, 110], [101, 110]])  // same window again
    expect(saved).to.deep.equal([])
    expect(scheduled[1].ms).to.equal(2 * POLL_MS)

    failWrites = false
    scheduled[1].fn()
    await nextTick(3)
    expect(windows[2]).to.deep.equal([101, 110])
    expect(saved).to.deep.equal(['110'])       // advances once the write lands
    expect(scheduled[2].ms).to.equal(POLL_MS)
  })
})
