import { Hono } from 'hono'
import type { Config } from './config.ts'

/**
 * The merchant's ordinary paid route, exactly as it was before OpenSouk: paid on
 * the merchant's own wallet, with no attribution extensions and no protocol
 * facilitator. It is in this repo to be READ, not modified — the diff between
 * this file and referral-endpoint.ts is the whole integration.
 */
export function directApp(cfg: Config): Hono {
  const app = new Hono()

  app.on(['GET', 'POST'], '/', (c) =>
    c.json(
      {
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: cfg.network,
            asset: cfg.usdc,
            amount: cfg.priceBaseUnits,
            payTo: cfg.directPayTo,
            maxTimeoutSeconds: 60,
            extra: { name: 'USD Coin', version: '2' },
          },
        ],
      },
      402,
    ),
  )

  return app
}
