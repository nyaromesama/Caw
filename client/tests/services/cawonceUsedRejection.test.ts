import { expect } from 'chai'
import {
  isCawonceUsedRejection,
  settleCawonceUsedRejection,
  type CawonceUsedResolution,
} from '../../src/utils/cawonceUsedRejection'

// A "Cawonce already used" rejection in a partly passing batch goes through
// resolveCawonceUsed, as it does when every row is rejected. These cover
// which status write each resolution makes.
function settlers(resolve: () => Promise<CawonceUsedResolution>) {
  const calls: string[] = []
  return {
    calls,
    s: {
      resolve,
      markValidatedByPeer: async () => { calls.push('validated_by_peer') },
      markAwaitingIndexer: async () => { calls.push('awaiting_indexer') },
      resetToPending: async (err: unknown) => { calls.push(`pending: ${(err as Error).message}`) },
    },
  }
}

describe('isCawonceUsedRejection', () => {
  it('matches the decoded CawonceUsed rejection', () => {
    expect(isCawonceUsedRejection('CawonceUsed — Cawonce already used')).to.equal(true)
    expect(isCawonceUsedRejection('Cawonce already used')).to.equal(true)
  })

  it('does not match other rejections or a missing one', () => {
    expect(isCawonceUsedRejection('UserNotAuth — sender not authenticated on this Network')).to.equal(false)
    expect(isCawonceUsedRejection('')).to.equal(false)
    expect(isCawonceUsedRejection(undefined)).to.equal(false)
    expect(isCawonceUsedRejection(null)).to.equal(false)
  })
})

describe('settleCawonceUsedRejection', () => {
  it("marks the row validated_by_peer on 'done'", async () => {
    const { calls, s } = settlers(async () => 'done')
    expect(await settleCawonceUsedRejection(s)).to.equal('done')
    expect(calls).to.deep.equal(['validated_by_peer'])
  })

  it("moves the row to awaiting_indexer on 'awaiting_indexer'", async () => {
    const { calls, s } = settlers(async () => 'awaiting_indexer')
    expect(await settleCawonceUsedRejection(s)).to.equal('awaiting_indexer')
    expect(calls).to.deep.equal(['awaiting_indexer'])
  })

  it("writes nothing on 'failed', leaving the row to the caller", async () => {
    const { calls, s } = settlers(async () => 'failed')
    expect(await settleCawonceUsedRejection(s)).to.equal('failed')
    expect(calls).to.deep.equal([])
  })

  it('resets the row to pending when resolve throws, instead of throwing', async () => {
    const { calls, s } = settlers(async () => { throw new Error('getBlockNumber failed') })
    expect(await settleCawonceUsedRejection(s)).to.equal('retry')
    expect(calls).to.deep.equal(['pending: getBlockNumber failed'])
  })
})
