/**
 * Validator identity drift warning — boot-time check that the configured
 * `validatorId` is a name this node's validator key actually owns.
 *
 * Why: CawActions credits each batch's implicit tip to `validatorId`
 * (`addTokensToBalance(validatorId, implicitTipOwed)`), and only checks that
 * the token exists. `validatorId` is written into config.json as a number at
 * install time. After a CawProfile-cascade redeploy tokenIds are reassigned,
 * so the configured id can end up belonging to someone else: batches keep
 * landing, and their tips keep going to that holder. Nothing fails.
 *
 * Same approach as adminTokenIdGuard: read the indexed User row, compare the
 * owner with the signer address, warn loudly. Advisory only — never blocks
 * boot (naming another holder as the tip recipient can be deliberate), never
 * throws.
 */

import { prisma } from '../prismaClient'
import { logger } from './logger'

export async function warnIfValidatorIdNotOwned(validatorId: number, signerAddress: string): Promise<void> {
  try {
    const signer = signerAddress.toLowerCase()
    const user = await prisma.user.findUnique({
      where: { tokenId: validatorId },
      select: { username: true, address: true },
    })

    let problem: string | null = null
    if (!user) {
      problem =
        `  validatorId ${validatorId} has no indexed account on this node. Either the\n` +
        `  indexer hasn't reached it yet, or no such name exists in this deployment.`
    } else if (!user.address || user.address.toLowerCase() !== signer) {
      problem =
        `  validatorId ${validatorId} (@${user.username}) is owned by ${user.address ?? 'unknown'},\n` +
        `  not by this validator's key (${signerAddress}).`
    }

    if (!problem) {
      logger.log(`[validatorIdGuard] validatorId ${validatorId} (@${user!.username}) is owned by the validator key — OK`)
      return
    }

    logger.warn(
      '\n\n' +
      '════════════════════════════════════════════════════════════════════\n' +
      '  ⚠️  VALIDATOR ID MAY BE STALE — batch tips may go to someone else\n' +
      '════════════════════════════════════════════════════════════════════\n' +
      problem + '\n\n' +
      '  Every batch this node submits credits its tip to validatorId.\n' +
      '  tokenIds REASSIGN on a contract redeploy, so an id set at install\n' +
      '  time can silently point at a different holder.\n\n' +
      '  This is a WARNING ONLY — the validator keeps running.\n\n' +
      '  ➜  Set the Validator service\'s validatorId in client/config.json\n' +
      '     (and VALIDATOR_ID in client/.env) to a tokenId your validator\n' +
      '     key owns, then restart.\n' +
      '════════════════════════════════════════════════════════════════════\n',
    )
  } catch (err) {
    // Advisory check only — a DB hiccup here must never affect the validator.
    logger.warn('[validatorIdGuard] check skipped (non-fatal):', (err as Error)?.message)
  }
}
