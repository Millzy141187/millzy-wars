import { connectLocal, connectOnline } from '../../../engine/net/client'
import { connectSites } from '../../../sites/client'
import { connectSupabase, supabaseConfigured } from '../../../supabase/client'
import { BRAND } from '../constants'
import { bedwarsCodec, type ClientMessage, type ServerMessage } from '../protocol'
import { createBedwarsRoom, type RoomParams } from '../server'
import { Game } from './game'
import { loadSettings } from './settings'
import { openSettings } from './settings-ui'
import { openWardrobe } from './wardrobe'
import { bestRoom, cleanRoomName, fetchRooms, openSeats, randomRoomName, statusLabel, type RoomInfo, type RoomList } from './rooms'
import { FREEBUFF_MARK, freebuffUrl, promoShown } from './promo'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/700.css'
import { drawTile } from '../../../engine/render/textures'
import { TEAMS, TEAM_NAMES, type TeamId } from '../blocks'
import { encodeTeamSetup, parseTeamSetup, teamSetupCapacity, type TeamSetup } from '../setup'
import { CHAOS_INFO, CHAOS_MODES, encodeChaos, parseChaos, type ChaosMode } from '../chaos'
import './styles.css'

type JoinOptions = RoomParams & { name: string; hosting?: boolean }

const params = new URLSearchParams(location.search)
const app = document.getElementById('app')!
document.title = BRAND

// Right-click is a game control, not a browser menu. Text fields keep their
// native menu so copy and paste still work.
document.addEventListener('contextmenu', (event) => {
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, [contenteditable="true"]')) return
  event.preventDefault()
}, true)

