/**
 * What to do with a row of an ERC-1271 group whose submit failed.
 *
 * A failed submit does not mean the action did not land:
 *   - the receipt wait timed out, and the tx is still pending or landed late
 *   - the tx landed just before a restart; after the restart the row went
 *     back to pending and was sent again, and the second tx reverts with
 *     CawonceUsed
 *   - a peer mirror landed the same action first
 * Marking every row failed records a failure for an action that is on
 * chain. The ECDSA bisect path checks resolveCawonceUsed for the same reason.
 *
 * So ask the cawonce bitmap first (CawActions.isCawonceUsed; the ERC-1271
 * sibling applies actions through CawActions, so they share it), and only
 * run resolveCawonceUsed for a cawonce that is used. The order matters on
 * this path: submitERC1271Actions sends even when estimateGas fails, so a
 * row put back to 'pending' on resolveCawonceUsed's 'awaiting_indexer' (or
 * on a used cawonce that is not ours) would be sent again and revert every
 * poll. Used cawonces therefore end as validated_by_peer, awaiting_indexer
 * (rechecked by fetchPendingQueue without re-sending) or failed, never
 * pending.
 *
 * A cawonce that is not used goes back to 'pending' only after a receipt
 * timeout (unknown outcome: the tx may be dropped or still in the mempool;
 * if it lands meanwhile, the re-send reverts and this check settles the row
 * next time); the same holds when the bitmap can't be read after a timeout.
 * Any other error keeps its old verdict, failed.
 */

export type FailedERC1271Verdict =
  | { kind: 'landed' }
  | { kind: 'awaiting_indexer' }
  | { kind: 'pending' }
  | { kind: 'failed'; reason: string }

export async function settleFailedERC1271Row(opts: {
  submitError: string
  timedOut: boolean
  isCawonceUsed: () => Promise<boolean>
  resolveCawonceUsed: () => Promise<'done' | 'failed' | 'awaiting_indexer'>
}): Promise<FailedERC1271Verdict> {
  let used: boolean | null
  try {
    used = await opts.isCawonceUsed()
  } catch {
    used = null
  }
  if (used === true) {
    const resolution = await opts.resolveCawonceUsed()
    if (resolution === 'done') return { kind: 'landed' }
    if (resolution === 'awaiting_indexer') return { kind: 'awaiting_indexer' }
    return { kind: 'failed', reason: 'Cawonce already used' }
  }
  if (opts.timedOut) return { kind: 'pending' }
  return { kind: 'failed', reason: opts.submitError }
}
