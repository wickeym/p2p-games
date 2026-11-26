import { applyMove, COLS, newGame, ROWS, type GameState, type Player } from './game.ts'
import { connectRoom, type Role, type RoomConnection } from './net.ts'
import { qrDataUrl } from './qr.ts'
import { generateRoomId, normalizeRoomId } from './room.ts'
import { lanHostMissing, shareUrl } from './share.ts'
import './style.css'

const HOST_KEY = 'p2p-games-host'

function must<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`Missing ${name}`)
  return element
}

const app = must(document.querySelector<HTMLElement>('#app'), '#app')

function boot(): void {
  const params = new URLSearchParams(location.search)
  const raw = params.get('id')
  if (raw === null) {
    renderLobby()
    return
  }
  const roomId = normalizeRoomId(raw)
  if (!roomId) {
    renderLobby('Room codes are 4 letters or numbers.')
    return
  }
  const role: Role = sessionStorage.getItem(HOST_KEY) === roomId ? 'host' : 'guest'
  renderMatch(roomId, role)
}

function renderLobby(message = ''): void {
  document.title = 'Connect Four — P2P Games'
  app.dataset.screen = 'lobby'
  app.dataset.connected = 'false'
  delete app.dataset.room
  app.replaceChildren()

  const wrap = document.createElement('main')
  wrap.className = 'wrap'
  wrap.innerHTML = `
    <p class="eyebrow">P2P Games</p>
    <h1>Connect Four</h1>
    <p class="lede">Play a friend in the browser. One of you starts a room and shares the code. The other joins it.</p>
    <button type="button" class="primary" id="start">Start a game</button>
    <form id="join-form" class="join">
      <label for="code">Or join with a code</label>
      <input id="code" name="code" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="AB12" enterkeyhint="go" />
      <button type="submit" class="secondary">Join</button>
    </form>
    <p class="error" id="lobby-error" ${message ? '' : 'hidden'}></p>
  `
  app.append(wrap)

  const error = wrap.querySelector<HTMLElement>('#lobby-error')
  if (error && message) error.textContent = message

  wrap.querySelector<HTMLButtonElement>('#start')?.addEventListener('click', () => {
    const id = generateRoomId()
    sessionStorage.setItem(HOST_KEY, id)
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('id', id)
    location.assign(url.toString())
  })

  wrap.querySelector<HTMLFormElement>('#join-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = wrap.querySelector<HTMLInputElement>('#code')
    const id = normalizeRoomId(input?.value ?? '')
    if (!id) {
      if (error) {
        error.hidden = false
        error.textContent = 'Enter the 4-character code, or paste the join link.'
      }
      input?.focus()
      return
    }
    sessionStorage.removeItem(HOST_KEY)
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('id', id)
    location.assign(url.toString())
  })
}

