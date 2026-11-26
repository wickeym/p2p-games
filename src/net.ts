import Peer, { type DataConnection } from 'peerjs'
import type { GameState, Player } from './game.ts'
import { parseState } from './game.ts'
import { peerIdForRoom } from './room.ts'

export type Role = 'host' | 'guest'

type Msg =
  | { t: 'move'; col: number }
  | { t: 'state'; state: GameState }
  | { t: 'rematch' }

export interface NetEvents {
  onStatus: (status: string) => void
  onPeerOpen: () => void
  onConnected: () => void
  onDisconnected: () => void
  onState: (state: GameState) => void
  onMove: (col: number, player: Player) => void
  onRematch: () => void
  onError: (message: string) => void
}

export interface RoomConnection {
  sendState: (state: GameState) => void
  sendMove: (col: number) => void
  sendRematch: () => void
  destroy: () => void
}

function explain(type: string): string {
  switch (type) {
    case 'unavailable-id':
      return 'That room is already hosted in another tab. Close the other tab, or start a new game.'
    case 'peer-unavailable':
      return 'No game is waiting on that code. Check it, and make sure the host still has the page open.'
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the PeerJS signaling broker. Check the internet connection and try again.'
    case 'browser-incompatible':
      return 'This browser could not open a WebRTC connection.'
    case 'invalid-id':
      return 'That room code cannot be used.'
    default:
      return 'The connection failed. Try again.'
  }
}

function asMessage(raw: unknown): Msg | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as { t?: unknown; col?: unknown; state?: unknown }
  if (msg.t === 'move' && typeof msg.col === 'number') return { t: 'move', col: msg.col }
  if (msg.t === 'rematch') return { t: 'rematch' }
  if (msg.t === 'state') {
    const state = parseState(msg.state)
    if (!state) return null
    return { t: 'state', state }
  }
  return null
}

/**
 * Host registers a prefixed PeerJS id. The joiner gets a random id and connects
 * to the host. Signaling uses the public PeerJS broker; game messages are WebRTC.
 */
export function connectRoom(roomId: string, role: Role, events: NetEvents): RoomConnection {
  let stopped = false
  let generation = 0
  let current: Peer | null = null
  let conn: DataConnection | null = null
  let retryTimer = 0

  const stale = (gen: number) => stopped || gen !== generation

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => {
      if (!stopped) fn()
    }, ms)
  }

  const send = (msg: Msg) => {
    if (!conn?.open) return
    void conn.send(msg)
  }

  const watch = (next: DataConnection, gen: number) => {
    next.on('open', () => {
      if (stale(gen)) {
        next.close()
        return
      }
      if (conn && conn !== next) conn.close()
      conn = next
      events.onConnected()
    })
    next.on('data', (raw) => {
      if (stale(gen) || conn !== next) return
      const msg = asMessage(raw)
      if (!msg) {
        events.onError('Received a game update this page could not read.')
        return
      }
      if (msg.t === 'move' && role === 'host') events.onMove(msg.col, 2)
      else if (msg.t === 'state' && role === 'guest') events.onState(msg.state)
      else if (msg.t === 'rematch' && role === 'host') events.onRematch()
    })
    next.on('close', () => {
      if (conn !== next) return
      conn = null
      if (!stale(gen)) events.onDisconnected()
    })
  }

  const startHost = (attempt: number) => {
    const gen = ++generation
    const peer = new Peer(peerIdForRoom(roomId), { debug: 0 })
    current = peer
    let scheduled = false
    peer.on('open', () => {
      if (stale(gen)) return
      events.onPeerOpen()
    })
    peer.on('connection', (next) => {
      if (stale(gen)) {
        next.close()
        return
      }
      watch(next, gen)
    })
    peer.on('error', (err) => {
      if (stale(gen)) return
      if (err.type === 'unavailable-id' && attempt < 5) {
        if (scheduled) return
        scheduled = true
        events.onStatus('That room is still closing. Trying again…')
        later(() => startHost(attempt + 1), 800)
        return
      }
      if (conn?.open) return
      events.onError(explain(err.type))
    })
  }

  const startGuest = () => {
    const gen = ++generation
    const peer = new Peer({ debug: 0 })
    current = peer
    let attempts = 0

    const connect = () => {
      if (stale(gen) || peer.destroyed || peer.disconnected) return
      attempts += 1
      const next = peer.connect(peerIdForRoom(roomId), {
        reliable: true,
        serialization: 'json',
      })
      if (next) watch(next, gen)
    }

    peer.on('open', () => {
      if (stale(gen)) return
      events.onPeerOpen()
      connect()
    })
    peer.on('error', (err) => {
      if (stale(gen)) return
      if (err.type === 'peer-unavailable' && attempts < 6 && !conn?.open) {
        events.onStatus('Looking for that room…')
        later(connect, 800)
        return
      }
      if (conn?.open) return
      events.onError(explain(err.type))
    })
  }

  if (role === 'host') startHost(0)
  else startGuest()

  return {
    sendState(state) {
      send({ t: 'state', state })
    },
    sendMove(col) {
      send({ t: 'move', col })
    },
    sendRematch() {
      send({ t: 'rematch' })
    },
    destroy() {
      stopped = true
      window.clearTimeout(retryTimer)
      generation += 1
      conn?.close()
      conn = null
      current?.destroy()
      current = null
    },
  }
}
