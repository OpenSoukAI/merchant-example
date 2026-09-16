import { serve } from '@hono/node-server'
import { createPublicClient, http } from 'viem'
import { Hono } from 'hono'
import { loadConfig, type Address, type Config } from './config.ts'
import { directApp } from './direct-endpoint.ts'
import { referralApp } from './referral-endpoint.ts'
import { createSettlementSigner, type SettlementSigner } from './settlement-auth.ts'
import { createSplitRouterResolver, registryRead } from './split-router.ts'

export function createServer(
  cfg: Config,
  deps: {
    resolveSplitRouter?: () => Promise<Address>
    fetchImpl?: typeof fetch
    signer?: SettlementSigner
  } = {},
): Hono {
  const resolveSplitRouter =
    deps.resolveSplitRouter ??
    createSplitRouterResolver({
      read: registryRead(
        createPublicClient({ transport: http(cfg.rpcUrl) }) as never,
        cfg.addressRegistry,
      ),
    })

  const app = new Hono()
  // Mount order is free here: `directApp` registers only '/', so at /buy it matches
  // /buy and nothing under it, and cannot shadow the referral route.
  app.route(
    '/buy/referral',
    referralApp(cfg, resolveSplitRouter, { fetchImpl: deps.fetchImpl, signer: deps.signer }),
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
