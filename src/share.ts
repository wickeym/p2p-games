export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

function normalizeBase(basePath: string): string {
  if (!basePath || basePath === '/') return '/'
  const withSlash = basePath.startsWith('/') ? basePath : `/${basePath}`
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`
}

/**
 * Join link for the room. The path is the Vite base (`/p2p-games/` on the
 * GitHub Pages project site). On localhost, the host is this machine's LAN
 * address so a phone on the same Wi-Fi can open it.
 */
export function buildShareUrl(
  roomId: string,
  loc: { protocol: string; hostname: string; host: string },
  lanHost: string,
  basePath: string,
): string {
  const url = new URL(`${loc.protocol}//${loc.host}${normalizeBase(basePath)}`)
  if (isLocalHostname(loc.hostname) && lanHost) url.hostname = lanHost
  url.search = ''
  url.hash = ''
  url.searchParams.set('id', roomId)
  return url.toString()
}

export function shareUrl(roomId: string): string {
  return buildShareUrl(
    roomId,
    {
      protocol: location.protocol,
      hostname: location.hostname,
      host: location.host,
    },
    __LAN_HOST__,
    import.meta.env.BASE_URL,
  )
}

export function lanHostMissing(): boolean {
  return isLocalHostname(location.hostname) && !__LAN_HOST__
}
