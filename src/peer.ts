import Peer, { type DataConnection } from 'peerjs'

export type Role = 'host' | 'guest'

export interface PeerEvents {
  onStatus: (status: string) => void
  onPeerOpen: () => void
  onConnected: () => void
  onDisconnected: () => void
  onData: (data: unknown) => void
  onError: (message: string) => void
}

export interface PeerLink {
  send: (message: unknown) => void
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

/**
 * Host registers `peerId`. The joiner gets a random id and connects to it.
 * Signaling uses the public PeerJS broker. Messages travel on a WebRTC data channel.
 */
export function openRoom(peerId: string, role: Role, events: PeerEvents): PeerLink {
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

  const send = (message: unknown) => {
    if (!conn?.open) return
    void conn.send(message)
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
      events.onData(raw)
    })
    next.on('close', () => {
      if (conn !== next) return
      conn = null
      if (!stale(gen)) events.onDisconnected()
    })
  }

  const startHost = (attempt: number) => {
    const gen = ++generation
    const peer = new Peer(peerId, { debug: 0 })
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
      const next = peer.connect(peerId, { reliable: true, serialization: 'json' })
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
    send,
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
