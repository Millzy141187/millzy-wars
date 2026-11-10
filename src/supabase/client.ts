import { createClient } from '@supabase/supabase-js'
import { TICK_MS } from '../engine/constants'
import { RelayGame, type RelayMessage } from '../sites/relay'
import { FLUSH_MS } from '../sites/wire'
import { encodeTeamSetup } from '../games/bedwars/setup'
import { supabaseRealtime, type Channel } from './realtime'

// A publishable/anon key is public by design; it is baked into the bundle.
// Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time (Vercel),
// or in .env.local for a local build. Without both, online play stays on the
// Sites relay so that deployment keeps working unchanged.
const env = import.meta.env as Record<string, string | undefined>
const url = env.VITE_SUPABASE_URL?.trim()
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigured = Boolean(url && anonKey)

/**
 * Online play through Supabase Realtime. The host's browser still runs the
 * authoritative room; Supabase carries presence and the same batched frames
 * as the Sites relay, so all game rules are unchanged.
 */
export function connectSupabase(options: RelayGame['options']) {
  if (!url || !anonKey) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  // Channel names only use characters every Realtime topic accepts.
  const setup = options.teamSetup ? encodeTeamSetup(options.teamSetup) : `preset-${options.size}`
  const topic = `bedwars-${options.world}-${options.room}-${options.fast ? 'fast' : 'normal'}-${setup.replace(/[^a-z0-9-]/gi, '-')}`
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let game!: RelayGame
  const realtime = supabaseRealtime(
    (presenceKey) =>
      client.channel(topic, {
        config: { broadcast: { self: false }, presence: { key: presenceKey } },
      }) as unknown as Channel,
    (m: RelayMessage) => game.receive(m),
    (s: string) => game.status(s),
    {
      removeChannel: (channel) => client.removeChannel(channel as unknown as Parameters<typeof client.removeChannel>[0]),
    },
  )
  game = new RelayGame(options, realtime)
  let last = performance.now()
  let carry = 0
  let flushed = last
  const timer = setInterval(() => {
    const now = performance.now()
    carry += now - last
    last = now
    let steps = 0
    while (carry >= TICK_MS && steps++ < 5) {
      game.tick()
      carry -= TICK_MS
    }
    if (carry > TICK_MS * 5) carry = 0
    // Supabase frames need one flush to send and the next to consume only after
    // its acknowledgement; checking twice per frame interval keeps delivery at
    // the existing ten broadcasts per second without outrunning acknowledgments.
    if (now - flushed >= FLUSH_MS / 2) {
      game.flush()
      flushed = now
    }
  }, TICK_MS / 2)
  const close = game.close.bind(game)
  game.close = () => {
    clearInterval(timer)
    window.removeEventListener('pagehide', leave)
    close()
  }
  const leave = () => game.close()
  window.addEventListener('pagehide', leave)
  return game
}
