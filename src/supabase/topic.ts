import type { RoomParams } from '../games/bedwars/server'

/**
 * A room code identifies one host's room. Player count, teams and speed are
 * host settings delivered in the welcome state, so a guest's own choices must
 * not move it to a different channel and leave it waiting forever.
 */
export function supabaseTopic(options: Pick<RoomParams, 'world' | 'room'>): string {
  return `bedwars-${options.world}-${options.room}`
}
