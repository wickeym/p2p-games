export type Color = 'w' | 'b'
export type Kind = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'
export type Promo = 'q' | 'r' | 'b' | 'n'
export interface Piece {
  color: Color
  kind: Kind
}
export type Board = (Piece | null)[]

export interface Move {
  from: number
  to: number
  promotion?: Promo
}

export interface Castling {
  wK: boolean
  wQ: boolean
  bK: boolean
  bQ: boolean
}

export interface Position {
  board: Board
  turn: Color
  castling: Castling
  /** Square a pawn would land on to capture en passant, or null. */
  ep: number | null
  last: string
  lastFrom: number | null
  lastTo: number | null
  over: 'play' | 'mate' | 'stalemate'
  winner: Color | null
  check: boolean
}

const KNIGHT: readonly (readonly [number, number])[] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
]
const KING: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]
const ORTH: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DIAG: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const PROMOS: readonly Promo[] = ['q', 'r', 'b', 'n']

export function fileOf(square: number): number {
  return square % 8
}

export function rankOf(square: number): number {
  return Math.floor(square / 8)
}

export function sq(file: number, rank: number): number {
  return rank * 8 + file
}

export function algebraic(square: number): string {
  return `${'abcdefgh'[fileOf(square)] ?? '?'}${rankOf(square) + 1}`
}

function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8
}