function webglAvailable(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/** The menu's tiled background: the game's own dirt texture, drawn in code. */
function dirtTile(): string {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  c.getContext('2d')!.putImageData(drawTile({ color: '#7a5a3a', pattern: 'noise', face: 'side' }, 7), 0, 0)
  return c.toDataURL()
}

function savedName(): string {
  try {
    return localStorage.getItem('name') ?? ''
  } catch {
    return ''
  }
}

function start(options: JoinOptions, offline: boolean) {
  try {
    localStorage.setItem('name', options.name)
  } catch {}
  // Put the join in the address, so reloading (or "Try again") rejoins the same room.
  const query = new URLSearchParams({ play: '1', name: options.name, world: options.world, room: options.room })
  if (options.fast) query.set('fast', '1')
  if (options.size > 4) query.set('size', String(options.size))
  if (options.teamSetup) query.set('teams', encodeTeamSetup(options.teamSetup))
  if (options.chaos?.length) query.set('chaos', encodeChaos(options.chaos))
  if (!__SITES__ && options.private) query.set('private', '1')
  if (offline) query.set('offline', '1')
  if (__SITES__ && options.hosting && !offline) query.set('host', '1')
  history.replaceState(null, '', `?${query}`)
  app.innerHTML = ''
  if (!webglAvailable()) {
    app.innerHTML = `<div class="menu" style="background-image:url(${dirtTile()})"><div class="menu-wrap"><div class="menu-card"><h2>3D graphics are not available</h2><p class="lead">This browser or computer has WebGL 2 turned off. Turn on hardware acceleration in your browser settings, update your graphics drivers, or use the desktop app.</p><button class="btn" onclick="location.href=location.pathname">Back to menu</button></div></div></div>`
    return
  }
  const connection = offline
    ? connectLocal<ClientMessage, ServerMessage>(createBedwarsRoom(options, true), options.name, bedwarsCodec)
    : supabaseConfigured ? connectSupabase({ ...options, hosting: !!options.hosting })
    : __SITES__ ? connectSites({ ...options, hosting: !!options.hosting })
    : connectOnline<ClientMessage, ServerMessage>(
        {
          name: options.name,
          world: options.world,
          room: options.room,
          ...(options.fast ? { fast: '1' } : {}),
          ...(options.size > 4 ? { size: String(options.size) } : {}),
          ...(options.teamSetup ? { teams: encodeTeamSetup(options.teamSetup) } : {}),
          ...(options.chaos?.length ? { chaos: encodeChaos(options.chaos) } : {}),
          ...(options.private ? { private: '1' } : {}),
        },
        bedwarsCodec,
      )
  const game = new Game(app, connection, loadSettings(), { offline, world: options.world })
  game.applySettings(game.settings)
  ;(window as unknown as { game: Game }).game = game
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const MATCH_SIZES: Record<string, 4 | 8 | 16> = { '4': 4, '8': 8, '16': 16 }
const sizeOptions = () =>
  '<option value="4">4 players · 4 beds</option><option value="8">8 players · 8 beds</option><option value="16">16 players · 8 beds, 2 each</option>'

function setupRows(count: number): string {
  return TEAMS.slice(0, count).map((team) => `<div class="team-setup-row"><b style="color:${teamColor(team)}">${TEAM_NAMES[team]}</b><label>Players <select data-team-players="${team}">${[1, 2, 3, 4].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label><label>Bots <select data-team-bots="${team}">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`).join('')
}

function teamColor(team: TeamId): string {
  return ({ red: '#e0473e', blue: '#3e6fe0', green: '#45b04a', yellow: '#e6c43a', orange: '#e08a3a', purple: '#9b5bd6', cyan: '#2fb6b0', pink: '#e05b9a' })[team]
}

function teamSetupControls(): string {
  return `<label class="field check"><input id="custom-teams" type="checkbox"><span>Custom teams and bots</span></label><div id="team-setup" class="team-setup hidden"><label class="field"><span>Number of teams</span><select id="team-count">${TEAMS.slice(2).map((_, i) => `<option value="${i + 2}"${i + 2 === 4 ? ' selected' : ''}>${i + 2}</option>`).join('')}</select></label><p class="muted small">Choose the human limit and starting bots for each team. Bots are in addition to human player limits. Total human limit: 16.</p><div id="team-setup-rows">${setupRows(4)}</div><p id="team-setup-error" class="error-line"></p></div>`
}

function installTeamSetup(card: Element): void {
  const enabled = card.querySelector<HTMLInputElement>('#custom-teams')!
  const area = card.querySelector<HTMLElement>('#team-setup')!
  const count = card.querySelector<HTMLSelectElement>('#team-count')!
  const rows = card.querySelector<HTMLElement>('#team-setup-rows')!
  const size = card.querySelector<HTMLSelectElement>('#size')
  enabled.addEventListener('change', () => {
    area.classList.toggle('hidden', !enabled.checked)
    if (size) size.disabled = enabled.checked
  })
  count.addEventListener('change', () => { rows.innerHTML = setupRows(Number(count.value)) })
}

function readTeamSetup(card: Element): TeamSetup[] | undefined {
  if (!card.querySelector<HTMLInputElement>('#custom-teams')?.checked) return undefined
  const players = [...card.querySelectorAll<HTMLSelectElement>('select[data-team-players]')]
  const setup = players.map((select) => {
    const team = select.dataset.teamPlayers as TeamId
    return { team, players: Number(select.value), bots: Number(card.querySelector<HTMLSelectElement>(`select[data-team-bots="${team}"]`)?.value) }
  })
  const parsed = parseTeamSetup(encodeTeamSetup(setup))
  const error = card.querySelector<HTMLElement>('#team-setup-error')
  if (!parsed) {
    if (error) error.textContent = 'Use 2–8 teams, 1–4 players per team, 0–4 bots per team, and at most 16 human players.'
    return undefined
  }
  if (error) error.textContent = ''
  return parsed
}

function chaosControls(selected: readonly ChaosMode[] = []): string {
  return `<p class="label">Chaos modifiers</p><div class="chaos-grid">${CHAOS_MODES.map(
    (mode) => `<label class="field check"><input type="checkbox" data-chaos="${mode}"${selected.includes(mode) ? ' checked' : ''}> <span><b>${CHAOS_INFO[mode].name}</b>: ${CHAOS_INFO[mode].help}</span></label>`,
  ).join('')}</div>`
}

function readChaos(card: Element): ChaosMode[] {
  return parseChaos(encodeChaos([...card.querySelectorAll<HTMLInputElement>('input[data-chaos]:checked')].map((input) => input.dataset.chaos as ChaosMode)))
}

/** The match size picked on the screen, in players. */
function readSize(card: Element): 4 | 8 | 16 {
  return MATCH_SIZES[(card.querySelector('#size') as HTMLSelectElement | null)?.value ?? '4'] ?? 4
}

/** "5 playing online now", for the menu, or nothing when there is no server to ask. */
function onlineLine(list: RoomList | null): string {
  if (!list) return ''
  const n = list.online
  return `<span class="dot${n ? ' on' : ''}"></span>${n === 0 ? 'Nobody online yet: start a room and invite a friend' : `${n} ${n === 1 ? 'person' : 'people'} playing online now`}`
}

/** Refreshes `update` every few seconds for as long as `anchor` stays on the page. */
function poll(anchor: Element, update: (list: RoomList | null) => void) {
  if (__SITES__) return
  const run = async () => {
    if (!anchor.isConnected) return
    update(await fetchRooms())
    if (anchor.isConnected) setTimeout(run, 3000)
  }
  void run()
}

/** Start screen: name, modes and settings; Play online opens the room list. URL parameters skip it (?world=sandbox&offline=1&play=1). */
function menu() {
  app.innerHTML = `
    <div class="menu" style="background-image:url(${dirtTile()})">
      <div class="menu-wrap">
      <div class="menu-brand">
        <p class="menu-kicker">Bed Wars</p>
        <h1 class="menu-title">${BRAND}</h1>
        <p class="menu-tagline menu-splash">Protect your bed. Break theirs.</p>
      </div>
      <div class="menu-card">
        <label class="field"><span>Name</span><input id="name" maxlength="16" placeholder="Your name" value="${esc(savedName())}"></label>
        <p class="online-line" id="online"></p>
        <div class="menu-buttons">
          <button class="btn primary" data-go="online">Play online</button>
          <button class="btn" data-go="solo">Solo against bots</button>
          <button class="btn" data-go="sandbox">Practice sandbox</button>
          <div class="menu-pair"><button class="btn" data-go="wardrobe">Wardrobe</button><button class="btn" data-go="settings">Settings</button></div>
        </div>
        <p class="menu-foot">${__SITES__ ? 'Host a casual match for up to sixteen players, or join with a room code. The host runs the match and must keep this tab open and visible.' : 'Online plays with people on this server: pick a room or make one and share its link.'} Solo runs bots on your own machine. The sandbox has a station for every mechanic and /bot for sparring.</p>
      </div>
      <p class="version">v${__APP_VERSION__}${promoShown() ? ` · <a href="${freebuffUrl('menu-footer')}" target="_blank" rel="noopener">${FREEBUFF_MARK}Made with Freebuff</a>` : ''}</p>
      </div>
    </div>`
  const card = app.querySelector('.menu-card')!
  poll(card, (list) => {
    const line = document.getElementById('online')
    if (line) line.innerHTML = onlineLine(list)
  })
  app.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const go = b.dataset.go
      if (go === 'settings') {
        openSettings(app, loadSettings(), () => {}, () => {})
        return
      }
      if (go === 'wardrobe') {
        openWardrobe(app, null, () => {}, () => {})
        return
      }
      const name = playerName()
      if (go === 'online') {
        saveName(name)
        online()
        return
      }
      start({ name, world: go === 'sandbox' ? 'sandbox' : 'arena', room: 'main', fast: false, size: 4 }, true)
    }),
  )
}

