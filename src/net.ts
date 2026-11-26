import type { GameState, Player } from './game.ts'
import { parseState } from './game.ts'
import { openRoom, type PeerLink, type Role } from './peer.ts'
import { peerIdForRoom } from './room.ts'

export type { Role } from './peer.ts'

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

/** Connect Four room. The host peer id is `p2pgames-four-` plus the room code. */
export function connectRoom(roomId: string, role: Role, events: NetEvents): RoomConnection {
  const link: PeerLink = openRoom(peerIdForRoom(roomId, 'four'), role, {
    onStatus: events.onStatus,
    onPeerOpen: events.onPeerOpen,
    onConnected: events.onConnected,
    onDisconnected: events.onDisconnected,
    onError: events.onError,
    onData(raw) {
      const msg = asMessage(raw)
      if (!msg) {
        events.onError('Received a game update this page could not read.')
        return
      }
      if (msg.t === 'move' && role === 'host') events.onMove(msg.col, 2)
      else if (msg.t === 'state' && role === 'guest') events.onState(msg.state)
      else if (msg.t === 'rematch' && role === 'host') events.onRematch()
    },
  })

  return {
    sendState(state) {
      link.send({ t: 'state', state })
    },
    sendMove(col) {
      link.send({ t: 'move', col })
    },
    sendRematch() {
      link.send({ t: 'rematch' })
    },
    destroy() {
      link.destroy()
    },
  }
}
