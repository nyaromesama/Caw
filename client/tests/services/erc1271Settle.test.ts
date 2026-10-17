import { expect } from 'chai'
import { settleFailedERC1271Row } from '../../src/utils/erc1271Settle'

type Resolution = 'done' | 'failed' | 'awaiting_indexer'

// isCawonceUsed: true / false / 'throws'. resolveCawonceUsed's answer, and a
// counter so the tests can tell whether it was asked at all.
function run(opts: { used: boolean | 'throws'; resolution?: Resolution; timedOut: boolean }) {
  let resolveCalls = 0
  const verdict = settleFailedERC1271Row({
    submitError: 'execution reverted: Batch sig invalid',
    timedOut: opts.timedOut,
    isCawonceUsed: async () => {
      if (opts.used === 'throws') throw new Error('missing response')
      return opts.used
    },
    resolveCawonceUsed: async () => {
      resolveCalls++
      return opts.resolution ?? 'failed'
    },
  })
  return verdict.then(v => ({ v, resolveCalls }))
}

describe('settleFailedERC1271Row', () => {
  describe('cawonce used on chain', () => {
    it('same action in the Action table → landed', async () => {
      const { v, resolveCalls } = await run({ used: true, resolution: 'done', timedOut: true })
      expect(v).to.deep.equal({ kind: 'landed' })
      expect(resolveCalls).to.equal(1)
    })

    it('not indexed yet → awaiting_indexer, not pending (would be re-sent)', async () => {
      const { v } = await run({ used: true, resolution: 'awaiting_indexer', timedOut: false })
      expect(v).to.deep.equal({ kind: 'awaiting_indexer' })
    })

    it('a different action holds the cawonce → failed with Cawonce already used', async () => {
      const { v } = await run({ used: true, resolution: 'failed', timedOut: true })
      expect(v).to.deep.equal({ kind: 'failed', reason: 'Cawonce already used' })
    })

    it('settles the same way after a revert as after a timeout', async () => {
      // e.g. the tx landed before a restart, the re-send reverted with CawonceUsed
      const { v } = await run({ used: true, resolution: 'done', timedOut: false })
      expect(v).to.deep.equal({ kind: 'landed' })
    })
  })

  describe('cawonce not used', () => {
    it('after a receipt timeout → pending', async () => {
      const { v, resolveCalls } = await run({ used: false, timedOut: true })
      expect(v).to.deep.equal({ kind: 'pending' })
      expect(resolveCalls).to.equal(0)
    })

    it('after any other error → failed with the submit error, as before', async () => {
      const { v, resolveCalls } = await run({ used: false, timedOut: false })
      expect(v).to.deep.equal({ kind: 'failed', reason: 'execution reverted: Batch sig invalid' })
      expect(resolveCalls).to.equal(0)
    })
  })

  describe('bitmap read fails', () => {
    it('after a receipt timeout → pending', async () => {
      const { v, resolveCalls } = await run({ used: 'throws', timedOut: true })
      expect(v).to.deep.equal({ kind: 'pending' })
      expect(resolveCalls).to.equal(0)
    })

    it('after any other error → failed with the submit error', async () => {
      const { v } = await run({ used: 'throws', timedOut: false })
      expect(v).to.deep.equal({ kind: 'failed', reason: 'execution reverted: Batch sig invalid' })
    })
  })
})