function enemy(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function cloneBoard(board: Board): Board {
  return board.map((piece) => (piece ? { color: piece.color, kind: piece.kind } : null))
}

function rayHits(board: Board, file: number, rank: number, df: number, dr: number, by: Color, kinds: readonly Kind[]): boolean {
  let f = file + df
  let r = rank + dr
  while (onBoard(f, r)) {
    const piece = board[sq(f, r)]
    if (piece) return piece.color === by && kinds.includes(piece.kind)
    f += df
    r += dr
  }
  return false
}

/** True when `by` attacks `target`, ignoring pins and whose turn it is. */
export function isAttacked(board: Board, target: number, by: Color): boolean {
  const file = fileOf(target)
  const rank = rankOf(target)
  const pawnRank = rank - (by === 'w' ? 1 : -1)
  if (pawnRank >= 0 && pawnRank < 8) {
    for (const df of [-1, 1]) {
      const pf = file + df
      if (!onBoard(pf, pawnRank)) continue
      const piece = board[sq(pf, pawnRank)]
      if (piece?.color === by && piece.kind === 'p') return true
    }
  }
  for (const [df, dr] of KNIGHT) {
    const f = file + df
    const r = rank + dr
    if (!onBoard(f, r)) continue
    const piece = board[sq(f, r)]
    if (piece?.color === by && piece.kind === 'n') return true
  }
  for (const [df, dr] of KING) {
    const f = file + df
    const r = rank + dr
    if (!onBoard(f, r)) continue
    const piece = board[sq(f, r)]
    if (piece?.color === by && piece.kind === 'k') return true
  }
  if (rayHits(board, file, rank, 1, 1, by, ['b', 'q'])) return true
  if (rayHits(board, file, rank, 1, -1, by, ['b', 'q'])) return true
  if (rayHits(board, file, rank, -1, 1, by, ['b', 'q'])) return true
  if (rayHits(board, file, rank, -1, -1, by, ['b', 'q'])) return true
  if (rayHits(board, file, rank, 1, 0, by, ['r', 'q'])) return true
  if (rayHits(board, file, rank, -1, 0, by, ['r', 'q'])) return true
  if (rayHits(board, file, rank, 0, 1, by, ['r', 'q'])) return true
  if (rayHits(board, file, rank, 0, -1, by, ['r', 'q'])) return true
  return false
}

function kingSquare(board: Board, color: Color): number {
  for (let i = 0; i < 64; i++) {
    const piece = board[i]
    if (piece?.color === color && piece.kind === 'k') return i
  }
  return -1
}

export function inCheck(pos: Position, color: Color): boolean {
  const king = kingSquare(pos.board, color)
  if (king < 0) return true
  return isAttacked(pos.board, king, enemy(color))
}

function addPawnMoves(pos: Position, from: number, moves: Move[]): void {
  const piece = pos.board[from]
  if (!piece || piece.kind !== 'p') return
  const dir = piece.color === 'w' ? 1 : -1
  const start = piece.color === 'w' ? 1 : 6
  const last = piece.color === 'w' ? 7 : 0
  const file = fileOf(from)
  const rank = rankOf(from)
  const push = (to: number) => {
    if (rankOf(to) === last) {
      for (const promotion of PROMOS) moves.push({ from, to, promotion })
    } else {
      moves.push({ from, to })
    }
  }
  const oneRank = rank + dir
  if (onBoard(file, oneRank) && pos.board[sq(file, oneRank)] === null) {
    push(sq(file, oneRank))
    const twoRank = rank + dir * 2
    if (rank === start && pos.board[sq(file, twoRank)] === null) push(sq(file, twoRank))
  }
  for (const df of [-1, 1]) {
    const tf = file + df
    const tr = rank + dir
    if (!onBoard(tf, tr)) continue
    const to = sq(tf, tr)
    const target = pos.board[to]
    if ((target && target.color !== piece.color) || to === pos.ep) push(to)
  }
}

function addSteps(pos: Position, from: number, steps: readonly (readonly [number, number])[], moves: Move[]): void {
  const piece = pos.board[from]
  if (!piece) return
  const file = fileOf(from)
  const rank = rankOf(from)
  for (const [df, dr] of steps) {
    const f = file + df
    const r = rank + dr
    if (!onBoard(f, r)) continue
    const to = sq(f, r)
    const target = pos.board[to]
    if (!target || target.color !== piece.color) moves.push({ from, to })
  }
}

function addSlides(pos: Position, from: number, dirs: readonly (readonly [number, number])[], moves: Move[]): void {
  const piece = pos.board[from]
  if (!piece) return
  const file = fileOf(from)
  const rank = rankOf(from)
  for (const [df, dr] of dirs) {
    let f = file + df
    let r = rank + dr
    while (onBoard(f, r)) {
      const to = sq(f, r)
      const target = pos.board[to]
      if (!target) moves.push({ from, to })
      else {
        if (target.color !== piece.color) moves.push({ from, to })
        break
      }
      f += df
      r += dr
    }
  }
}

function castleOk(pos: Position, color: Color, side: 'K' | 'Q'): boolean {
  const rights = pos.castling
  if (color === 'w' && side === 'K' && !rights.wK) return false
  if (color === 'w' && side === 'Q' && !rights.wQ) return false
  if (color === 'b' && side === 'K' && !rights.bK) return false
  if (color === 'b' && side === 'Q' && !rights.bQ) return false
  const rank = color === 'w' ? 0 : 7
  const king = pos.board[sq(4, rank)]
  const rookFile = side === 'K' ? 7 : 0
  const rook = pos.board[sq(rookFile, rank)]
  if (king?.kind !== 'k' || king.color !== color) return false
  if (rook?.kind !== 'r' || rook.color !== color) return false
  const foe = enemy(color)
  if (isAttacked(pos.board, sq(4, rank), foe)) return false
  if (side === 'K') {
    if (pos.board[sq(5, rank)] || pos.board[sq(6, rank)]) return false
    if (isAttacked(pos.board, sq(5, rank), foe) || isAttacked(pos.board, sq(6, rank), foe)) return false
  } else {
    if (pos.board[sq(1, rank)] || pos.board[sq(2, rank)] || pos.board[sq(3, rank)]) return false
    if (isAttacked(pos.board, sq(2, rank), foe) || isAttacked(pos.board, sq(3, rank), foe)) return false
  }
  return true
}

function pseudo(pos: Position): Move[] {
  const moves: Move[] = []
  for (let from = 0; from < 64; from++) {
    const piece = pos.board[from]
    if (!piece || piece.color !== pos.turn) continue
    if (piece.kind === 'p') addPawnMoves(pos, from, moves)
    else if (piece.kind === 'n') addSteps(pos, from, KNIGHT, moves)
    else if (piece.kind === 'k') addSteps(pos, from, KING, moves)
    else if (piece.kind === 'b') addSlides(pos, from, DIAG, moves)
    else if (piece.kind === 'r') addSlides(pos, from, ORTH, moves)
    else addSlides(pos, from, [...DIAG, ...ORTH], moves)
  }
  if (castleOk(pos, pos.turn, 'K')) {
    const rank = pos.turn === 'w' ? 0 : 7
    moves.push({ from: sq(4, rank), to: sq(6, rank) })
  }
  if (castleOk(pos, pos.turn, 'Q')) {
    const rank = pos.turn === 'w' ? 0 : 7
    moves.push({ from: sq(4, rank), to: sq(2, rank) })
  }
  return moves
}

function moveLabel(pos: Position, move: Move): string {
  const piece = pos.board[move.from]
  if (!piece) return ''
  if (piece.kind === 'k' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
    return fileOf(move.to) === 6 ? 'O-O' : 'O-O-O'
  }
  const names: Record<Kind, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' }
  const capture = pos.board[move.to] !== null || (piece.kind === 'p' && move.to === pos.ep)
  const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : ''
  const ep = piece.kind === 'p' && move.to === pos.ep ? ' e.p.' : ''
  const pawnFile = piece.kind === 'p' && capture ? `abcdefgh`[fileOf(move.from)] : ''
  return `${names[piece.kind]}${pawnFile}${capture ? 'x' : ''}${algebraic(move.to)}${promo}${ep}`
}

function updateCastling(castling: Castling, from: number, to: number): Castling {
  const next = { ...castling }
  const touch = (square: number) => {
    if (square === sq(4, 0)) {
      next.wK = false
      next.wQ = false
    }
    if (square === sq(0, 0)) next.wQ = false
    if (square === sq(7, 0)) next.wK = false
    if (square === sq(4, 7)) {
      next.bK = false
      next.bQ = false
    }
    if (square === sq(0, 7)) next.bQ = false
    if (square === sq(7, 7)) next.bK = false
  }
  touch(from)
  touch(to)
  return next
}

function applyRaw(pos: Position, move: Move): Position {
  const board = cloneBoard(pos.board)
  const piece = board[move.from]
  if (!piece) return pos
  const landing = board[move.to]
  const epCapture = piece.kind === 'p' && move.to === pos.ep && landing === null
  board[move.from] = null
  board[move.to] = move.promotion ? { color: piece.color, kind: move.promotion } : { color: piece.color, kind: piece.kind }
  if (epCapture) board[move.to + (piece.color === 'w' ? -8 : 8)] = null
  if (piece.kind === 'k' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
    const rank = rankOf(move.from)
    if (fileOf(move.to) === 6) {
      board[sq(5, rank)] = board[sq(7, rank)]
      board[sq(7, rank)] = null
    } else {
      board[sq(3, rank)] = board[sq(0, rank)]
      board[sq(0, rank)] = null
    }
  }
  let ep: number | null = null
  if (piece.kind === 'p' && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) {
    ep = sq(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
  }
  return {
    board,
    turn: enemy(piece.color),
    castling: updateCastling(pos.castling, move.from, move.to),
    ep,
    last: moveLabel(pos, move),
    lastFrom: move.from,
    lastTo: move.to,
    over: 'play',
    winner: null,
    check: false,
  }
}

export function legalMoves(pos: Position): Move[] {
  if (pos.over !== 'play') return []
  const moves: Move[] = []
  for (const move of pseudo(pos)) {
    const next = applyRaw(pos, move)
    if (!inCheck(next, pos.turn)) moves.push(move)
  }
  return moves
}

function withStatus(pos: Position): Position {
  const check = inCheck(pos, pos.turn)
  const playable = pos.over === 'play'
  if (!playable) return { ...pos, check }
  const moves = legalMoves({ ...pos, over: 'play' })
  if (moves.length > 0) return { ...pos, check, over: 'play', winner: null }
  if (check) return { ...pos, check: true, over: 'mate', winner: enemy(pos.turn) }
  return { ...pos, check: false, over: 'stalemate', winner: null }
}

export function createGame(): Position {
  const board: Board = Array.from({ length: 64 }, () => null)
  const back: Kind[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
  for (let file = 0; file < 8; file++) {
    board[sq(file, 0)] = { color: 'w', kind: back[file] ?? 'r' }
    board[sq(file, 1)] = { color: 'w', kind: 'p' }
    board[sq(file, 6)] = { color: 'b', kind: 'p' }
    board[sq(file, 7)] = { color: 'b', kind: back[file] ?? 'r' }
  }
  return withStatus({
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null,
    last: '',
    lastFrom: null,
    lastTo: null,
    over: 'play',
    winner: null,
    check: false,
  })
}

export function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '')
}

/** Apply a legal move. Returns null when the move is not legal. */
export function playMove(pos: Position, move: Move): Position | null {
  if (pos.over !== 'play') return null
  const match = legalMoves(pos).find((candidate) => sameMove(candidate, move))
  if (!match) return null
  return withStatus(applyRaw(pos, match))
}

function isPiece(value: unknown): value is Piece {
  if (!value || typeof value !== 'object') return false
  const piece = value as Partial<Piece>
  const kinds: Kind[] = ['k', 'q', 'r', 'b', 'n', 'p']
  return (piece.color === 'w' || piece.color === 'b') && !!piece.kind && kinds.includes(piece.kind)
}

export function parsePosition(value: unknown): Position | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Position>
  if (!Array.isArray(raw.board) || raw.board.length !== 64) return null
  const board: Board = []
  let whiteKings = 0
  let blackKings = 0
  for (const cell of raw.board) {
    if (cell === null) {
      board.push(null)
      continue
    }
    if (!isPiece(cell)) return null
    board.push({ color: cell.color, kind: cell.kind })
    if (cell.kind === 'k' && cell.color === 'w') whiteKings += 1
    if (cell.kind === 'k' && cell.color === 'b') blackKings += 1
  }
  if (whiteKings !== 1 || blackKings !== 1) return null
  if (raw.turn !== 'w' && raw.turn !== 'b') return null
  const rights = raw.castling
  if (!rights || typeof rights !== 'object') return null
  const flags = rights as Partial<Castling>
  if (typeof flags.wK !== 'boolean' || typeof flags.wQ !== 'boolean') return null
  if (typeof flags.bK !== 'boolean' || typeof flags.bQ !== 'boolean') return null
  let ep: number | null = null
  if (typeof raw.ep === 'number' && raw.ep >= 0 && raw.ep < 64) {
    const rank = rankOf(raw.ep)
    if (rank === 2 || rank === 5) ep = raw.ep
  }
  return withStatus({
    board,
    turn: raw.turn,
    castling: { wK: flags.wK, wQ: flags.wQ, bK: flags.bK, bQ: flags.bQ },
    ep,
    last: typeof raw.last === 'string' ? raw.last : '',
    lastFrom: typeof raw.lastFrom === 'number' && raw.lastFrom >= 0 && raw.lastFrom < 64 ? raw.lastFrom : null,
    lastTo: typeof raw.lastTo === 'number' && raw.lastTo >= 0 && raw.lastTo < 64 ? raw.lastTo : null,
    over: 'play',
    winner: null,
    check: false,
  })
}