function playerName(): string {
  const input = document.getElementById('name') as HTMLInputElement | null
  return input?.value.trim() || savedName() || 'Player'
}

function saveName(name: string) {
  try {
    localStorage.setItem('name', name)
  } catch {}
}

/**
 * The online screen: who is on, Quick play, every public room with its arena,
 * state and open seats, and a form to make a room (public or invite-only).
 * Opened from the menu, or straight away from an invite link (?room=name).
 */
function online(invite?: { room: string; private: boolean; fast: boolean; teamSetup?: TeamSetup[]; chaos?: ChaosMode[] }) {
  if (supabaseConfigured || __SITES__) return sitesOnline(invite)
  const card = app.querySelector('.menu-card')!
  const fresh = randomRoomName()
  card.innerHTML = `
    <div class="online-head"><h2>Play online</h2><button class="btn ghost" data-act="back">Back</button></div>
    ${invite ? `<div class="invite"><p>You were invited to room <b>${esc(invite.room)}</b>${invite.private ? ' (invite only)' : ''}.</p><button class="btn primary" data-act="invite">Join ${esc(invite.room)}</button></div>` : ''}
    <label class="field"><span>Your name</span><input id="name" maxlength="16" placeholder="Your name" value="${esc(savedName())}"></label>
    <p class="online-line" id="online"></p>
    <button class="btn${invite ? '' : ' primary'} wide" data-act="quick">Quick play</button>
    <p class="label">Rooms</p>
    <div class="room-list" id="rooms"><p class="muted small">Looking for rooms…</p></div>
    <p class="label">Make a room</p>
    <label class="field"><span>Players</span><select id="size">${sizeOptions()}</select></label>
    ${teamSetupControls()}
    ${chaosControls()}
    <div class="make-room">
      <input id="room" maxlength="32" value="${fresh}" aria-label="Room name">
      <button class="btn" data-act="make">Create</button>
    </div>
    <label class="field check"><input id="private" type="checkbox"> <span>Invite only: keep it off this list, and share the link instead</span></label>
    <label class="field check"><input id="fast" type="checkbox"> <span>Fast round: the timeline runs ten times quicker</span></label>
    <p class="muted small">Typing the name of a room that exists joins it. The host starts each round when everyone is ready; bots fill open teams.</p>`
  let rooms: RoomInfo[] = []
  const join = (room: string, options: { private?: boolean; fast?: boolean; world?: 'arena' | 'sandbox'; size?: number; teamSetup?: TeamSetup[]; chaos?: ChaosMode[] } = {}) => {
    const name = playerName()
    saveName(name)
    const teamSetup = options.teamSetup
    start({ name, world: options.world ?? 'arena', room, fast: !!options.fast, size: teamSetup ? teamSetupCapacity(teamSetup) : options.size ?? 4, teamSetup, chaos: options.chaos, private: !!options.private }, false)
  }
  const list = card.querySelector('#rooms')!
  installTeamSetup(card)
  const render = (data: RoomList | null) => {
    const line = card.querySelector('#online')
    if (line) line.innerHTML = data ? onlineLine(data) : 'Could not reach the server. Solo and the sandbox still work.'
    rooms = data?.rooms ?? []
    list.innerHTML = rooms.length
      ? rooms
          .map((r, i) => {
            const seats = openSeats(r)
            return `<div class="room-row">
              <div class="room-name"><b>${esc(r.room)}</b><span class="muted small">${esc(r.world === 'sandbox' ? 'Sandbox' : r.map)}${r.fast ? ' · fast' : ''}</span></div>
              <div class="room-state"><span class="phase ${r.phase}">${statusLabel(r)}</span><span class="muted small">${r.players} ${r.players === 1 ? 'person' : 'people'}${r.bots ? `, ${r.bots} ${r.bots === 1 ? 'bot' : 'bots'}` : ''}</span></div>
              <button class="btn${seats ? '' : ' ghost'}" data-room="${i}">${seats ? 'Join' : 'Watch'}</button>
            </div>`
          })
          .join('')
      : '<p class="muted small">No public rooms right now. Make one below, or press Quick play to open the main room.</p>'
    list.querySelectorAll<HTMLButtonElement>('[data-room]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = rooms[Number(b.dataset.room)]
        join(r.room, { fast: r.fast, world: r.world, size: r.capacity, teamSetup: parseTeamSetup(r.teams), chaos: parseChaos(r.chaos) })
      }),
    )
  }
  poll(list, render)
  card.querySelector('[data-act="back"]')!.addEventListener('click', () => menu())
  card.querySelector('[data-act="invite"]')?.addEventListener('click', () => join(invite!.room, invite))
  card.querySelector('[data-act="quick"]')!.addEventListener('click', () => {
    const best = bestRoom(rooms)
    join(best?.room ?? 'main', { fast: best?.fast, size: best?.capacity, teamSetup: parseTeamSetup(best?.teams), chaos: parseChaos(best?.chaos) })
  })
  card.querySelector('[data-act="make"]')!.addEventListener('click', () => {
    const room = cleanRoomName((card.querySelector('#room') as HTMLInputElement).value) || fresh
    const teamSetup = readTeamSetup(card)
    if (card.querySelector<HTMLInputElement>('#custom-teams')?.checked && !teamSetup) return
    join(room, {
      private: (card.querySelector('#private') as HTMLInputElement).checked,
      fast: (card.querySelector('#fast') as HTMLInputElement).checked,
      size: teamSetup ? teamSetupCapacity(teamSetup) : readSize(card),
      teamSetup,
      chaos: readChaos(card),
    })
  })
}

