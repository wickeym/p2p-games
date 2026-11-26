import {
  ARENA_H,
  ARENA_W,
  blankInput,
  createWorld,
  GROUND,
  parseInput,
  parseWorld,
  stepWorld,
  type Fighter,
  type Input,
} from './fight-sim.ts'
import { openRoom, type PeerLink, type Role } from './peer.ts'
import { qrDataUrl } from './qr.ts'
import { peerIdForRoom } from './room.ts'
import { lanHostMissing, shareUrl } from './share.ts'

const STEP = 1000 / 60
const SEND_MS = 50

export function renderFight(app: HTMLElement, roomId: string, role: Role, clearHost: () => void): void {
  document.title = `Stick Fight ${roomId}`
  const me = role === 'host' ? 0 : 1
  let world = createWorld()
  let connected = false
  let peerReady = false
  let qrReady = false
  let errorText = ''
  let statusText = role === 'host' ? 'Starting the room…' : `Joining ${roomId}…`
  let hostInput = blankInput()
  let guestInput = blankInput()
  let prevHost = blankInput()
  let prevGuest = blankInput()
  let lastSend = 0
  let lastInputSend = 0
  let lastSentInput = blankInput()
  let lastFrame = 0
  let acc = 0
  let raf = 0

  app.replaceChildren()
  app.dataset.room = roomId
  app.dataset.role = role
  app.dataset.game = 'fight'
  app.dataset.connected = 'false'
  app.dataset.screen = role === 'host' ? 'share' : 'joining'
  app.dataset.x0 = String(Math.round(world.fighters[0].x))
  app.dataset.x1 = String(Math.round(world.fighters[1].x))

  const wrap = document.createElement('main')
  wrap.className = 'wrap fight-wrap'
  wrap.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">P2P Games</p>
        <h1>Stick Fight</h1>
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
    <section class="stage" id="stage" hidden>
      <div class="bars">
        <div class="bar host"><span id="hp0"></span></div>
        <strong class="clock" id="clock">45</strong>
        <div class="bar guest"><span id="hp1"></span></div>
      </div>
      <canvas id="arena" class="arena" width="960" height="540"></canvas>
      <div class="pad">
        <button type="button" data-hold="left" aria-label="Move left">Left</button>
        <button type="button" data-hold="right" aria-label="Move right">Right</button>
        <button type="button" data-hold="jump" aria-label="Jump">Jump</button>
        <button type="button" data-hold="punch" aria-label="Punch">Punch</button>
        <button type="button" data-hold="kick" aria-label="Kick">Kick</button>
      </div>
      <p class="hint">Arrows or WASD to move and jump. J punches. K kicks.</p>
      <button type="button" class="primary" id="rematch" hidden>Rematch</button>
    </section>
    <p class="foot">Signaling uses the public PeerJS broker. The host decides hits and the round.</p>
  `
  app.append(wrap)

  const roomCode = must(wrap.querySelector<HTMLElement>('#room-code'))
  const you = must(wrap.querySelector<HTMLElement>('#you'))
  const status = must(wrap.querySelector<HTMLElement>('#status'))
  const error = must(wrap.querySelector<HTMLElement>('#error'))
  const share = must(wrap.querySelector<HTMLElement>('#share'))
  const joinUrl = must(wrap.querySelector<HTMLElement>('#join-url'))
  const qr = must(wrap.querySelector<HTMLImageElement>('#qr'))
  const hint = must(wrap.querySelector<HTMLElement>('#hint'))
  const stage = must(wrap.querySelector<HTMLElement>('#stage'))
  const canvas = must(wrap.querySelector<HTMLCanvasElement>('#arena'))
  const ctx = canvas.getContext('2d') ?? failCanvas()
  const hp0 = must(wrap.querySelector<HTMLElement>('#hp0'))
  const hp1 = must(wrap.querySelector<HTMLElement>('#hp1'))
  const clock = must(wrap.querySelector<HTMLElement>('#clock'))
  const rematch = must(wrap.querySelector<HTMLButtonElement>('#rematch'))
  const copy = must(wrap.querySelector<HTMLButtonElement>('#copy'))

  roomCode.textContent = roomId
  you.textContent = me === 0 ? 'You are red, on the left' : 'You are yellow, on the right'
  you.dataset.player = me === 0 ? '1' : '2'

  const url = shareUrl(roomId, 'fight')
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

  const mine = () => (role === 'host' ? hostInput : guestInput)
  for (const button of wrap.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    const key = button.dataset.hold
    if (key !== 'left' && key !== 'right' && key !== 'jump' && key !== 'punch' && key !== 'kick') continue
    const set = (down: boolean) => {
      mine()[key] = down
      button.dataset.on = down ? 'true' : 'false'
    }
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      button.setPointerCapture(event.pointerId)
      set(true)
    })
    const up = () => set(false)
    button.addEventListener('pointerup', up)
    button.addEventListener('pointercancel', up)
    button.addEventListener('lostpointercapture', up)
  }

  const keys: Record<string, keyof Input> = {
    arrowleft: 'left',
    a: 'left',
    arrowright: 'right',
    d: 'right',
    arrowup: 'jump',
    w: 'jump',
    ' ': 'jump',
    j: 'punch',
    f: 'punch',
    k: 'kick',
    l: 'kick',
  }
  const onKey = (event: KeyboardEvent, down: boolean) => {
    const key = keys[event.key.toLowerCase()]
    if (!key) return
    event.preventDefault()
    if (down && event.repeat) return
    mine()[key] = down
    const button = wrap.querySelector<HTMLButtonElement>(`[data-hold="${key}"]`)
    if (button) button.dataset.on = down ? 'true' : 'false'
  }
  const keyDown = (event: KeyboardEvent) => onKey(event, true)
  const keyUp = (event: KeyboardEvent) => onKey(event, false)
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)

  function describe(): string {
    if (world.over) {
      if (world.draw) return 'Draw'
      const iWon = (me === 0 && world.winner === 1) || (me === 1 && world.winner === 2)
      return iWon ? 'You win' : 'You lose'
    }
    if (!connected) return statusText
    return 'Fight'
  }

  function paint(): void {
    status.textContent = describe()
    status.dataset.you = world.over ? 'over' : 'wait'
    error.hidden = !errorText
    error.textContent = errorText
    const showShare = role === 'host' && peerReady && qrReady && !connected
    share.hidden = !showShare
    stage.hidden = !connected
    rematch.hidden = !(connected && world.over)
    hp0.style.width = `${world.fighters[0].health}%`
    hp1.style.width = `${world.fighters[1].health}%`
    clock.textContent = String(Math.ceil(world.timeLeft / 1000))
    app.dataset.connected = connected ? 'true' : 'false'
    app.dataset.screen = showShare ? 'share' : connected ? 'game' : 'joining'
    app.dataset.x0 = String(Math.round(world.fighters[0].x))
    app.dataset.x1 = String(Math.round(world.fighters[1].x))
    app.dataset.y0 = String(Math.round(world.fighters[0].y))
    app.dataset.over = world.over ? 'true' : 'false'
    draw()
  }

  function draw(): void {
    const width = canvas.clientWidth
    if (width <= 0) return
    const height = width * (ARENA_H / ARENA_W)
    canvas.style.height = `${height}px`
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pixelW = Math.round(width * dpr)
    const pixelH = Math.round(height * dpr)
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW
      canvas.height = pixelH
    }
    ctx.setTransform((pixelW / ARENA_W), 0, 0, (pixelH / ARENA_H), 0, 0)
    const sky = ctx.createLinearGradient(0, 0, 0, ARENA_H)
    sky.addColorStop(0, '#24517a')
    sky.addColorStop(1, '#102033')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, ARENA_W, ARENA_H)
    ctx.fillStyle = '#1b2838'
    ctx.fillRect(0, GROUND, ARENA_W, ARENA_H - GROUND)
    ctx.strokeStyle = '#8fb4d6'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(0, GROUND)
    ctx.lineTo(ARENA_W, GROUND)
    ctx.stroke()
    drawFighter(ctx, world.fighters[1], '#f5c400')
    drawFighter(ctx, world.fighters[0], '#e10600')
  }

  function sendWorld(): void {
    link.send({ t: 'world', world })
    lastSend = performance.now()
  }

  function resetRound(): void {
    world = createWorld()
    prevHost = blankInput()
    prevGuest = blankInput()
    sendWorld()
    paint()
  }

  const link: PeerLink = openRoom(peerIdForRoom(roomId, 'fight'), role, {
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
      if (role === 'host') {
        world = createWorld()
        prevHost = blankInput()
        prevGuest = blankInput()
        sendWorld()
      }
      paint()
    },
    onDisconnected() {
      connected = false
      guestInput = blankInput()
      statusText =
        role === 'host'
          ? 'The other player disconnected. They can rejoin with the same code.'
          : 'Lost the host. Reopen this page if they are still sharing.'
      paint()
    },
    onData(raw) {
      if (!raw || typeof raw !== 'object') return
      const msg = raw as { t?: unknown; input?: unknown; world?: unknown }
      if (msg.t === 'input' && role === 'host') {
        const input = parseInput(msg.input)
        if (input) guestInput = input
      } else if (msg.t === 'world' && role === 'guest') {
        const next = parseWorld(msg.world)
        if (!next) return
        world = next
        connected = true
        errorText = ''
        paint()
      } else if (msg.t === 'rematch' && role === 'host') {
        resetRound()
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
      resetRound()
      return
    }
    link.send({ t: 'rematch' })
    statusText = 'Asking for a rematch…'
    paint()
  })

  wrap.querySelector<HTMLButtonElement>('#leave')?.addEventListener('click', () => {
    stop()
    clearHost()
    const next = new URL(location.href)
    next.search = ''
    next.hash = ''
    location.assign(next.toString())
  })

  function frame(now: number): void {
    if (lastFrame === 0) lastFrame = now
    const elapsed = Math.min(100, now - lastFrame)
    lastFrame = now
    acc += elapsed
    let steps = 0
    let health = world.fighters[0].health + world.fighters[1].health
    const wasOver = world.over
    while (role === 'host' && connected && !world.over && acc >= STEP && steps < 5) {
      stepWorld(world, [hostInput, guestInput], [prevHost, prevGuest], STEP)
      prevHost = { ...hostInput }
      prevGuest = { ...guestInput }
      acc -= STEP
      steps += 1
    }
    if (!(role === 'host' && connected && !world.over)) acc = 0
    if (role === 'guest' && connected && (inputDiffers(guestInput, lastSentInput) || now - lastInputSend >= SEND_MS)) {
      lastSentInput = { ...guestInput }
      lastInputSend = now
      link.send({ t: 'input', input: lastSentInput })
    }
    if (role === 'host' && connected) {
      const changed = world.fighters[0].health + world.fighters[1].health !== health || world.over !== wasOver
      if (changed || now - lastSend >= SEND_MS) sendWorld()
    }
    paint()
    raf = window.requestAnimationFrame(frame)
  }

  function stop(): void {
    window.cancelAnimationFrame(raf)
    window.removeEventListener('keydown', keyDown)
    window.removeEventListener('keyup', keyUp)
    link.destroy()
  }

  window.addEventListener('pagehide', () => stop(), { once: true })
  paint()
  raf = window.requestAnimationFrame(frame)
}

function inputDiffers(a: Input, b: Input): boolean {
  return a.left !== b.left || a.right !== b.right || a.jump !== b.jump || a.punch !== b.punch || a.kick !== b.kick
}

function failCanvas(): CanvasRenderingContext2D {
  throw new Error('Canvas is unavailable')
}

function must<T extends Element>(element: T | null): T {
  if (!element) throw new Error('Missing fight element')
  return element
}

function drawFighter(ctx: CanvasRenderingContext2D, fighter: Fighter, color: string): void {
  const hip = fighter.y - 48
  const shoulder = fighter.y - 96
  const head = fighter.y - 122
  const dir = fighter.facing
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(fighter.x, hip)
  ctx.lineTo(fighter.x - 18, fighter.y)
  ctx.moveTo(fighter.x, hip)
  if (fighter.attack === 2) ctx.lineTo(fighter.x + dir * 64, hip + 6)
  else ctx.lineTo(fighter.x + 18, fighter.y)
  ctx.moveTo(fighter.x, hip)
  ctx.lineTo(fighter.x, shoulder)
  ctx.moveTo(fighter.x, shoulder)
  ctx.lineTo(fighter.x - dir * 20, shoulder + 30)
  ctx.moveTo(fighter.x, shoulder)
  if (fighter.attack === 1) ctx.lineTo(fighter.x + dir * 58, shoulder + 4)
  else ctx.lineTo(fighter.x + dir * 18, shoulder + 32)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(fighter.x, head, 15, 0, Math.PI * 2)
  ctx.fill()
}
