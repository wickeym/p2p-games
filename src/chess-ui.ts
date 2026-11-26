import {
  algebraic,
  createGame,
  legalMoves,
  parsePosition,
  playMove,
  sq,
  type Color,
  type Move,
  type Piece,
} from './chess.ts'
import { openRoom, type PeerLink, type Role } from './peer.ts'
import { qrDataUrl } from './qr.ts'
import { peerIdForRoom } from './room.ts'
import { lanHostMissing, shareUrl } from './share.ts'

const GLYPH: Record<Piece['kind'], string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
}

export function renderChess(app: HTMLElement, roomId: string, role: Role, clearHost: () => void): void {
  document.title = `Chess ${roomId}`
  const me: Color = role === 'host' ? 'w' : 'b'
  const flip = me === 'b'
  let pos = createGame()
  let connected = false
  let peerReady = false
  let qrReady = false
  let errorText = ''
  let statusText = role === 'host' ? 'Starting the room…' : `Joining ${roomId}…`
  let selected: number | null = null
  let pending: Move[] = []

  app.replaceChildren()
  app.dataset.room = roomId
  app.dataset.role = role
  app.dataset.game = 'chess'
  app.dataset.connected = 'false'
  app.dataset.screen = role === 'host' ? 'share' : 'joining'
  app.dataset.turn = pos.turn

  const wrap = document.createElement('main')
  wrap.className = 'wrap chess-wrap'
  wrap.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">P2P Games</p>
        <h1>Chess</h1>
      </div>
      <button type="button" class="quiet" id="leave">Leave</button>
    </header>
    <p class="room">Room <strong id="room-code"></strong></p>
    <p class="you" id="you"></p>
    <p class="status" id="status" role="status"></p>
    <p class="last" id="last"></p>
    <p class="error" id="error" hidden></p>
    <section class="share" id="share" hidden>
      <h2>Share this game</h2>
      <p class="join-url" id="join-url"></p>
      <button type="button" class="secondary" id="copy">Copy link</button>
      <img class="qr" id="qr" width="320" height="320" alt="QR code to join the game" />
      <p class="hint" id="hint">Leave this page open. The other player scans the code or opens the link.</p>
    </section>
    <section class="stage" id="stage" hidden>
      <div class="chess-board" id="board" role="grid" aria-label="Chess board"></div>
      <div class="promo" id="promo" hidden>
        <p>Promote to</p>
        <div class="promo-row">
          <button type="button" data-promo="q" aria-label="Queen">♛</button>
          <button type="button" data-promo="r" aria-label="Rook">♜</button>
          <button type="button" data-promo="b" aria-label="Bishop">♝</button>
          <button type="button" data-promo="n" aria-label="Knight">♞</button>
        </div>
      </div>
      <button type="button" class="primary" id="rematch" hidden>Rematch</button>
    </section>
    <p class="foot">Signaling uses the public PeerJS broker. Illegal moves are rejected.</p>
  `
  app.append(wrap)

  const roomCode = must(wrap.querySelector<HTMLElement>('#room-code'))
  const you = must(wrap.querySelector<HTMLElement>('#you'))
  const status = must(wrap.querySelector<HTMLElement>('#status'))
  const last = must(wrap.querySelector<HTMLElement>('#last'))
  const error = must(wrap.querySelector<HTMLElement>('#error'))
  const share = must(wrap.querySelector<HTMLElement>('#share'))
  const joinUrl = must(wrap.querySelector<HTMLElement>('#join-url'))
  const qr = must(wrap.querySelector<HTMLImageElement>('#qr'))
  const hint = must(wrap.querySelector<HTMLElement>('#hint'))
  const stage = must(wrap.querySelector<HTMLElement>('#stage'))
  const board = must(wrap.querySelector<HTMLElement>('#board'))
  const promo = must(wrap.querySelector<HTMLElement>('#promo'))
  const rematch = must(wrap.querySelector<HTMLButtonElement>('#rematch'))
  const copy = must(wrap.querySelector<HTMLButtonElement>('#copy'))

  roomCode.textContent = roomId
  you.textContent = me === 'w' ? 'You are white' : 'You are black'
  you.dataset.player = me === 'w' ? '1' : '2'

  const url = shareUrl(roomId, 'chess')
  const queryAt = url.indexOf('?')
  if (queryAt === -1) joinUrl.textContent = url
  else joinUrl.append(url.slice(0, queryAt), document.createElement('wbr'), url.slice(queryAt))
  if (lanHostMissing()) {
    hint.textContent = 'This Mac’s LAN address could not be detected, so the link uses this page’s host.'
  }

  void qrDataUrl(url)
    .then((src) => {
      qr.src = src
      qrReady = true
      paint()
    })
    .catch(() => {
      qrReady = true
      qr.alt = 'QR code could not be created. Use the link instead.'
      paint()
    })

  copy.addEventListener('click', () => {
    const text = joinUrl.textContent ?? ''
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(joinUrl)
    selection?.removeAllRanges()
    selection?.addRange(range)
    void navigator.clipboard?.writeText(text).then(
      () => {
        copy.textContent = 'Copied'
      },
      () => {
        copy.textContent = 'Select the link and copy it'
      },
    )
  })

  const squares: HTMLButtonElement[] = []
  for (let view = 0; view < 64; view++) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sq'
    const index = viewSquare(view, flip)
    button.dataset.sq = algebraic(index)
    button.addEventListener('click', () => onSquare(index))
    board.append(button)
    squares.push(button)
  }

  for (const button of wrap.querySelectorAll<HTMLButtonElement>('[data-promo]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset.promo
      if (kind !== 'q' && kind !== 'r' && kind !== 'b' && kind !== 'n') return
      const move = pending.find((candidate) => candidate.promotion === kind)
      pending = []
      if (move) commit(move)
    })
  }

  function myTurn(): boolean {
    return connected && pos.over === 'play' && pos.turn === me
  }

  function onSquare(index: number): void {
    if (!myTurn()) return
    const choices = pending.length > 0 ? [] : legalMoves(pos).filter((move) => move.from === selected && move.to === index)
    if (selected !== null && choices.length > 1) {
      pending = choices
      paint()
      return
    }
    if (selected !== null && choices.length === 1) {
      const only = choices[0]
      if (only) commit(only)
      return
    }
    const piece = pos.board[index]
    if (piece?.color === me && legalMoves(pos).some((move) => move.from === index)) {
      selected = index
      pending = []
    } else {
      selected = null
      pending = []
    }
    paint()
  }

  function commit(move: Move): void {
    selected = null
    pending = []
    if (role === 'host') {
      const next = playMove(pos, move)
      if (!next) return
      pos = next
      link.send({ t: 'state', state: pos })
      paint()
      return
    }
    link.send({ t: 'move', from: move.from, to: move.to, promotion: move.promotion })
  }

  function describe(): string {
    if (!connected) return statusText
    if (pos.over === 'mate') return pos.winner === me ? 'Checkmate. You win' : 'Checkmate. You lose'
    if (pos.over === 'stalemate') return 'Stalemate'
    const check = pos.check ? 'Check. ' : ''
    if (pos.turn === me) return `${check}Your turn`
    return `${check}${pos.turn === 'w' ? 'White' : 'Black'} to move`
  }

  function paint(): void {
    const moves = myTurn() && selected !== null ? legalMoves(pos).filter((move) => move.from === selected) : []
    const destinations = new Set(moves.map((move) => move.to))
    for (let view = 0; view < 64; view++) {
      const button = squares[view]
      if (!button) continue
      const index = viewSquare(view, flip)
      const piece = pos.board[index]
      const file = index % 8
      const rank = Math.floor(index / 8)
      const light = (file + rank) % 2 === 1
      button.className = 'sq'
      button.classList.add(light ? 'light' : 'dark')
      if (index === pos.lastFrom || index === pos.lastTo) button.classList.add('last')
      if (selected === index) button.classList.add('selected')
      if (destinations.has(index)) button.classList.add(piece ? 'capture' : 'dest')
      button.replaceChildren()
      if (piece) {
        const glyph = document.createElement('span')
        glyph.className = `piece ${piece.color}`
        glyph.textContent = GLYPH[piece.kind]
        button.append(glyph)
        button.dataset.piece = `${piece.color}${piece.kind}`
      } else {
        delete button.dataset.piece
      }
      button.setAttribute('aria-label', `${algebraic(index)}${piece ? ` ${piece.color}${piece.kind}` : ''}`)
    }
    status.textContent = describe()
    status.dataset.you = pos.over === 'play' ? 'wait' : 'over'
    last.textContent = pos.last ? `Last move: ${pos.last}` : 'Last move: —'
    error.hidden = !errorText
    error.textContent = errorText
    const showShare = role === 'host' && peerReady && qrReady && !connected
    share.hidden = !showShare
    stage.hidden = !connected
    rematch.hidden = !(connected && pos.over !== 'play')
    promo.hidden = pending.length === 0
    app.dataset.connected = connected ? 'true' : 'false'
    app.dataset.screen = showShare ? 'share' : connected ? 'game' : 'joining'
    app.dataset.turn = pos.turn
    app.dataset.over = pos.over
    app.dataset.last = pos.last
  }

  function reset(): void {
    pos = createGame()
    selected = null
    pending = []
    link.send({ t: 'state', state: pos })
    paint()
  }

  const link: PeerLink = openRoom(peerIdForRoom(roomId, 'chess'), role, {
    onStatus(text) {
      statusText = text
      paint()
    },
    onPeerOpen() {
      peerReady = true
      if (!connected) statusText = role === 'host' ? 'Waiting for the other player' : `Joining ${roomId}…`
      paint()
    },
    onConnected() {
      connected = true
      errorText = ''
      if (role === 'host') link.send({ t: 'state', state: pos })
      paint()
    },
    onDisconnected() {
      connected = false
      selected = null
      pending = []
      statusText =
        role === 'host'
          ? 'The other player disconnected. They can rejoin with the same code.'
          : 'Lost the host. Reopen this page if they are still sharing.'
      paint()
    },
    onData(raw) {
      if (!raw || typeof raw !== 'object') return
      const msg = raw as { t?: unknown; state?: unknown; from?: unknown; to?: unknown; promotion?: unknown }
      if (msg.t === 'state' && role === 'guest') {
        const next = parsePosition(msg.state)
        if (!next) return
        pos = next
        selected = null
        pending = []
        connected = true
        errorText = ''
        paint()
      } else if (msg.t === 'move' && role === 'host') {
        const move = parseMove(msg)
        if (!move) return
        const next = playMove(pos, move)
        if (!next) return
        pos = next
        link.send({ t: 'state', state: pos })
        paint()
      } else if (msg.t === 'rematch' && role === 'host') {
        reset()
      }
    },
    onError(message) {
      errorText = message
      if (!connected) statusText = 'Could not connect'
      paint()
    },
  })

  rematch.addEventListener('click', () => {
    if (role === 'host') {
      reset()
      return
    }
    link.send({ t: 'rematch' })
    statusText = 'Asking for a rematch…'
    paint()
  })

  wrap.querySelector<HTMLButtonElement>('#leave')?.addEventListener('click', () => {
    link.destroy()
    clearHost()
    const next = new URL(location.href)
    next.search = ''
    next.hash = ''
    location.assign(next.toString())
  })

  window.addEventListener('pagehide', () => link.destroy(), { once: true })
  paint()
}

function viewSquare(view: number, flip: boolean): number {
  const row = Math.floor(view / 8)
  const col = view % 8
  if (!flip) return sq(col, 7 - row)
  return sq(7 - col, row)
}

function parseMove(msg: { from?: unknown; to?: unknown; promotion?: unknown }): Move | null {
  if (typeof msg.from !== 'number' || typeof msg.to !== 'number') return null
  if (msg.from < 0 || msg.from > 63 || msg.to < 0 || msg.to > 63) return null
  const promotion = msg.promotion
  if (promotion === undefined) return { from: msg.from, to: msg.to }
  if (promotion !== 'q' && promotion !== 'r' && promotion !== 'b' && promotion !== 'n') return null
  return { from: msg.from, to: msg.to, promotion }
}

function must<T extends Element>(element: T | null): T {
  if (!element) throw new Error('Missing chess element')
  return element
}