/** Sites has no global room directory. Codes select casual, browser-hosted rooms. */
function sitesOnline(invite?: { room: string; fast: boolean; teamSetup?: TeamSetup[]; chaos?: ChaosMode[] }) {
  const card = app.querySelector('.menu-card')!
  card.innerHTML = `
    <div class="online-head"><h2>Play with friends</h2><button class="btn ghost" data-act="back">Back</button></div>
    <p class="lead">Choose a 4-bed or 8-bed map. The 16-player match puts two players on each of the eight beds. The host runs the match; keep the host's tab open and visible.</p>
    <label class="field"><span>Your name</span><input id="name" maxlength="16" value="${esc(savedName())}" placeholder="Your name"></label>
    <label class="field"><span>Room code</span><input id="room" maxlength="32" value="${esc(invite?.room ?? randomRoomName())}"></label>
    <label class="field"><span>Players</span><select id="size">${sizeOptions()}</select></label>
    ${teamSetupControls()}
    ${chaosControls(invite?.chaos)}
    <label class="field check"><input id="fast" type="checkbox" ${invite?.fast ? 'checked' : ''}><span>Fast round (everyone uses the same setting)</span></label>
    <div class="menu-pair"><button class="btn primary" data-act="host">Host a room</button><button class="btn" data-act="join">Join room</button></div>
    <p class="muted small">Share the invite link from the in-game lobby. Anyone signed in with the code can join. The host is trusted with the match state; there are no persistent rankings.</p>
    <p id="sites-auth" class="muted small"></p>`
  card.querySelector('[data-act="back"]')!.addEventListener('click', menu)
  installTeamSetup(card)
  for (const action of ['host', 'join']) card.querySelector(`[data-act="${action}"]`)!.addEventListener('click', () => {
    const room = cleanRoomName((card.querySelector('#room') as HTMLInputElement).value)
    if (!room) return (card.querySelector('#room') as HTMLInputElement).focus()
    const name = playerName()
    saveName(name)
    const custom = action === 'host' ? readTeamSetup(card) : invite?.teamSetup ?? readTeamSetup(card)
    if (card.querySelector<HTMLInputElement>('#custom-teams')?.checked && action === 'host' && !custom) return
    if (card.querySelector<HTMLInputElement>('#custom-teams')?.checked && action === 'join' && !invite?.teamSetup && !custom) return
    start(
      {
        name,
        room,
        world: 'arena',
        fast: (card.querySelector('#fast') as HTMLInputElement).checked,
        size: custom ? teamSetupCapacity(custom) : action === 'host' ? readSize(card) : 4,
        teamSetup: custom,
        chaos: action === 'host' ? readChaos(card) : invite?.chaos ?? readChaos(card),
        hosting: action === 'host',
      },
      false,
    )
  })
  if (supabaseConfigured) {
    const note = card.querySelector('#sites-auth')
    if (note) note.textContent = 'Casual rooms over Supabase Realtime: anyone with the room code can join. The host runs the match and must keep this tab open.'
    return
  }
  void fetch('/api/player', { cache: 'no-store' }).then((r) => r.json()).then((player: { signedIn: boolean; configured: boolean }) => {
    if (!card.isConnected) return
    const note = card.querySelector('#sites-auth')
    if (!note) return
    if (!player.configured) note.textContent = 'Enable Sign in with Freebuff and realtime in Sites before online play. Solo and sandbox already work.'
    else if (!player.signedIn) {
      const link = document.createElement('a')
      link.href = `/auth/freebuff/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`
      link.textContent = 'Sign in with Freebuff to play online'
      note.append(link)
    } else note.textContent = 'Ready to play online.'
    if (!player.configured || !player.signedIn) card.querySelectorAll<HTMLButtonElement>('[data-act="host"], [data-act="join"]').forEach((button) => { button.disabled = true })
  }).catch(() => { const note = card.querySelector('#sites-auth'); if (note) note.textContent = 'Could not check online play. Try again shortly.' })
}

if (params.get('play') === '1') {
  const teamSetup = parseTeamSetup(params.get('teams'))
  const chaos = parseChaos(params.get('chaos'))
  start(
    {
      name: params.get('name') ?? (savedName() || 'Player'),
      world: params.get('world') === 'sandbox' ? 'sandbox' : 'arena',
      room: params.get('room') ?? 'main',
      fast: params.get('fast') === '1',
      size: teamSetup ? teamSetupCapacity(teamSetup) : params.get('size') === '16' ? 16 : params.get('size') === '8' ? 8 : 4,
      teamSetup,
      chaos,
      private: params.get('private') === '1',
      hosting: params.get('host') === '1',
    },
    params.get('offline') === '1',
  )
} else {
  menu()
  // An invite link (?room=name) opens the room list with that room ready to join.
  const invited = params.get('room')
  if (invited) online({ room: cleanRoomName(invited) || 'main', private: params.get('private') === '1', fast: params.get('fast') === '1', teamSetup: parseTeamSetup(params.get('teams')), chaos: parseChaos(params.get('chaos')) })
}
