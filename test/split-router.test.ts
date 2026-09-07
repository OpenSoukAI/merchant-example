import { describe, expect, it, vi } from 'vitest'
import { createSplitRouterResolver, registryRead, SPLIT_ROUTER_KEY } from '../src/split-router.ts'

const ROUTER = '0x4444444444444444444444444444444444444444' as const
const REGISTRY = '0x1111111111111111111111111111111111111111' as const

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
    // Both sides of the boundary, so the comparison cannot be relaxed to `<=`
    // without this failing: at exactly `at + ttl` the entry is already stale.
    const read = vi.fn().mockResolvedValue(ROUTER)
    let clock = 0
    const resolve = createSplitRouterResolver({ read, ttlMs: 1000, now: () => clock })
    await resolve()
    clock = 999
    await resolve()
    expect(read).toHaveBeenCalledTimes(1)
    clock = 1000
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

describe('registryRead', () => {
  it('reads getAddress(bytes32) off the registry, and nothing else', async () => {
    // The repo's only eth_call. A typo in the function name or a wrong argument
    // type is a runtime throw on every 402, so the call is pinned whole rather
    // than by its result.
    let seen: Record<string, unknown> | null = null
    const client = {
      readContract: async (args: unknown) => {
        seen = args as Record<string, unknown>
        return ROUTER
      },
    }
    expect(await registryRead(client, REGISTRY)(SPLIT_ROUTER_KEY)).toBe(ROUTER)
    expect(seen).toEqual({
      address: REGISTRY,
      abi: [
        {
          type: 'function',
          name: 'getAddress',
          stateMutability: 'view',
          inputs: [{ name: 'key', type: 'bytes32' }],
          outputs: [{ name: '', type: 'address' }],
        },
      ],
      functionName: 'getAddress',
      args: [SPLIT_ROUTER_KEY],
    })
  })
})
