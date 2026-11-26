export const ARENA_W = 960
export const ARENA_H = 540
export const GROUND = 460
export const ROUND_MS = 45_000
export const MAX_HEALTH = 100

const MOVE_SPEED = 280
const JUMP_V = -640
const GRAVITY = 1800
const BODY_R = 28
const PUNCH_REACH = 52
const PUNCH_R = 26
const KICK_REACH = 70
const KICK_R = 30
export const PUNCH_MS = 220
export const KICK_MS = 300
export const STUN_MS = 320
const PUNCH_DMG = 10
const KICK_DMG = 16

export interface Fighter {
  x: number
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  health: number
  /** 0 idle, 1 punch, 2 kick. */
  attack: 0 | 1 | 2
  attackMs: number
  stunMs: number
  /** This swing has already connected. */
  hit: boolean
}

export interface Input {
  left: boolean
  right: boolean
  jump: boolean
  punch: boolean
  kick: boolean
}

export interface World {
  fighters: [Fighter, Fighter]
  timeLeft: number
  /** 0 while the round is open, 1 if fighter 0 won, 2 if fighter 1 won. */
  winner: 0 | 1 | 2
  draw: boolean
  over: boolean
}

export function blankInput(): Input {
  return { left: false, right: false, jump: false, punch: false, kick: false }
}

function fighter(x: number, facing: 1 | -1): Fighter {
  return {
    x,
    y: GROUND,
    vx: 0,
    vy: 0,
    facing,
    health: MAX_HEALTH,
    attack: 0,
    attackMs: 0,
    stunMs: 0,
    hit: false,
  }
}

export function createWorld(): World {
  return {
    fighters: [fighter(220, 1), fighter(740, -1)],
    timeLeft: ROUND_MS,
    winner: 0,
    draw: false,
    over: false,
  }
}

function edge(now: boolean, before: boolean): boolean {
  return now && !before
}

function startAttack(fighterState: Fighter, kind: 1 | 2): void {
  fighterState.attack = kind
  fighterState.attackMs = kind === 1 ? PUNCH_MS : KICK_MS
  fighterState.hit = false
}

function separate(a: Fighter, b: Fighter): void {
  const min = BODY_R * 2
  const gap = b.x - a.x
  const abs = Math.abs(gap)
  if (abs >= min || abs === 0) return
  const push = (min - abs) / 2
  const sign = gap < 0 ? -1 : 1
  a.x -= sign * push
  b.x += sign * push
}

function clampX(fighterState: Fighter): void {
  if (fighterState.x < 48) fighterState.x = 48
  if (fighterState.x > ARENA_W - 48) fighterState.x = ARENA_W - 48
}

function tryHit(attacker: Fighter, defender: Fighter): void {
  if (attacker.hit || attacker.attack === 0) return
  const reach = attacker.attack === 1 ? PUNCH_REACH : KICK_REACH
  const radius = attacker.attack === 1 ? PUNCH_R : KICK_R
  const hx = attacker.x + attacker.facing * reach
  const hy = attacker.y - (attacker.attack === 1 ? 78 : 36)
  const by = defender.y - 70
  const dx = hx - defender.x
  const dy = hy - by
  if (dx * dx + dy * dy > (radius + BODY_R) * (radius + BODY_R)) return
  const damage = attacker.attack === 1 ? PUNCH_DMG : KICK_DMG
  defender.health = Math.max(0, defender.health - damage)
  defender.stunMs = STUN_MS
  defender.vx = attacker.facing * 220
  defender.vy = -220
  attacker.hit = true
}

function finish(world: World): void {
  const [a, b] = world.fighters
  const expired = world.timeLeft <= 0
  const down = a.health <= 0 || b.health <= 0
  if (!expired && !down) return
  world.over = true
  world.timeLeft = Math.max(0, world.timeLeft)
  if (a.health === b.health) {
    world.draw = true
    world.winner = 0
    return
  }
  world.draw = false
  world.winner = a.health > b.health ? 1 : 2
}

