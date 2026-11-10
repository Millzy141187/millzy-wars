import { describe, expect, test } from 'bun:test'
import type { ServerMessage } from '../src/games/bedwars/protocol'
import { RelayGame } from '../src/sites/relay'
import { supabaseRealtime, type Channel } from '../src/supabase/realtime'

// Models a public Supabase Realtime channel: presence keyed by tab, JSON
// payloads, ordered fanout, and no server-assigned sender id (the payload
// carries it), which is what the adapter maps to RelayMessage.
function bus() {
  type Entry = { data: Record<string, unknown> | null; live: boolean; broadcast?: (m: { payload?: unknown }) => void; sync?: () => void }
  const entries = new Map<string, Entry>()
  let maxBytes = 0
  const snapshot = () =>
    Object.fromEntries([...entries].filter(([, e]) => e.live && e.data).map(([key, e]) => [key, [{ ...e.data!, presence_ref: key }]]))
  const sync = () => {
    for (const entry of entries.values()) if (entry.live) entry.sync?.()
  }
  const channel = (key: string): Channel => {
    const entry: Entry = { data: null, live: false }
    entries.set(key, entry)
    const self: Channel = {
      on(type, _filter, callback) {
        if (type === 'broadcast') entry.broadcast = callback
        else entry.sync = () => callback({})
        return self
      },
      subscribe(callback) {
        entry.live = true
        callback('SUBSCRIBED')
        return self
      },
      async track(data) {
        entry.data = structuredClone(data)
        sync()
        return 'ok'
      },
      async send(message) {
        const payload = JSON.parse(JSON.stringify(message.payload)) as unknown
        maxBytes = Math.max(maxBytes, new TextEncoder().encode(JSON.stringify(message)).length)
        for (const [otherKey, other] of entries)
          if (otherKey !== key && other.live) other.broadcast?.({ payload: structuredClone(payload) })
        return 'ok'
      },
      presenceState: <T>() => snapshot() as Record<string, T[]>,
      async unsubscribe() {
        entry.live = false
        entry.data = null
        sync()
        return 'ok'
      },
    }
    return self
  }
  return { channel, stats: () => ({ maxBytes }) }
}

function harness() {
  let now = 0
  const b = bus()
  const clients: { game: RelayGame; name: string; messages: ServerMessage[]; errors: string[] }[] = []
  const pending: (() => void)[] = []
  const drain = () => {
    while (pending.length) pending.shift()!()
  }
  const add = (hosting: boolean, name: string) => {
    let game!: RelayGame
    const client = { game: null as unknown as RelayGame, name, messages: [] as ServerMessage[], errors: [] as string[] }
    const realtime = supabaseRealtime(
      b.channel,
      (m) => pending.push(() => client.game.receive(m)),
      (s) => pending.push(() => client.game.status(s)),
    )
    game = new RelayGame({ name, hosting, world: 'arena', room: 'test', fast: false }, realtime, () => now)
    client.game = game
    game.onMessage((m) => client.messages.push(m))
    game.onClose((m) => client.errors.push(m))
    clients.push(client)
    drain()
    return client
  }
  const step = (count = 1) => {
    for (let n = 0; n < count; n++) {
      now += 50
      for (const c of clients) c.game.tick()
      if (now % 100 === 0) for (const c of clients) c.game.flush()
      drain()
    }
  }
  return { add, step, stats: b.stats }
}

describe('Supabase game transport', () => {
  test('four players meet, receive worlds and share chat over public channels', () => {
    const h = harness()
    const host = h.add(true, 'Host')
    h.step(4)
    const guests = [h.add(false, 'Ada'), h.add(false, 'Bo'), h.add(false, 'Cy')]
    h.step(140)
    for (const c of [host, ...guests]) {
      expect(c.errors).toEqual([])
      expect(c.messages.some((m) => m.t === 'welcome')).toBe(true)
      expect(c.messages.some((m) => m.t === 'self')).toBe(true)
    }
    guests[0].game.send({ t: 'chat', text: 'hello over supabase' })
    h.step(30)
    expect(host.messages.some((m) => m.t === 'event' && m.text.includes('hello over supabase'))).toBe(true)
    expect(guests[2].messages.some((m) => m.t === 'event' && m.text.includes('hello over supabase'))).toBe(true)
    // The relay's 12 KiB frame budget is what Supabase's broadcast payload carries.
    expect(h.stats().maxBytes).toBeLessThan(16 * 1024)
  })

  test('a guest leaving frees its seat for another player', () => {
    const h = harness()
    const host = h.add(true, 'Host')
    h.step(4)
    const first = h.add(false, 'First')
    h.step(60)
    first.game.close()
    h.step(400)
    const late = h.add(false, 'Late')
    h.step(120)
    expect(host.errors).toEqual([])
    expect(late.errors).toEqual([])
    expect(late.messages.some((m) => m.t === 'welcome')).toBe(true)
  })
})
