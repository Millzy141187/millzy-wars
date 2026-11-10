import { describe, expect, test } from 'bun:test'
import { encodeTeamSetup, parseTeamSetup, teamSetupCapacity } from '../src/games/bedwars/setup'

describe('custom team setup', () => {
  test('round-trips team human limits and per-team bot counts', () => {
    const encoded = 'red:1:1,blue:3:0,green:2:2'
    const setup = parseTeamSetup(encoded)!
    expect(encodeTeamSetup(setup)).toBe(encoded)
    expect(teamSetupCapacity(setup)).toBe(6)
  })

  test('rejects invalid teams, duplicate colours and more than sixteen human seats', () => {
    expect(parseTeamSetup('red:1:0')).toBeUndefined()
    expect(parseTeamSetup('red:1:0,red:2:1')).toBeUndefined()
    expect(parseTeamSetup('red:4:0,blue:4:0,green:4:0,yellow:4:0,orange:1:0')).toBeUndefined()
    expect(parseTeamSetup('red:1:5,blue:1:0')).toBeUndefined()
  })
})
