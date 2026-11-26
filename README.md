# P2P Games

Proof-of-concept peer-to-peer browser games. The first game is Connect Four.

Two browsers play each other directly over WebRTC. There is no game server. For this POC, [PeerJS](https://peerjs.com/) introduces the browsers through its public signaling broker at `0.peerjs.com`. After that handshake, moves travel on a WebRTC data channel between the players.

## Install and run

Node.js 20 or newer.

```bash
cd ~/Documents/WW-GIT/games/p2p-games
npm install
npm run dev
```

`npm run dev` starts Vite on the LAN (`vite --host`). The app is served under `/p2p-games/`, usually http://localhost:5173/p2p-games/.

The dev server also listens on this computer’s network address, for example http://192.168.x.x:5173/p2p-games/. A phone on the same Wi-Fi uses that address, not `127.0.0.1`.

The published site is https://wickeym.github.io/p2p-games/.

## Share and join

1. Choose **Start a game**. The page generates a short room code (for example `AB12`) and puts it in the URL as `?id=AB12`.
2. That tab is the host. It registers a PeerJS id prefixed with `p2pgames-` (so `p2pgames-AB12`) so the room does not collide with an arbitrary id on the public broker.
3. The share screen shows the full join URL and a QR code of that same URL. On the published site that is `https://wickeym.github.io/p2p-games/?id=AB12`. When the host opened the page on localhost, the URL and QR use this Mac’s LAN IP, the dev-server port, and the `/p2p-games/` path instead.
4. The other player scans the QR code, opens the link, or types the code on the landing page and chooses **Join**. Opening a URL that already has `?id=` joins that room.
5. The joiner connects to the host. Red is the host and moves first. Yellow is the joiner.

Leave the host tab open. Closing it ends the room. A refresh of the host tab keeps the same room. The other player can rejoin with the same code.

Both players need internet for the PeerJS handshake, even when they are on the same Wi-Fi. The public broker is only for this proof of concept: it can be slow, rate-limit, or unreachable, and it is not a private signaling server.

The LAN link is plain HTTP. Chrome can still open a WebRTC connection from that page. A browser that blocks WebRTC on insecure pages will open the link but will not be able to join the game.

If macOS Firewall is on, allow incoming connections to Node when a phone cannot open the page.

## Connect Four

Seven columns, six rows. Tap a column to drop a disc. The disc falls to the lowest open cell. Four in a row, column, or diagonal wins. A full board with no winner is a draw. **Rematch** clears the board and stays in the same room, with red to move again.
