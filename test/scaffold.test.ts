// test/scaffold.test.ts
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'

describe('the harness itself', () => {
  it('can drive a Hono app without a server', async () => {
    const app = new Hono()
    app.get('/ping', (c) => c.text('pong'))
    const res = await app.request('/ping')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('pong')
  })
})
