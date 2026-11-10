import { TEAMS, type TeamId } from '../blocks'

export const ARENA_SIZE = 128
export const ARENA_HEIGHT = 80
/** Players stand at this height on every island. */
export const TOP = 40
export const MID = ARENA_SIZE / 2

export type ThemeId = 'forest' | 'village' | 'desert' | 'frost' | 'ruins'

/**
 * Where things go on an arena, as offsets from the middle, and how it looks.
 * `out` is the axis-aligned direction a base's back faces: the forge is
 * behind the spawn and the bed in front, toward the middle.
 */
export interface ArenaLayout {
  id: string
  name: string
  theme: ThemeId
  bases: Record<TeamId, { at: [number, number]; out: [number, number] }>
  diamonds: [number, number][]
  /** Half-size of the middle island. */
  middle: number
  /** Seed for the terrain and decoration noise. */
  seed: number
  /** Sky colour hint for the client. */
  sky: string
}

/**
 * A base in its own frame: `u` from the back (forge, u = -5) through the
 * spawn (-2) to the bed (3 and 4) and out toward the middle; `v` across,
 * with the shop at (-1, 4) and the upgrades keeper at (-1, -4).
 */
export const BASE = {
  spawn: -2,
  forge: -5,
  bed: 3,
  shop: [-1, 4] as const,
  upgrades: [-1, -4] as const,
  /** Where a bot stands to cover its bed: 2.5 behind the foot's centre. */
  stand: 0.5,
  /** The paved yard and the open lanes through it. */
  spine: 2,
  door: [-3, 2] as const,
}

export interface BasePlan {
  team: TeamId
  cx: number
  cz: number
  out: [number, number]
  /** World x/z of a frame cell. */
  at(u: number, v: number): [number, number]
}

export function basePlan(layout: ArenaLayout, team: TeamId): BasePlan {
  const { at, out } = layout.bases[team]
  const cx = MID + at[0]
  const cz = MID + at[1]
  const [ox, oz] = out
  return { team, cx, cz, out, at: (u, v) => [cx - u * ox - v * oz, cz - u * oz + v * ox] }
}

/** An inclusive rectangle of cells on the walking level: [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number]
export type Point = [number, number]
export interface Footprint {
  team: TeamId
  rect: Rect
}

/** The rectangle a base's rooms and yard cover, from its centre and facing. */
export function footprint(cx: number, cz: number, out: readonly [number, number]): Rect {
  const [ox, oz] = out
  const xs: number[] = []
  const zs: number[] = []
  for (const u of [-14, 11]) for (const v of [-12, 12]) {
    xs.push(cx - u * ox - v * oz)
    zs.push(cz - u * oz + v * ox)
  }
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
}

/** The same footprint, from the base data a bot has in a running room. */
export function baseFootprint(base: { team: TeamId; center: readonly [number, number, number]; bed: { dx: number; dz: number } }): Footprint {
  return { team: base.team, rect: footprint(Math.floor(base.center[0]), Math.floor(base.center[2]), [-base.bed.dx, -base.bed.dz]) }
}

/** Whether a three-wide, axis-aligned leg would touch a base. */
function crosses(a: Point, b: Point, rect: Rect): boolean {
  const x0 = Math.min(a[0], b[0]) - 1
  const x1 = Math.max(a[0], b[0]) + 1
  const z0 = Math.min(a[1], b[1]) - 1
  const z1 = Math.max(a[1], b[1]) + 1
  return x0 <= rect[2] && x1 >= rect[0] && z0 <= rect[3] && z1 >= rect[1]
}

const dedupe = (path: Point[]): Point[] => path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1])

/**
 * A bot's route from `here` to `goal`: its usual L, or around the middle when
 * that would cross another base. Eight-team arenas place bases close enough
 * that some direct legs would cut through a neighbour.
 */
export function botRoute(here: Point, goal: Point, own: TeamId, target: TeamId, feet: readonly Footprint[], verticalFirst: boolean): Point[] {
  const blocked = feet.filter((f) => f.team !== own && f.team !== target).map((f) => f.rect)
  const direct: Point[] = verticalFirst ? [here, [here[0], goal[1]], goal] : [here, [goal[0], here[1]], goal]
  const other: Point[] = verticalFirst ? [here, [goal[0], here[1]], goal] : [here, [here[0], goal[1]], goal]
  const via: Point[] = [here, [here[0], MID], [MID, MID], [MID, goal[1]], goal]
  const viaOther: Point[] = [here, [MID, here[1]], [MID, MID], [goal[0], MID], goal]
  for (const path of [direct, other, via, viaOther]) {
    const clean = dedupe(path)
    if (!clean.some((p, i) => i > 0 && blocked.some((rect) => crosses(clean[i - 1], p, rect)))) return clean
  }
  return dedupe(via)
}

/**
 * The bridging lanes between bases, three blocks wide, following the routes
 * bots take from their bed's stand to each enemy bed and spawn. Nothing may
 * stand in them, since nobody can dig map blocks.
 */
export function walkways(layout: ArenaLayout, teams: readonly TeamId[] = TEAMS): Rect[] {
  const rects: Rect[] = []
  const lane = (ax: number, az: number, bx: number, bz: number) => {
    // Points are cell centres (k + 0.5); a lane is the cell row under them and one either side.
    const [x0, x1] = [Math.floor(Math.min(ax, bx)), Math.floor(Math.max(ax, bx))]
    const [z0, z1] = [Math.floor(Math.min(az, bz)), Math.floor(Math.max(az, bz))]
    rects.push(ax === bx ? [x0 - 1, z0, x1 + 1, z1] : [x0, z0 - 1, x1, z1 + 1])
  }
  const feet = teams.map((team) => {
    const plan = basePlan(layout, team)
    return { team, rect: footprint(plan.cx, plan.cz, plan.out) }
  })
  for (const a of teams) {
    const own = basePlan(layout, a)
    const [fx, fz] = own.at(BASE.bed, 0)
    const [hx, hz] = [-own.out[0], -own.out[1]]
    const stand = [fx + 0.5 - hx * 2.5, fz + 0.5 - hz * 2.5]
    // A bot stops within half a block of the stand, so it may start from either neighbouring cell.
    const starts = new Set<string>()
    for (const sx of [stand[0] - 0.49, stand[0] + 0.49]) for (const sz of [stand[1] - 0.49, stand[1] + 0.49]) starts.add(`${Math.floor(sx) + 0.5},${Math.floor(sz) + 0.5}`)
    const alongZ = Math.abs(own.cx - MID) < 1
    for (const t of teams) {
      if (t === a) continue
      const target = basePlan(layout, t)
      const [tfx, tfz] = target.at(BASE.bed, 0)
      const [sx, sz] = target.at(BASE.spawn, 0)
      const goals: Point[] = [
        [tfx + 0.5 + target.out[0] * 2, tfz + 0.5 + target.out[1] * 2],
        [sx + 0.5, sz + 0.5],
      ]
      for (const s of starts) {
        const [px, pz] = s.split(',').map(Number)
        for (const [gx, gz] of goals) {
          const route = botRoute([px, pz], [gx, gz], a, t, feet, alongZ)
          for (let i = 1; i < route.length; i++) lane(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1])
        }
      }
    }
  }
  return rects
}

/** Whether the bases sit on the middle's cross (lanes run through the middle) or in the corners. */
export function onCross(layout: ArenaLayout, teams: readonly TeamId[] = TEAMS): boolean {
  return teams.every((t) => layout.bases[t].at[0] === 0 || layout.bases[t].at[1] === 0)
}
