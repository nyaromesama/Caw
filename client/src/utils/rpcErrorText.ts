// A short text for an RPC / ethers error, to build a rejection string from.
//
// ethers errors read "<shortMessage> (key=value, ...)", and for a failed
// eth_call the key=value part has the whole transaction: from, to and the
// calldata. The validator's temporary-error check looks for '429' anywhere
// in the rejection, so the digits 429 somewhere in the calldata or the
// validator's address made the rejection look like a rate limit. And
// ethers turns every JSON-RPC error on eth_call into "missing revert data",
// keeping the node's own text ("rate limit exceeded", ...) only in
// info.error.message, so a real rate limit didn't look like one.
//
// So take ethers' shortMessage (or the whole message for other errors) and
// add the node's message when there is one.

export function rpcErrorText(err: any): string {
  const text = typeof err?.shortMessage === 'string' ? err.shortMessage : String(err?.message ?? '')
  const nodeMessage = err?.info?.error?.message
  return typeof nodeMessage === 'string' && nodeMessage && !text.includes(nodeMessage)
    ? `${text} (${nodeMessage})`
    : text
}
