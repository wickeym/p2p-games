export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

/**
 * Join link for the room. On localhost, swap in the machine's LAN address so
 * a phone on the same Wi-Fi can open it. The port stays the dev server's port.
 */
export function buildShareUrl(
  roomId: string,
  loc: { protocol: string; hostname: string; host: string; pathname: string },
  lanHost: string,
): string {
  const url = new URL(`${loc.protocol}//${loc.host}${loc.pathname}`)
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
      pathname: location.pathname,
    },
    __LAN_HOST__,
  )
}

export function lanHostMissing(): boolean {
  return isLocalHostname(location.hostname) && !__LAN_HOST__
}
