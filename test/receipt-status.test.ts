import { describe, expect, it, vi } from 'vitest'
import { createReceiptStatus } from '../src/server.ts'

const HASH = `0x${'ab'.repeat(32)}` as const
const OTHER = `0x${'cd'.repeat(32)}` as const

describe('createReceiptStatus', () => {
  it('returns the status of the receipt for exactly this hash, with replacement detection off', async () => {
    const wait = vi.fn().mockResolvedValue({ status: 'success', transactionHash: HASH })
    expect(await createReceiptStatus({ waitForTransactionReceipt: wait })(HASH)).toBe('success')
    expect(wait).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH, checkReplacement: false }))
  })

  it('never reports another transaction (a same-nonce replacement) as this payment', async () => {
    const wait = vi.fn().mockResolvedValue({ status: 'success', transactionHash: OTHER })
    expect(await createReceiptStatus({ waitForTransactionReceipt: wait })(HASH)).toBeNull()
  })

  it('returns null when the wait fails or times out', async () => {
    const wait = vi.fn().mockRejectedValue(new Error('timeout'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await createReceiptStatus({ waitForTransactionReceipt: wait })(HASH)).toBeNull()
    err.mockRestore()
  })
})