function renderMatch(roomId: string, role: Role): void {
  document.title = `Connect Four ${roomId}`
  const me: Player = role === 'host' ? 1 : 2
  let state: GameState = newGame()
  let connected = false
  let peerReady = false
  let qrReady = false
  let errorText = ''
  let statusText = role === 'host' ? 'Starting the room…' : `Joining ${roomId}…`

  app.replaceChildren()
  app.dataset.room = roomId
  app.dataset.role = role
  app.dataset.connected = 'false'
  app.dataset.screen = role === 'host' ? 'share' : 'joining'

  const wrap = document.createElement('main')
  wrap.className = 'wrap'
  wrap.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">P2P Games</p>
        <h1>Connect Four</h1>
      </div>
      <button type="button" class="quiet" id="leave">Leave</button>
    </header>
    <p class="room">Room <strong id="room-code"></strong></p>
    <p class="you" id="you"></p>
    <p class="status" id="status" role="status"></p>
    <p class="error" id="error" hidden></p>
    <section class="share" id="share" hidden>
      <h2>Share this game</h2>
      <p class="join-url" id="join-url"></p>
      <button type="button" class="secondary" id="copy">Copy link</button>
      <img class="qr" id="qr" width="320" height="320" alt="QR code to join the game" />
      <p class="hint" id="hint">Leave this page open. The other player scans the code or opens the link.</p>
    </section>
    <section class="board-wrap" id="board-wrap" hidden>
      <div class="board" id="board"></div>
      <button type="button" class="primary" id="rematch" hidden>Rematch</button>
    </section>
    <p class="foot">Signaling uses the public PeerJS broker. Moves go directly between the two browsers.</p>
  `
  app.append(wrap)

  const roomCode = must(wrap.querySelector<HTMLElement>('#room-code'), 'room code')
  const you = must(wrap.querySelector<HTMLElement>('#you'), 'player')
  const status = must(wrap.querySelector<HTMLElement>('#status'), 'status')
  const error = must(wrap.querySelector<HTMLElement>('#error'), 'error')
  const share = must(wrap.querySelector<HTMLElement>('#share'), 'share')
  const joinUrl = must(wrap.querySelector<HTMLElement>('#join-url'), 'join url')
  const qr = must(wrap.querySelector<HTMLImageElement>('#qr'), 'qr')
  const hint = must(wrap.querySelector<HTMLElement>('#hint'), 'hint')
  const boardWrap = must(wrap.querySelector<HTMLElement>('#board-wrap'), 'board')
  const board = must(wrap.querySelector<HTMLElement>('#board'), 'board')
  const rematch = must(wrap.querySelector<HTMLButtonElement>('#rematch'), 'rematch')
  const copy = must(wrap.querySelector<HTMLButtonElement>('#copy'), 'copy')

  roomCode.textContent = roomId
  you.textContent = me === 1 ? 'You are red' : 'You are yellow'
  you.dataset.player = String(me)

  const url = shareUrl(roomId)
  const queryAt = url.indexOf('?')
  if (queryAt === -1) joinUrl.textContent = url
  else joinUrl.append(url.slice(0, queryAt), document.createElement('wbr'), url.slice(queryAt))
  if (lanHostMissing()) {
    hint.textContent =
      'This Mac’s LAN address could not be detected, so the link uses this page’s host. A phone may not be able to open it.'
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

  const columns: HTMLButtonElement[] = []
  const cells: HTMLElement[][] = []
  for (let row = 0; row < ROWS; row++) cells.push([])
  for (let col = 0; col < COLS; col++) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'col'
    button.dataset.col = String(col)
    button.setAttribute('aria-label', `Drop in column ${col + 1}`)
    button.addEventListener('click', () => onColumn(col))
    for (let row = 0; row < ROWS; row++) {
      const cell = document.createElement('span')
      cell.className = 'cell'
      cell.dataset.row = String(row)
      cell.dataset.col = String(col)
      cell.dataset.player = '0'
      button.append(cell)
      cells[row][col] = cell
    }
    board.append(button)
    columns.push(button)
  }

  function hasPieces(): boolean {
    return state.board.some((row) => row.some((cell) => cell !== 0))
  }

  function describe(): string {
    if (errorText && !connected) return statusText
    if (state.winner === me) return 'You win'
    if (state.winner !== 0) return 'You lose'
    if (state.draw) return 'Draw'
    if (!connected) return statusText
    if (state.turn === me) return 'Your turn'
    return "Opponent's turn"
  }

  function paint(): void {
    const wins = new Set(state.winning.map(([row, col]) => `${row},${col}`))
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = cells[row][col]
        cell.dataset.player = String(state.board[row][col])
        cell.dataset.win = wins.has(`${row},${col}`) ? 'true' : 'false'
      }
    }
    const canPlay = connected && state.winner === 0 && !state.draw && state.turn === me
    for (let col = 0; col < COLS; col++) {
      columns[col].disabled = !canPlay || state.board[0][col] !== 0
    }
    rematch.hidden = !(connected && (state.winner !== 0 || state.draw))
    status.textContent = describe()
    const over = state.winner !== 0 || state.draw
    status.dataset.you = over ? 'over' : connected && state.turn === me ? String(me) : 'wait'
    error.hidden = !errorText
    error.textContent = errorText
    const showShare = role === 'host' && peerReady && qrReady && !connected
    share.hidden = !showShare
    const showBoard = connected || hasPieces() || over
    boardWrap.hidden = !showBoard
    app.dataset.connected = connected ? 'true' : 'false'
    app.dataset.screen = showShare ? 'share' : showBoard ? 'game' : 'joining'
  }

  function publish(): void {
    link.sendState(state)
    paint()
  }

  function onColumn(col: number): void {
    if (!connected || state.winner !== 0 || state.draw || state.turn !== me) return
    if (role === 'host') {
      const next = applyMove(state, col, 1)
      if (!next) return
      state = next
      publish()
      return
    }
    if (state.board[0][col] !== 0) return
    link.sendMove(col)
  }

  const link: RoomConnection = connectRoom(roomId, role, {
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
      if (role === 'host') link.sendState(state)
      paint()
    },
    onDisconnected() {
      connected = false
      statusText =
        role === 'host'
          ? 'The other player disconnected. They can rejoin with the same code.'
          : 'Lost the host. Reopen this page if they are still sharing.'
      paint()
    },
    onState(next) {
      state = next
      connected = true
      errorText = ''
      paint()
    },
    onMove(col, player) {
      const next = applyMove(state, col, player)
      if (!next) return
      state = next
      publish()
    },
    onRematch() {
      state = newGame()
      publish()
    },
    onError(message) {
      errorText = message
      if (!connected) statusText = 'Could not connect'
      paint()
    },
  })

  rematch.addEventListener('click', () => {
    if (role === 'host') {
      state = newGame()
      publish()
      return
    }
    link.sendRematch()
    statusText = 'Asking for a rematch…'
    paint()
  })

  wrap.querySelector<HTMLButtonElement>('#leave')?.addEventListener('click', () => {
    link.destroy()
    sessionStorage.removeItem(HOST_KEY)
    const next = new URL(location.href)
    next.search = ''
    next.hash = ''
    location.assign(next.toString())
  })

  window.addEventListener('pagehide', () => link.destroy(), { once: true })
  paint()
}

boot()