/** Advance the round. `prev` is last frame's held buttons, used for jump and attack edges. */
export function stepWorld(world: World, inputs: [Input, Input], prev: [Input, Input], dtMs: number): void {
  if (world.over) return
  const capped = Math.min(Math.max(dtMs, 0), 40)
  const dt = capped / 1000
  world.timeLeft -= capped

  for (let i = 0; i < 2; i++) {
    const fighterState = world.fighters[i]
    const input = inputs[i]
    const before = prev[i]
    fighterState.attackMs = Math.max(0, fighterState.attackMs - capped)
    fighterState.stunMs = Math.max(0, fighterState.stunMs - capped)
    if (fighterState.attackMs === 0) fighterState.attack = 0

    const stunned = fighterState.stunMs > 0
    if (!stunned) {
      const left = input.left && !input.right
      const right = input.right && !input.left
      fighterState.vx = left ? -MOVE_SPEED : right ? MOVE_SPEED : 0
      if (left) fighterState.facing = -1
      if (right) fighterState.facing = 1
      if (fighterState.attackMs === 0) {
        if (input.kick) startAttack(fighterState, 2)
        else if (input.punch) startAttack(fighterState, 1)
      }
    }

    const grounded = fighterState.y >= GROUND - 0.5 && fighterState.vy >= 0
    if (grounded) {
      fighterState.y = GROUND
      fighterState.vy = 0
      if (!stunned && edge(input.jump, before.jump)) fighterState.vy = JUMP_V
    } else {
      fighterState.vy += GRAVITY * dt
    }
    fighterState.x += fighterState.vx * dt
    fighterState.y += fighterState.vy * dt
    if (fighterState.y >= GROUND) {
      fighterState.y = GROUND
      fighterState.vy = 0
    }
  }

  separate(world.fighters[0], world.fighters[1])
  clampX(world.fighters[0])
  clampX(world.fighters[1])
  tryHit(world.fighters[0], world.fighters[1])
  tryHit(world.fighters[1], world.fighters[0])
  finish(world)
}

function isFacing(value: unknown): value is 1 | -1 {
  return value === 1 || value === -1
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseFighter(value: unknown, fallback: Fighter): Fighter {
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<Fighter>
  const attack = raw.attack === 1 || raw.attack === 2 ? raw.attack : 0
  return {
    x: num(raw.x, fallback.x),
    y: num(raw.y, fallback.y),
    vx: num(raw.vx, 0),
    vy: num(raw.vy, 0),
    facing: isFacing(raw.facing) ? raw.facing : fallback.facing,
    health: Math.max(0, Math.min(MAX_HEALTH, num(raw.health, fallback.health))),
    attack,
    attackMs: Math.max(0, num(raw.attackMs, 0)),
    stunMs: Math.max(0, num(raw.stunMs, 0)),
    hit: raw.hit === true,
  }
}

export function parseInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Input>
  if (typeof raw.left !== 'boolean') return null
  if (typeof raw.right !== 'boolean') return null
  if (typeof raw.jump !== 'boolean') return null
  if (typeof raw.punch !== 'boolean') return null
  if (typeof raw.kick !== 'boolean') return null
  return { left: raw.left, right: raw.right, jump: raw.jump, punch: raw.punch, kick: raw.kick }
}

export function parseWorld(value: unknown): World | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<World>
  if (!Array.isArray(raw.fighters) || raw.fighters.length !== 2) return null
  const fresh = createWorld()
  const winner = raw.winner === 1 || raw.winner === 2 ? raw.winner : 0
  return {
    fighters: [parseFighter(raw.fighters[0], fresh.fighters[0]), parseFighter(raw.fighters[1], fresh.fighters[1])],
    timeLeft: Math.max(0, num(raw.timeLeft, fresh.timeLeft)),
    winner,
    draw: raw.draw === true,
    over: raw.over === true,
  }
}
