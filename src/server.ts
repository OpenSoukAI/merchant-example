import { serve } from '@hono/node-server'
import { createPublicClient, http } from 'viem'
import { Hono } from 'hono'
import { loadConfig, type Address, type Config } from './config.ts'
import { directApp } from './direct-endpoint.ts'
import { referralApp } from './referral-endpoint.ts'
import { createSplitRouterResolver, registryRead } from './split-router.ts'

export function createServer(
  cfg: Config,
  deps: { resolveSplitRouter?: () => Promise<Address>; fetchImpl?: typeof fetch } = {},
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
  // Order matters: the more specific route is mounted first.
  app.route('/buy/referral', referralApp(cfg, resolveSplitRouter, { fetchImpl: deps.fetchImpl }))
  app.route('/buy', directApp(cfg))
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig(process.env)
  serve({ fetch: createServer(cfg).fetch, port: cfg.port })
  console.log(`merchant-example listening on ${cfg.port}`)
  console.log(`  direct   POST ${cfg.publicUrl}/buy`)
  console.log(`  referral GET/POST ${cfg.publicUrl}/buy/referral`)
}
