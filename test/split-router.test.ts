import { describe, expect, it, vi } from 'vitest'
import { createSplitRouterResolver, SPLIT_ROUTER_KEY } from '../src/split-router.ts'

const ROUTER = '0x4444444444444444444444444444444444444444' as const

describe('SPLIT_ROUTER_KEY', () => {
  it('is keccak256 of the ASCII string, which is what the registry stores', () => {
    // `cast keccak SPLIT_ROUTER`
    expect(SPLIT_ROUTER_KEY).toBe(
      '0xed44b415a72cb8f8d7da588f592040273e436462fcf951665e3fe33a01207ed5',
    )
  })
})

describe('createSplitRouterResolver', () => {
  it('asks the registry for the split router key', async () => {
    const read = vi.fn().mockResolvedValue(ROUTER)
    const resolve = createSplitRouterResolver({ read })
    expect(await resolve()).toBe(ROUTER)
    expect(read).toHaveBeenCalledWith(SPLIT_ROUTER_KEY)
  })

  it('caches, so a 402 does not cost an RPC call', async () => {
    const read = vi.fn().mockResolvedValue(ROUTER)
    const resolve = createSplitRouterResolver({ read })
    await resolve()
    await resolve()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('re-reads after the TTL, because the registry can be changed by timelock', async () => {
    const read = vi.fn().mockResolvedValue(ROUTER)
    let clock = 0
    const resolve = createSplitRouterResolver({ read, ttlMs: 1000, now: () => clock })
    await resolve()
    clock = 1001
    await resolve()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue(ROUTER)
    const resolve = createSplitRouterResolver({ read })
    await expect(resolve()).rejects.toThrow('rpc down')
    expect(await resolve()).toBe(ROUTER)
  })
})
