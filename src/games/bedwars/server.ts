import type { RoomFactory } from '../../engine/net/room'
import { installBots } from './bots'
import { bedwarsCodec } from './protocol'
import { Room } from './room'
import { TEAMS } from './blocks'
import { arenaRules, sandboxRules, scaleTimeline, TIMELINE } from './rules'
import { parseTeamSetup, teamSetupCapacity, type TeamSetup } from './setup'
import { encodeChaos, parseChaos, type ChaosMode } from './chaos'

export interface RoomParams {
  world: 'arena' | 'sandbox'
  room: string
  fast: boolean
  /** Human player capacity, excluding configured bots. */
  size: number
  /** Optional per-team human limits and exact bot counts. */
  teamSetup?: TeamSetup[]
  /** Optional host-selected chaos modifiers. */
  chaos?: ChaosMode[]
  /** Kept off the public room list; friends join with the invite link. */
  private?: boolean
}

export function roomParams(params: URLSearchParams): RoomParams {
  const teamSetup = parseTeamSetup(params.get('teams'))
  const chaos = parseChaos(params.get('chaos'))
  return {
    world: params.get('world') === 'sandbox' ? 'sandbox' : 'arena',
    room: (params.get('room') ?? 'main').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'main',
    fast: params.get('fast') === '1',
    size: teamSetup ? teamSetupCapacity(teamSetup) : params.get('size') === '16' ? 16 : params.get('size') === '8' ? 8 : 4,
    ...(teamSetup ? { teamSetup } : {}),
    ...(chaos.length ? { chaos } : {}),
    private: params.get('private') === '1',
  }
}

/** A bed-wars room with bots installed. */
export function createBedwarsRoom(p: RoomParams, offline = false): Room {
  const timeline = p.fast ? scaleTimeline(TIMELINE, 10) : TIMELINE
  const rules =
    p.world === 'sandbox'
      ? sandboxRules()
      : arenaRules({
          timeline,
          teams: p.teamSetup?.map((row) => row.team) ?? TEAMS.slice(0, p.size === 4 ? 4 : 8),
          teamSize: p.size === 16 ? 2 : 1,
          chaos: p.chaos ?? [],
          ...(p.teamSetup ? {
            teamPlayerLimits: Object.fromEntries(p.teamSetup.map(({ team, players }) => [team, players])),
            teamBotCounts: Object.fromEntries(p.teamSetup.map(({ team, bots }) => [team, bots])),
          } : {}),
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
    const setup = p.teamSetup?.map(({ team, players, bots }) => `${team}-${players}-${bots}`).join(',') ?? `preset-${p.size}`
    const chaos = p.chaos?.length ? encodeChaos(p.chaos) : 'none'
    return `${p.world}:${p.room}:${p.fast ? 'fast' : 'normal'}:${setup}:${chaos}${p.private ? ':private' : ''}`
  },
  create(params) {
    return createBedwarsRoom(roomParams(params))
  },
  codec: bedwarsCodec,
}
