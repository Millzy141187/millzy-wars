import type { RelayMessage, Realtime } from '../sites/relay'

/**
 * The slice of a Supabase Realtime channel this transport uses. Narrowing it
 * keeps the mapping testable with an in-memory channel; the production client
 * supplies a real one.
 */
export type Channel = {
  on(type: 'broadcast' | 'presence', filter: { event: string }, callback: (message: { payload?: unknown }) => void): Channel
  subscribe(callback: (status: string) => void): Channel
  track(data: Record<string, unknown>): Promise<unknown>
  send(message: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>
  presenceState<T>(): Record<string, T[]>
  unsubscribe(): Promise<unknown>
}

export type RealtimeOptions = {
  /** Remove a dead channel before its replacement joins the same topic. */
  removeChannel?: (channel: Channel) => Promise<unknown>
  /** First backoff between resubscribe attempts; tests shorten it. */
  retryMs?: number
}

/**
 * Supabase Realtime as a `RelayGame` transport. The tab's presence key is also
 * its connection id, because presence is how a host addresses a peer and how a
 * guest recognises the host. Public channels are open to anyone with the room
 * code, exactly like the Sites relay: casual matches, no anti-cheat.
 *
 * A channel can report CHANNEL_ERROR or CLOSED and then stay dead; Supabase
 * does not always rejoin it. Recreate it with backoff so a brief network drop
 * does not end the match. RelayGame resets its streams and asks for a fresh
 * snapshot when the replacement announces a new presence generation.
 */
export function supabaseRealtime(
  makeChannel: (presenceKey: string) => Channel,
  emit: (m: RelayMessage) => void,
  status: (s: string) => void,
  { removeChannel = (channel) => channel.unsubscribe(), retryMs = 2_000 }: RealtimeOptions = {},
): Realtime {
  const connectionId = crypto.randomUUID()
  let identity: Record<string, unknown> | null = null
  let live = false
  let stopped = false
  let channel: Channel | undefined
  let version = 0
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined

  const clearRetry = () => {
    if (retry === undefined) return
    clearTimeout(retry)
    retry = undefined
  }
  const disconnected = () => {
    live = false
    status('disconnected')
  }
  const schedule = () => {
    if (stopped || retry !== undefined) return
    const delay = Math.min(30_000, retryMs * 2 ** Math.min(attempt++, 5))
    retry = setTimeout(() => {
      retry = undefined
      void rebuild()
    }, delay)
  }

  function open() {
    if (stopped) return
    const current = makeChannel(connectionId)
    const v = ++version
    channel = current
    const active = () => !stopped && v === version && channel === current

    current
      .on('broadcast', { event: 'game' }, ({ payload }) => {
        if (!active() || !payload || typeof payload !== 'object') return
        const { from, data } = payload as { from?: unknown; data?: unknown }
        if (typeof from !== 'string') return
        emit({ type: 'broadcast', connectionId: from, userId: from, event: 'game', data })
      })
      .on('presence', { event: 'sync' }, () => {
        if (!active()) return
        const members = Object.entries(current.presenceState<Record<string, unknown>>()).flatMap(([key, entries]) =>
          entries.map((data) => ({ connectionId: key, userId: key, data })),
        )
        emit({ type: 'presence', members })
      })
      .subscribe((state) => {
        if (!active()) return
        if (state === 'SUBSCRIBED') {
          live = true
          attempt = 0
          clearRetry()
          // Every (re)subscribe needs a fresh generation and stream on the relay's side.
          emit({ type: 'ready', connectionId, userId: connectionId })
          if (identity) void current.track(identity).catch(() => {
            if (!active()) return
            disconnected()
            schedule()
          })
          return
        }
        if (state === 'CLOSED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          disconnected()
          schedule()
        }
      })
  }

  async function rebuild() {
    if (stopped) return
    const old = channel
    // Invalidate callbacks from the dead channel before closing it.
    version++
    channel = undefined
    try {
      if (old) await removeChannel(old)
    } catch {}
    if (stopped) return
    open()
  }

  open()

  return {
    broadcast(event, data) {
      if (!live || !channel) return false
      void channel.send({ type: 'broadcast', event, payload: { from: connectionId, data } }).catch(() => {
        disconnected()
        schedule()
      })
      return true
    },
    presence(data) {
      identity = data as Record<string, unknown>
      if (!live || !channel) return false
      // Re-tracking on every announce is harmless and restores presence after a reconnect.
      void channel.track(identity).catch(() => {
        disconnected()
        schedule()
      })
      return true
    },
    close() {
      stopped = true
      live = false
      clearRetry()
      const old = channel
      channel = undefined
      version++
      if (old) void removeChannel(old).catch(() => {})
    },
  }
}
