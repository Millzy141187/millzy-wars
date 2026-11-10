import type { RoomFactory } from '../../engine/net/room'
import { installBots } from './bots'
import { bedwarsCodec } from './protocol'
import { Room } from './room'
import { TEAMS } from './blocks'
import { arenaRules, sandboxRules, scaleTimeline, TIMELINE } from './rules'

export interface RoomParams {
  world: 'arena' | 'sandbox'
  room: string
  fast: boolean
  /** 4 players on 4 beds, 8 players on 8 beds, or 16 players on 8 beds with two per team. */
  size: 4 | 8 | 16
  /** Kept off the public room list; friends join with the invite link. */
  private?: boolean
}

export function roomParams(params: URLSearchParams): RoomParams {
  return {
    world: params.get('world') === 'sandbox' ? 'sandbox' : 'arena',
    room: (params.get('room') ?? 'main').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'main',
    fast: params.get('fast') === '1',
    size: params.get('size') === '16' ? 16 : params.get('size') === '8' ? 8 : 4,
    private: params.get('private') === '1',
  }
}

/** A bed-wars room with bots installed; `offline` rooms start as soon as their one player arrives. */
export function createBedwarsRoom(p: RoomParams, offline = false): Room {
  const timeline = p.fast ? scaleTimeline(TIMELINE, 10) : TIMELINE
  const rules =
    p.world === 'sandbox'
      ? sandboxRules()
      : arenaRules({
          timeline,
          teams: TEAMS.slice(0, p.size === 4 ? 4 : 8),
          teamSize: p.size === 16 ? 2 : 1,
          ...(offline ? { countdownTicks: 5 * 20 } : p.fast ? { countdownTicks: 60 } : {}),
        })
  const room = new Room({ rules, seed: Math.floor(Math.random() * 1e6) })
  room.params = p
  installBots(room)
  return room
}

/** Rooms for the engine's host: one per world, name and speed. */
export const bedwarsRooms: RoomFactory = {
  key(params) {
    const p = roomParams(params)
    return `${p.world}:${p.room}:${p.fast ? 'fast' : 'normal'}${p.private ? ':private' : ''}`
  },
  create(params) {
    return createBedwarsRoom(roomParams(params))
  },
  codec: bedwarsCodec,
}
