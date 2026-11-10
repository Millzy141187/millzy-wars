import { TEAMS, type TeamId } from './blocks'

export type TeamSetup = { team: TeamId; players: number; bots: number }

const isTeam = (value: string): value is TeamId => (TEAMS as string[]).includes(value)

/** Compact, shareable lobby configuration: team:humanLimit:botCount,... */
export function parseTeamSetup(value: string | null | undefined): TeamSetup[] | undefined {
  if (!value || value.length > 160) return undefined
  const rows = value.split(',')
  if (rows.length < 2 || rows.length > TEAMS.length) return undefined
  const setup: TeamSetup[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const [team, players, bots, ...extra] = row.split(':')
    const humanLimit = Number(players)
    const botCount = Number(bots)
    if (extra.length || !team || !isTeam(team) || seen.has(team) || !Number.isInteger(humanLimit) || humanLimit < 1 || humanLimit > 4 || !Number.isInteger(botCount) || botCount < 0 || botCount > 4) return undefined
    seen.add(team)
    setup.push({ team, players: humanLimit, bots: botCount })
  }
  const humans = setup.reduce((sum, row) => sum + row.players, 0)
  const bots = setup.reduce((sum, row) => sum + row.bots, 0)
  return humans <= 16 && bots <= 16 ? setup : undefined
}

export function encodeTeamSetup(setup: TeamSetup[]): string {
  return setup.map(({ team, players, bots }) => `${team}:${players}:${bots}`).join(',')
}

export function teamSetupCapacity(setup: TeamSetup[]): number {
  return setup.reduce((sum, row) => sum + row.players, 0)
}
