// Settles a TxQueue row that the simulation rejected with "Cawonce already
// used" while other rows of its batch passed.
//
// When every row of a batch is rejected, ValidatorService sends each
// "Cawonce already used" row through resolveCawonceUsed, so a row whose
// action a peer mirror landed ends as validated_by_peer. When some rows
// passed, the rejected ones used to go straight to markTxQueueFailed with
// the raw rejection. This gives them the same resolution.
//
// The validator passes in its own resolveCawonceUsed and status writes, so
// this file has no prisma or provider of its own.

export type CawonceUsedResolution = 'done' | 'failed' | 'awaiting_indexer'

/**
 * What the caller still has to do with the row:
 *   'done'             — marked validated_by_peer here; reconcile as succeeded.
 *   'awaiting_indexer' — moved to awaiting_indexer here; the recheck in
 *                        fetchPendingQueue takes it from there.
 *   'failed'           — nothing written; the caller fails the row as before.
 *   'retry'            — resolve threw; reset to pending here so the next
 *                        poll simulates the row again.
 */
export type CawonceUsedSettlement = CawonceUsedResolution | 'retry'

export interface CawonceUsedSettlers {
  resolve: () => Promise<CawonceUsedResolution>
  markValidatedByPeer: () => Promise<unknown>
  markAwaitingIndexer: () => Promise<unknown>
  resetToPending: (err: unknown) => Promise<unknown>
}

export function isCawonceUsedRejection(rejection: string | null | undefined): boolean {
  return (rejection ?? '').includes('Cawonce already used')
}

export async function settleCawonceUsedRejection(s: CawonceUsedSettlers): Promise<CawonceUsedSettlement> {
  let resolution: CawonceUsedResolution
  try {
    resolution = await s.resolve()
  } catch (err) {
    // The rows that passed were already submitted, so a throw here must not
    // reach the poll's catch (it would put those back to pending too).
    await s.resetToPending(err)
    return 'retry'
  }
  if (resolution === 'done') await s.markValidatedByPeer()
  else if (resolution === 'awaiting_indexer') await s.markAwaitingIndexer()
  return resolution
}
