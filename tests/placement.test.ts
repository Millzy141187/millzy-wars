import { describe, expect, test } from 'bun:test'
import { countItem } from '../src/engine/inventory'
import { addItem } from '../src/engine/inventory'
import { duel } from './room-helpers'

describe('block placement', () => {
  test('the host client prediction cannot spend the authoritative block twice', () => {
    const { room, a } = duel()
    const [sx, sy, sz] = room.map.bases.find((base) => base.team === 'red')!.spawn
    addItem(a.p.inventory, 'wool', 8)
    const slot = a.p.inventory.findIndex((entry) => entry?.id === 'wool')
    a.p.selected = slot
    const before = countItem(a.p.inventory, 'wool')

    // The host's client receives this snapshot by reference and predicts the
    // placement by decrementing it, before the room processes the message.
    const view = room.selfView(a.p)
    view.inventory[slot]!.count--

    a.send({ t: 'place', x: Math.floor(sx), y: sy - 1, z: Math.floor(sz) + 3, face: [0, 1, 0], slot })
    expect(countItem(a.p.inventory, 'wool')).toBe(before - 1)
  })
})
