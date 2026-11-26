import os from 'node:os'
import { defineConfig } from 'vite'

/** Wi-Fi address a phone on the same network can open. Prefers en0 on a Mac. */
function lanIPv4(): string {
  const nets = os.networkInterfaces()
  const skipName = /^(utun|awdl|llw|bridge|ipsec|ppp|ap\d|gif|stf|lo)/
  const names = Object.keys(nets)
  const ordered = ['en0', 'en1', ...names.filter((name) => name !== 'en0' && name !== 'en1')]
  for (const name of ordered) {
    if (skipName.test(name)) continue
    for (const net of nets[name] ?? []) {
      const family = String(net.family)
      if (family !== 'IPv4' && family !== '4') continue
      if (net.internal) continue
      if (net.address.startsWith('169.254.')) continue
      return net.address
    }
  }
  return ''
}

export default defineConfig({
  // Project site: https://wickeym.github.io/p2p-games/
  base: '/p2p-games/',
  define: {
    __LAN_HOST__: JSON.stringify(lanIPv4()),
  },
  server: {
    host: true,
    port: 5173,
    // A phone opens this dev server by LAN IP, which Vite would otherwise block.
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
