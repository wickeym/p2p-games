import {
  ARENA_H,
  ARENA_W,
  blankInput,
  createWorld,
  GROUND,
  KICK_MS,
  parseInput,
  parseWorld,
  PUNCH_MS,
  stepWorld,
  STUN_MS,
  type Fighter,
  type Input,
  type World,
} from './fight-sim.ts'
import { openRoom, type PeerLink, type Role } from './peer.ts'
import { qrDataUrl } from './qr.ts'
import { peerIdForRoom } from './room.ts'
import { lanHostMissing, shareUrl } from './share.ts'

const STEP = 1000 / 60
const SEND_MS = 16

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
  let stickLeft = false
  let stickRight = false
  let keyLeft = false
  let keyRight = false
  let stickPointer: number | null = null
  const shown = createWorld()
  const viewport = document.querySelector('meta[name="viewport"]')
  const savedViewport = viewport instanceof HTMLMetaElement ? viewport.content : ''

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
      <div class="arena-slot"><canvas id="arena" class="arena" width="960" height="540"></canvas></div>
      <div class="controls">
        <div class="stick" id="stick" aria-label="Move left or right">
          <div class="stick-knob" id="knob"></div>
        </div>
        <div class="actions">
          <button type="button" data-hold="jump" aria-label="Jump">Jump</button>
          <button type="button" data-hold="punch" aria-label="Punch">Punch</button>
          <button type="button" data-hold="kick" aria-label="Kick">Kick</button>
        </div>
      </div>
      <p class="hint keys">Arrows or WASD, J punch, K kick.</p>
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
  const stick = must(wrap.querySelector<HTMLElement>('#stick'))
  const knob = must(wrap.querySelector<HTMLElement>('#knob'))
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
  const applyAxes = () => {
    const input = mine()
    input.left = stickLeft || keyLeft
    input.right = stickRight || keyRight
  }
  const placeKnob = (clientX: number, clientY: number) => {
    const rect = stick.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const max = Math.max(24, rect.width / 2 - 28)
    let dx = clientX - cx
    let dy = clientY - cy
    const mag = Math.hypot(dx, dy)
    if (mag > max) {
      dx = (dx / mag) * max
      dy = (dy / mag) * max
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`
    const axis = dx / max
    stickLeft = axis < -0.28
    stickRight = axis > 0.28
    stick.dataset.held = stickPointer === null ? 'false' : 'true'
    stick.dataset.dir = stickLeft ? 'left' : stickRight ? 'right' : 'center'
    applyAxes()
  }
  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    try {
      stick.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic events and some browsers refuse capture; the pointer id still tracks the drag.
    }
    stickPointer = event.pointerId
    placeKnob(event.clientX, event.clientY)
  })
  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stickPointer) return
    event.preventDefault()
    placeKnob(event.clientX, event.clientY)
  })
  const releaseStick = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return
    stickPointer = null
    placeKnob(stick.getBoundingClientRect().left + stick.getBoundingClientRect().width / 2, stick.getBoundingClientRect().top + stick.getBoundingClientRect().height / 2)
  }
  stick.addEventListener('pointerup', releaseStick)
  stick.addEventListener('pointercancel', releaseStick)

  for (const button of wrap.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    const key = button.dataset.hold
    if (key !== 'jump' && key !== 'punch' && key !== 'kick') continue
    const set = (down: boolean) => {
      mine()[key] = down
      button.dataset.on = down ? 'true' : 'false'
    }
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      try {
        button.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic events have no active pointer. The button still latches.
      }
      set(true)
    })
    const up = () => set(false)
    button.addEventListener('pointerup', up)
    button.addEventListener('pointercancel', up)
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
    if (key === 'left') keyLeft = down
    else if (key === 'right') keyRight = down
    else mine()[key] = down
    applyAxes()
    const button = wrap.querySelector<HTMLButtonElement>(`[data-hold="${key}"]`)
    if (button) button.dataset.on = down ? 'true' : 'false'
  }
  const keyDown = (event: KeyboardEvent) => onKey(event, true)
  const keyUp = (event: KeyboardEvent) => onKey(event, false)
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)

  function setLock(on: boolean): void {
    document.documentElement.classList.toggle('fight-lock', on)
    if (viewport instanceof HTMLMetaElement) {
      viewport.content = on
        ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
        : savedViewport
    }
  }

  function follow(next: World): World {
    shown.timeLeft = next.timeLeft
    shown.winner = next.winner
    shown.draw = next.draw
    shown.over = next.over
    for (let i = 0; i < 2; i++) {
      const view = shown.fighters[i]
      const auth = next.fighters[i]
      if (!view || !auth) continue
      if (Math.abs(auth.x - view.x) > 90) view.x = auth.x
      else view.x += (auth.x - view.x) * 0.55
      if (Math.abs(auth.y - view.y) > 90) view.y = auth.y
      else view.y += (auth.y - view.y) * 0.55
      view.vx = auth.vx
      view.vy = auth.vy
      view.facing = auth.facing
      view.health = auth.health
      view.attack = auth.attack
      view.attackMs = auth.attackMs
      view.stunMs = auth.stunMs
      view.hit = auth.hit
    }
    return shown
  }

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
    const view = role === 'guest' ? follow(world) : world
    hp0.style.width = `${view.fighters[0].health}%`
    hp1.style.width = `${view.fighters[1].health}%`
    clock.textContent = String(Math.ceil(view.timeLeft / 1000))
    app.dataset.connected = connected ? 'true' : 'false'
    app.dataset.screen = showShare ? 'share' : connected ? 'game' : 'joining'
    app.dataset.x0 = String(Math.round(view.fighters[0].x))
    app.dataset.x1 = String(Math.round(view.fighters[1].x))
    app.dataset.y0 = String(Math.round(view.fighters[0].y))
    app.dataset.over = view.over ? 'true' : 'false'
    const held = mine()
    app.dataset.move = held.left ? 'left' : held.right ? 'right' : 'none'
    app.dataset.pose0 = poseOf(view.fighters[0])
    app.dataset.pose1 = poseOf(view.fighters[1])
    app.dataset.swing0 = String(swingOf(view.fighters[0]))
    app.dataset.leg0 = String(legOf(view.fighters[0]))
    setLock(connected)
    draw(view)
  }

  function draw(view: World): void {
    const slot = canvas.parentElement
    if (!slot) return
    const availW = slot.clientWidth
    const availH = slot.clientHeight
    if (availW <= 0 || availH <= 0) return
    const aspect = ARENA_W / ARENA_H
    let cssW = availW
    let cssH = cssW / aspect
    if (cssH > availH) {
      cssH = availH
      cssW = cssH * aspect
    }
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pixelW = Math.max(1, Math.round(cssW * dpr))
    const pixelH = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW
      canvas.height = pixelH
    }
    ctx.setTransform(pixelW / ARENA_W, 0, 0, pixelH / ARENA_H, 0, 0)
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
    drawFighter(ctx, view.fighters[1], '#f5c400')
    drawFighter(ctx, view.fighters[0], '#e10600')
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

  const blockScroll = (event: TouchEvent) => {
    if (!document.documentElement.classList.contains('fight-lock')) return
    event.preventDefault()
  }
  const blockGesture = (event: Event) => {
    if (document.documentElement.classList.contains('fight-lock')) event.preventDefault()
  }
  document.addEventListener('touchmove', blockScroll, { passive: false })
  document.addEventListener('gesturestart', blockGesture)

  function stop(): void {
    window.cancelAnimationFrame(raf)
    window.removeEventListener('keydown', keyDown)
    window.removeEventListener('keyup', keyUp)
    document.removeEventListener('touchmove', blockScroll)
    document.removeEventListener('gesturestart', blockGesture)
    setLock(false)
    link.destroy()
  }

  window.addEventListener('pagehide', () => stop(), { once: true })
  paint()
  raf = window.requestAnimationFrame(frame)
}

function poseOf(fighter: Fighter): string {
  if (fighter.stunMs > 0) return 'hurt'
  if (fighter.attack === 1) return 'punch'
  if (fighter.attack === 2) return 'kick'
  if (fighter.y < GROUND - 2) return 'jump'
  if (Math.abs(fighter.vx) > 20) return 'walk'
  return 'idle'
}

function swingOf(fighter: Fighter): number {
  if (fighter.attack === 0) return 0
  const total = fighter.attack === 1 ? PUNCH_MS : KICK_MS
  const progress = 1 - fighter.attackMs / total
  const clamped = Math.min(1, Math.max(0, progress))
  return Math.round(Math.sin(clamped * Math.PI) * 100)
}

function legOf(fighter: Fighter): number {
  const walking = Math.abs(fighter.vx) > 20 && fighter.y >= GROUND - 2 && fighter.attack !== 2 && fighter.stunMs === 0
  if (!walking) return 0
  return Math.round(Math.sin(fighter.x / 18) * 10)
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

function limb(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  return Math.sin(clamped * Math.PI)
}

function drawFighter(ctx: CanvasRenderingContext2D, fighter: Fighter, color: string): void {
  const dir = fighter.facing
  const grounded = fighter.y >= GROUND - 2
  const hurt = fighter.stunMs > 0 ? fighter.stunMs / STUN_MS : 0
  const lean = -dir * hurt * 28
  const walking = grounded && Math.abs(fighter.vx) > 20 && fighter.attack !== 2 && hurt === 0
  const step = walking ? Math.sin(fighter.x / 18) * 20 : 0
  const air = grounded ? 0 : Math.max(-1, Math.min(1, -fighter.vy / 700))
  const punch = fighter.attack === 1 ? limb(1 - fighter.attackMs / PUNCH_MS) : 0
  const kick = fighter.attack === 2 ? limb(1 - fighter.attackMs / KICK_MS) : 0
  const hipX = fighter.x + lean * 0.35
  const hipY = fighter.y - (grounded ? 50 : 40 + air * 6)
  const shoulderX = fighter.x + lean
  const shoulderY = fighter.y - (grounded ? 100 : 92)
  const headX = fighter.x + lean * 1.25
  const headY = fighter.y - (grounded ? 126 : 118)

  ctx.strokeStyle = color
  ctx.fillStyle = hurt > 0.2 ? '#fff4f4' : color
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(hipX, hipY)
  if (kick > 0) {
    ctx.lineTo(hipX - dir * (10 - step * 0.2), fighter.y - air * 10)
    ctx.moveTo(hipX, hipY)
    ctx.lineTo(hipX + dir * (16 + kick * 74), hipY + 8 - kick * 46)
  } else if (!grounded) {
    ctx.lineTo(hipX - 12, fighter.y - 18)
    ctx.moveTo(hipX, hipY)
    ctx.lineTo(hipX + dir * 18, fighter.y - 14 - air * 8)
  } else {
    ctx.lineTo(hipX - 16 + step, fighter.y)
    ctx.moveTo(hipX, hipY)
    ctx.lineTo(hipX + 16 - step, fighter.y)
  }
  ctx.moveTo(hipX, hipY)
  ctx.lineTo(shoulderX, shoulderY)
  ctx.moveTo(shoulderX, shoulderY)
  ctx.lineTo(shoulderX - dir * (18 + step * 0.35), shoulderY + 30 - air * 10)
  ctx.moveTo(shoulderX, shoulderY)
  ctx.lineTo(shoulderX + dir * (16 + punch * 62), shoulderY + 32 - punch * 40 - air * 8)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(headX, headY, 15, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.ellipse(fighter.x, GROUND + 6, 22 - air * 6, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}
