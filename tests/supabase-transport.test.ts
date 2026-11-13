import { describe, expect, test } from 'bun:test'
import type { ServerMessage } from '../src/games/bedwars/protocol'
import { RelayGame, type RelayMessage } from '../src/sites/relay'
import { supabaseRealtime, type Channel } from '../src/supabase/realtime'
import { supabaseTopic } from '../src/supabase/topic'
import type { RoomParams } from '../src/games/bedwars/server'

test('the room code alone decides the Supabase channel', () => {
  const host: RoomParams = { world: 'arena', room: 'friends', fast: true, size: 8 }
  const guest: RoomParams = { world: 'arena', room: 'friends', fast: false, size: 4 }
  expect(supabaseTopic(host)).toBe('bedwars-arena-friends')
  expect(supabaseTopic(guest)).toBe(supabaseTopic(host))
  expect(supabaseTopic({ ...host, room: 'other' })).not.toBe(supabaseTopic(host))
})

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
    game = new RelayGame({ name, hosting, world: 'arena', room: 'test', fast: false, size: 4 }, realtime, () => now)
    client.game = game
    game.onMessage((m) => client.messages.push(m))
    game.onClose((m) => client.errors.push(m))
    clients.push(client)
    drain()
    return client
  }
  const step = async (count = 1) => {
    for (let n = 0; n < count; n++) {
      now += 50
      for (const c of clients) c.game.tick()
      if (now % 100 === 0) for (const c of clients) c.game.flush()
      drain()
      await Promise.resolve()
    }
  }
  return { add, step, stats: b.stats }
}

function controlledChannel() {
  let status: ((state: string) => void) | null = null
  const calls = { removed: 0, tracked: [] as Record<string, unknown>[] }
  const channel: Channel = {
    on() { return channel },
    subscribe(callback) {
      status = callback
      callback('SUBSCRIBED')
      return channel
    },
    async track(data) { calls.tracked.push(data); return 'ok' },
    async send() { return 'ok' },
    presenceState: <T>() => ({}) as Record<string, T[]>,
    async unsubscribe() { calls.removed++; return 'ok' },
  }
  return {
    channel,
    calls,
    drop(state: 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT') { status?.(state) },
  }
}

describe('Supabase game transport', () => {
  test('allows only one frame in flight until Supabase acknowledges it', async () => {
    let complete: ((result: unknown) => void) | undefined
    let sends = 0
    const channel: Channel = {
      on() { return channel },
      subscribe(callback) { callback('SUBSCRIBED'); return channel },
      async track() { return 'ok' },
      send() { sends++; return new Promise((resolve) => { complete = resolve }) },
      presenceState: <T>() => ({}) as Record<string, T[]>,
      async unsubscribe() { return 'ok' },
    }
    const states: string[] = []
    const realtime = supabaseRealtime(() => channel, () => {}, (state) => states.push(state))
    const frame = [['peer', 'generation', 0, 'packet']]
    expect(realtime.broadcast('game', frame)).toBe(true)
    expect(realtime.broadcast('game', frame)).toBe(false)
    expect(sends).toBe(1)
    complete?.({ status: 'ok' })
    await new Promise((done) => setTimeout(done, 0))
    expect(realtime.broadcast('game', [['peer', 'generation', 1, 'next']])).toBe(true)
    expect(sends).toBe(2)
    realtime.close()
  })

  test('treats a Supabase rejected frame as a disconnect so streams resync', async () => {
    const channel: Channel = {
      on() { return channel },
      subscribe(callback) { callback('SUBSCRIBED'); return channel },
      async track() { return 'ok' },
      async send() { return { status: 'error', error: 'rate limited' } },
      presenceState: <T>() => ({}) as Record<string, T[]>,
      async unsubscribe() { return 'ok' },
    }
    const states: string[] = []
    const realtime = supabaseRealtime(() => channel, () => {}, (state) => states.push(state))
    expect(realtime.broadcast('game', [['peer', 'generation', 0, 'packet']])).toBe(true)
    await new Promise((done) => setTimeout(done, 0))
    expect(states).toContain('disconnected')
    realtime.close()
  })

  test('four players meet, receive worlds and share chat over public channels', async () => {
    const h = harness()
    const host = h.add(true, 'Host')
    await h.step(4)
    const guests = [h.add(false, 'Ada'), h.add(false, 'Bo'), h.add(false, 'Cy')]
    await h.step(140)
    for (const c of [host, ...guests]) {
      expect(c.errors).toEqual([])
      expect(c.messages.some((m) => m.t === 'welcome')).toBe(true)
      expect(c.messages.some((m) => m.t === 'self')).toBe(true)
    }
    guests[0].game.send({ t: 'chat', text: 'hello over supabase' })
    await h.step(30)
    expect(host.messages.some((m) => m.t === 'event' && m.text.includes('hello over supabase'))).toBe(true)
    expect(guests[2].messages.some((m) => m.t === 'event' && m.text.includes('hello over supabase'))).toBe(true)
    // The relay's 12 KiB frame budget is what Supabase's broadcast payload carries.
    expect(h.stats().maxBytes).toBeLessThan(16 * 1024)
  })

  test('a closed channel is replaced with a fresh subscription', async () => {
    const made: ReturnType<typeof controlledChannel>[] = []
    const events: RelayMessage[] = []
    const states: string[] = []
    const realtime = supabaseRealtime(
      () => { const next = controlledChannel(); made.push(next); return next.channel },
      (m) => events.push(m),
      (s) => states.push(s),
      { retryMs: 5 },
    )
    expect(made.length).toBe(1)
    expect(events.filter((m) => m.type === 'ready').length).toBe(1)

    made[0].drop('CLOSED')
    await new Promise((done) => setTimeout(done, 30))

    expect(states).toContain('disconnected')
    expect(made.length).toBe(2)
    expect(made[0].calls.removed).toBe(1)
    expect(events.filter((m) => m.type === 'ready').length).toBe(2)
    realtime.close()
    expect(made[1].calls.removed).toBe(1)
  })

  test('a guest leaving frees its seat for another player', async () => {
    const h = harness()
    const host = h.add(true, 'Host')
    await h.step(4)
    const first = h.add(false, 'First')
    await h.step(60)
    first.game.close()
    await h.step(400)
    const late = h.add(false, 'Late')
    await h.step(120)
    expect(host.errors).toEqual([])
    expect(late.errors).toEqual([])
    expect(late.messages.some((m) => m.t === 'welcome')).toBe(true)
  })
})
