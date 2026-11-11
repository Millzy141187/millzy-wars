import { TPS } from './constants'

export const CHAOS_MODES = ['teleport', 'items', 'effects', 'bed-blessing'] as const
export type ChaosMode = (typeof CHAOS_MODES)[number]

export const CHAOS_INFO: Record<ChaosMode, { name: string; help: string }> = {
  teleport: { name: 'Random warp', help: 'Every minute, everyone is teleported to another team’s base.' },
  items: { name: 'Mystery item', help: 'Every minute, every player gets a random item.' },
  effects: { name: 'Potion rain', help: 'Every 45 seconds, everyone gets a random potion effect for 20 seconds.' },
  'bed-blessing': { name: 'Bed blessing', help: 'Every 90 seconds, a destroyed bed comes back.' },
}

export const CHAOS_INTERVAL: Record<ChaosMode, number> = {
  teleport: 60 * TPS,
  items: 60 * TPS,
  effects: 45 * TPS,
  'bed-blessing': 90 * TPS,
}

export function isChaosMode(value: string): value is ChaosMode {
  return (CHAOS_MODES as readonly string[]).includes(value)
}

/** Compact, shareable host modifiers: `teleport,items,bed-blessing`. Unknown or duplicate modes are rejected. */
export function parseChaos(value: string | null | undefined): ChaosMode[] {
  if (!value || value.length > 64) return []
  const modes = value.split(',')
  if (modes.length > CHAOS_MODES.length || modes.some((mode) => !isChaosMode(mode)) || new Set(modes).size !== modes.length) return []
  return CHAOS_MODES.filter((mode) => modes.includes(mode))
}

export function encodeChaos(modes: readonly ChaosMode[]): string {
  return CHAOS_MODES.filter((mode) => modes.includes(mode)).join(',')
}
