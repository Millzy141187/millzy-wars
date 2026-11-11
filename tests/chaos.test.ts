import { describe, expect, test } from 'bun:test'
import { AIR } from '../src/games/bedwars/blocks'
import { encodeChaos, parseChaos } from '../src/games/bedwars/chaos'
import { TPS } from '../src/games/bedwars/constants'
import { addItem, countItem } from '../src/engine/inventory'
import type { Player } from '../src/games/bedwars/room'
import { arena, duel, TestClient, ticks } from './room-helpers'

const totalItems = (p: Player) => p.inventory.reduce((sum, slot) => sum + (slot?.count ?? 0), 0)

describe('chaos modifiers', () => {
  test('parses known unique modifiers in a stable order', () => {
    expect(parseChaos('items,teleport')).toEqual(['teleport', 'items'])
    expect(encodeChaos(['items', 'teleport'])).toBe('teleport,items')
    expect(parseChaos('teleport,teleport')).toEqual([])
    expect(parseChaos('teleport,nope')).toEqual([])
    expect(parseChaos('shared-inventory')).toEqual(['shared-inventory'])
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

  test('shared inventory gives every teammate one pool', () => {
    const room = arena({ bots: false, teamSize: 2, chaos: ['shared-inventory'] })
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    const c = new TestClient(room, 'Cee')
    a.send({ t: 'team', team: 'red' })
    b.send({ t: 'team', team: 'red' })
    c.send({ t: 'team', team: 'blue' })
    a.send({ t: 'start' })
    ticks(room, 25)

    addItem(a.p.inventory, 'wool', 8)
    expect(countItem(b.p.inventory, 'wool')).toBe(8)
    expect(countItem(c.p.inventory, 'wool')).toBe(0)

    const [sx, sy, sz] = room.map.bases.find((base) => base.team === 'red')!.spawn
    const slot = a.p.inventory.findIndex((entry) => entry?.id === 'wool')
    a.p.selected = slot
    a.send({ t: 'place', x: Math.floor(sx), y: sy - 1, z: Math.floor(sz) + 3, face: [0, 1, 0], slot })
    expect(countItem(b.p.inventory, 'wool')).toBe(7)
  })

  test('a shared pool is not looted or cleared when a teammate dies', () => {
    const room = arena({ bots: false, teamSize: 2, chaos: ['shared-inventory'] })
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    const c = new TestClient(room, 'Cee')
    a.send({ t: 'team', team: 'red' })
    b.send({ t: 'team', team: 'red' })
    c.send({ t: 'team', team: 'blue' })
    a.send({ t: 'start' })
    ticks(room, 25)

    addItem(a.p.inventory, 'iron', 6)
    room.die(a.p, 'void', c.p)
    expect(countItem(a.p.inventory, 'iron')).toBe(6)
    expect(countItem(b.p.inventory, 'iron')).toBe(6)
    expect(countItem(c.p.inventory, 'iron')).toBe(0)
  })
})
