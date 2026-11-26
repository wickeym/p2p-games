/** Unambiguous characters: no 0/O, 1/I/L. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Prefix for the host's PeerJS id. The public broker is shared, so a bare
 * room code like "AB12" could collide with someone else's peer id.
 */
export const PEER_PREFIX = 'p2pgames-'

export function peerIdForRoom(roomId: string): string {
  return `${PEER_PREFIX}${roomId}`
}

export function generateRoomId(): string {
  let id = ''
  const byte = new Uint8Array(1)
  const limit = 256 - (256 % ALPHABET.length)
  while (id.length < 4) {
    crypto.getRandomValues(byte)
    const value = byte[0] ?? 0
    if (value >= limit) continue
    id += ALPHABET[value % ALPHABET.length]
  }
  return id
}

/** Accept a typed code or a pasted join URL. Returns null when it is not 4 characters. */
export function normalizeRoomId(raw: string): string | null {
  const trimmed = raw.trim()
  const fromUrl = trimmed.match(/[?&]id=([A-Za-z0-9]{4})\b/)
  const source = fromUrl?.[1] ?? trimmed
  const id = source.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z0-9]{4}$/.test(id)) return null
  return id
}
