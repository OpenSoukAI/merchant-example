# merchant-example

A worked OpenSouk referral endpoint, in about 200 lines of TypeScript.

Start with the [merchant quickstart](https://docs.opensouk.ai/quickstart/merchant) — it is
the integration end to end. This repo is the executable version of it.

## Requirements

Two different floors, for two different reasons:

- **Runtime — Node 20+.** The example itself (hono, `@hono/node-server`, viem) has no dependency on
  anything newer. Serve it on Node 20 with `npx tsx src/server.ts`, or compile `src/` with `tsc`
  first — either way you load the environment yourself, since `npm start` reads `.env` through
  Node's own `--env-file-if-exists`, which arrived in 22.9.
- **Repo tooling — Node 24+.** `npm test` and `npm run typecheck` need it: vitest 5 supports
  `^22.12 || ^24 || >=26`, and Node's unflagged TypeScript stripping (which is what lets `npm
  start` run `src/server.ts` directly, with no build step) only starts at 23.6. 24 is the lowest
  version where both work. This is a constraint of this repo's tooling, not of the OpenSouk
  protocol.

## The four things merchants get wrong

1. **Answer both `POST` and `GET`.** Buyer tooling POSTs; the readiness probe GETs. An endpoint
   registered on POST alone reports as not ready even though purchases against it succeed.
   → `src/referral-endpoint.ts`
2. **Resolve `payTo` from the address registry; do not configure it.** Registry entries change
   behind a timelock, and a `402` naming last week's split router does not settle.
   → `src/split-router.ts`
3. **A rejected payment is HTTP `200` with `success: false`.** Branch on the body. Branching on the
   status reads a refusal as a completed sale. → `src/settle.ts`
4. **Read `PAYMENT-SIGNATURE`, not `X-PAYMENT`.** The latter is x402 v1, which the onboarding
   manifest's prose recipe still names. → `src/settle.ts`

## The shape

Two routes. `/buy` is the merchant's ordinary paid route, and this repo never modifies it. Its
`payTo` is the merchant's own wallet and it carries no attribution fields.

`/buy/referral` is the copy: same product, same price, same auth, differing only in `payTo`, the
facilitator, and the echoed `extensions`. **Those three fields are the whole integration.** The
rest of what `src/referral-endpoint.ts` adds over `src/direct-endpoint.ts` is the ordinary x402
retry handshake — decode `PAYMENT-SIGNATURE`, settle, then serve — which `direct-endpoint.ts`
omits and a merchant already selling over x402 already has.

You register `/buy/referral` as the product's `endpoint_url`, so it is where ref links send buyers.

## Run it

```bash
cp .env.example .env    # then fill it in
npm install
npm start                # Node 24+; on Node 20 use: npx tsx src/server.ts
```

Nothing is deployed on a public chain yet, so the values in `.env.example` are placeholders —
zero addresses and a `eip155:0` network — not any particular chain's real values.

```bash
# the probe path: a 402 naming the split router
curl -s -X POST localhost:8083/buy/referral | jq '.accepts[0].payTo, .extensions'
```

```
"0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
{
  "attributionToken": "",
  "setup_url": "http://127.0.0.1:8082/.well-known/referrer-agent"
}
```

(`payTo` above came from a local registry read during testing — resolved, not configured, per
point 2 above.)

## What this example does not do

No wallet, no signer, no private key — on the x402 path a merchant signs nothing, so no key
handling appears anywhere in this repo. Minting the merchant identity and listing the product are
one-time setup steps the quickstart covers with `cast` and `curl`; they are deliberately not here.

## Dependencies

`hono` (the server), `@hono/node-server` (its Node adapter), and `viem` (one `eth_call` and one
`keccak256`). Nothing else.
