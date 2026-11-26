export const COLS = 7
export const ROWS = 6

export type Player = 1 | 2
export type Cell = 0 | Player
export type Board = Cell[][]
export type Line = [number, number][]

export interface GameState {
  board: Board
  /** Player who moves next. Ignored once the game is over. */
  turn: Player
  winner: Player | 0
  draw: boolean
  winning: Line
}

const DIRS: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

export function emptyBoard(): Board {
  const board: Board = []
  for (let row = 0; row < ROWS; row++) {
    const cells: Cell[] = []
    for (let col = 0; col < COLS; col++) cells.push(0)
    board.push(cells)
  }
  return board
}

export function findWins(board: Board): { winner: Player; cells: Line } | null {
  const cells = new Set<string>()
  let winner: Player | 0 = 0
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const player = board[row][col]
      if (player === 0) continue
      for (const [dr, dc] of DIRS) {
        const line: Line = []
        for (let step = 0; step < 4; step++) {
          const r = row + dr * step
          const c = col + dc * step
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) {
            line.length = 0
            break
          }
          line.push([r, c])
        }
        if (line.length < 4) continue
        if (winner === 0) winner = player
        if (player !== winner) continue
        for (const [r, c] of line) cells.add(`${r},${c}`)
      }
    }
  }
  if (winner === 0) return null
  const winning: Line = []
  for (const key of cells) {
    const [r, c] = key.split(',').map(Number)
    winning.push([r, c])
  }
  return { winner, cells: winning }
}

function boardIsFull(board: Board): boolean {
  for (const row of board) {
    for (const cell of row) {
      if (cell === 0) return false
    }
  }
  return true
}

export function derive(board: Board, turn: Player): GameState {
  const found = findWins(board)
  const winner = found?.winner ?? 0
  return {
    board,
    turn,
    winner,
    draw: winner === 0 && boardIsFull(board),
    winning: found?.cells ?? [],
  }
}

export function newGame(): GameState {
  return derive(emptyBoard(), 1)
}

/** Drop `player`'s disc into a column. Returns null when the move is illegal. */
export function applyMove(state: GameState, col: number, player: Player): GameState | null {
  if (state.winner !== 0 || state.draw) return null
  if (state.turn !== player) return null
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return null

  const board = state.board.map((row) => row.slice())
  let placed = false
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] !== 0) continue
    board[row][col] = player
    placed = true
    break
  }
  if (!placed) return null
  const nextTurn: Player = player === 1 ? 2 : 1
  return derive(board, nextTurn)
}

export function parseState(value: unknown): GameState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { board?: unknown; turn?: unknown }
  if (!Array.isArray(raw.board) || raw.board.length !== ROWS) return null
  const board: Board = []
  for (const row of raw.board) {
    if (!Array.isArray(row) || row.length !== COLS) return null
    const cells: Cell[] = []
    for (const cell of row) {
      if (cell !== 0 && cell !== 1 && cell !== 2) return null
      cells.push(cell)
    }
    board.push(cells)
  }
  if (raw.turn !== 1 && raw.turn !== 2) return null
  return derive(board, raw.turn)
}
