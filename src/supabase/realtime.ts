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

/**
 * Supabase Realtime as a `RelayGame` transport. The tab's presence key is also
 * its connection id, because presence is how a host addresses a peer and how a
 * guest recognises the host. Public channels are open to anyone with the room
 * code, exactly like the Sites relay: casual matches, no anti-cheat.
 */
export function supabaseRealtime(makeChannel: (presenceKey: string) => Channel, emit: (m: RelayMessage) => void, status: (s: string) => void): Realtime {
  const connectionId = crypto.randomUUID()
  let identity: Record<string, unknown> | null = null
  let live = false
  const channel = makeChannel(connectionId)

  channel
    .on('broadcast', { event: 'game' }, ({ payload }) => {
      if (!payload || typeof payload !== 'object') return
      const { from, data } = payload as { from?: unknown; data?: unknown }
      if (typeof from !== 'string') return
      emit({ type: 'broadcast', connectionId: from, userId: from, event: 'game', data })
    })
    .on('presence', { event: 'sync' }, () => {
      const members = Object.entries(channel.presenceState<Record<string, unknown>>()).flatMap(([key, entries]) =>
        entries.map((data) => ({ connectionId: key, userId: key, data })),
      )
      emit({ type: 'presence', members })
    })
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        live = true
        // Every (re)subscribe needs a fresh generation and stream on the relay's side.
        emit({ type: 'ready', connectionId, userId: connectionId })
        if (identity) void channel.track(identity).catch(() => status('disconnected'))
        return
      }
      if (state === 'CLOSED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        live = false
        status('disconnected')
      }
    })

  return {
    broadcast(event, data) {
      if (!live) return false
      void channel.send({ type: 'broadcast', event, payload: { from: connectionId, data } }).catch(() => {
        live = false
        status('disconnected')
      })
      return true
    },
    presence(data) {
      identity = data as Record<string, unknown>
      if (!live) return false
      // Re-tracking on every announce is harmless and restores presence after a reconnect.
      void channel.track(identity).catch(() => {
        live = false
        status('disconnected')
      })
      return true
    },
    close() {
      live = false
      void channel.unsubscribe()
    },
  }
}
