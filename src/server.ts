import { serve } from '@hono/node-server'
import { createPublicClient, http } from 'viem'
import { Hono } from 'hono'
import { loadConfig, type Address, type Config } from './config.ts'
import { directApp } from './direct-endpoint.ts'
import { referralApp, type ReceiptStatus } from './referral-endpoint.ts'
import { createSettlementSigner, type SettlementSigner } from './settlement-auth.ts'
import { createSplitRouterResolver, registryRead } from './split-router.ts'

/**
 * The buyer's client allows 90 s end-to-end and settle can itself take up to
 * 60 s, so this bound must leave headroom rather than add a second 60 s wait.
 */
const RECEIPT_WAIT_MS = 20_000

export function createServer(
  cfg: Config,
  deps: {
    resolveSplitRouter?: () => Promise<Address>
    fetchImpl?: typeof fetch
    signer?: SettlementSigner
    receiptStatus?: ReceiptStatus
  } = {},
): Hono {
  // Built once and reused for both the registry resolver and the receipt check,
  // rather than one throwaway client per concern.
  const client = createPublicClient({ transport: http(cfg.rpcUrl) })

  const resolveSplitRouter =
    deps.resolveSplitRouter ??
    createSplitRouterResolver({
      read: registryRead(client as never, cfg.addressRegistry),
    })

  const receiptStatus: ReceiptStatus =
    deps.receiptStatus ??
    (async (hash) => {
      try {
        const r = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_WAIT_MS })
        return r.status
      } catch (err) {
        console.error('receipt check failed for', hash, err)
        return null
      }
    })

  const app = new Hono()
  // Mount order is free here: `directApp` registers only '/', so at /buy it matches
  // /buy and nothing under it, and cannot shadow the referral route.
  app.route(
    '/buy/referral',
    referralApp(cfg, resolveSplitRouter, {
      fetchImpl: deps.fetchImpl,
      signer: deps.signer,
      receiptStatus,
    }),
  )
  app.route('/buy', directApp(cfg))
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig(process.env)
  serve({ fetch: createServer(cfg).fetch, port: cfg.port })
  console.log(`merchant-example listening on ${cfg.port}`)
  console.log(`  direct   POST ${cfg.publicUrl}/buy`)
  console.log(`  referral GET/POST ${cfg.publicUrl}/buy/referral`)
  // Printed so an operator can check the grant landed on the key this process actually holds:
  // an ungranted signer is refused by the facilitator on every sale, flag or no flag.
  console.log(
    `  settlement signer ${createSettlementSigner(cfg.signerPrivateKey).address} ` +
      `(must hold SETTLEMENT_SIGNER_ROLE for this merchant, or be the merchant owner)`,
  )
}
