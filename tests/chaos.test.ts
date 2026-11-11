import { describe, expect, test } from 'bun:test'
import { AIR } from '../src/games/bedwars/blocks'
import { encodeChaos, parseChaos } from '../src/games/bedwars/chaos'
import { TPS } from '../src/games/bedwars/constants'
import type { Player } from '../src/games/bedwars/room'
import { arena, duel, TestClient, ticks } from './room-helpers'

const totalItems = (p: Player) => p.inventory.reduce((sum, slot) => sum + (slot?.count ?? 0), 0)

describe('chaos modifiers', () => {
  test('parses known unique modifiers in a stable order', () => {
    expect(parseChaos('items,teleport')).toEqual(['teleport', 'items'])
    expect(encodeChaos(['items', 'teleport'])).toBe('teleport,items')
    expect(parseChaos('teleport,teleport')).toEqual([])
    expect(parseChaos('teleport,nope')).toEqual([])
    expect(parseChaos(null)).toEqual([])
  })

  test('the host changes chaos in the lobby and guests see it', () => {
    const room = arena({ bots: false })
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    a.send({ t: 'settings', bots: false, chaos: ['items', 'teleport'] })
    expect(room.chaos).toEqual(['teleport', 'items'])
    expect(b.last('lobby')?.chaos).toEqual(['teleport', 'items'])
  })

  test('random warp moves living players each minute', () => {
    const { room, a } = duel({ chaos: ['teleport'] })
    const before = a.tp
    ticks(room, 60 * TPS + 5)
    expect(a.tp).toBeGreaterThan(before)
  })

  test('mystery items arrive each minute', () => {
    const { room, a } = duel({ chaos: ['items'] })
    const before = totalItems(a.p)
    ticks(room, 60 * TPS + 5)
    expect(totalItems(a.p)).toBeGreaterThan(before)
    expect(a.events('system').some((text) => text.startsWith('Mystery item:'))).toBe(true)
  })

  test('potion rain gives everyone a timed effect', () => {
    const { room, a } = duel({ chaos: ['effects'] })
    ticks(room, 45 * TPS + 5)
    expect(Object.values(a.p.effects).some((until) => until > room.tickCount)).toBe(true)
  })

  test('bed blessing restores a destroyed bed', () => {
    const { room } = duel({ chaos: ['bed-blessing'] })
    const state = room.teams.get('blue')!
    const bed = room.map.bases.find((base) => base.team === 'blue')!.bed
    state.bed = false
    room.world.set(bed.x, bed.y, bed.z, AIR)
    room.world.set(bed.x + bed.dx, bed.y, bed.z + bed.dz, AIR)
    ticks(room, 90 * TPS + 5)
    expect(state.bed).toBe(true)
    expect(room.world.get(bed.x, bed.y, bed.z)).not.toBe(AIR)
  })
})
