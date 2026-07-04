// Logique de puzzle côté serveur (source de vérité).
// Cases entières, une pièce par case. Soudure « libre » : deux pièces se collent
// si leurs bords s'emboîtent (tenon ↔ mortaise), même à la mauvaise place.
// Le score ne compte que les pièces réellement bien placées.
// Bac partagé : une pièce peut être mise de côté (tray) hors du plateau.

import {
  DIFFICULTIES,
  IMAGES,
  boardSize,
  edgesFit,
  isSolved,
  pieceEdges,
  wellPlacedSet,
  type Difficulty,
  type Game,
  type GameImage,
  type Piece,
} from "../../shared/types.ts";

const key = (gx: number, gy: number) => `${gx},${gy}`;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function configureGame(
  game: Game,
  imageId: string,
  difficulty: Difficulty,
  customImage?: { url: string; label: string }
): boolean {
  const def = DIFFICULTIES[difficulty];
  if (!def) return false;

  let image: GameImage | undefined;
  if (imageId === "custom" && customImage?.url) {
    image = { id: "custom", label: customImage.label || "Mon image", url: customImage.url };
  } else {
    image = IMAGES.find((i) => i.id === imageId);
  }
  if (!image) return false;

  const grid = { rows: def.rows, cols: def.cols };
  const board = boardSize(grid);

  const cells: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < board.rows; gy++) {
    for (let gx = 0; gx < board.cols; gx++) cells.push({ gx, gy });
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const pieces: Piece[] = [];
  let g = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = cells[pieces.length];
      pieces.push({
        id: `${row}-${col}`,
        row,
        col,
        gx: cell.gx,
        gy: cell.gy,
        group: g++,
        heldBy: null,
        placedBy: null,
        tray: false,
        trayOrder: 0,
      });
    }
  }

  game.image = image;
  game.difficulty = difficulty;
  game.grid = grid;
  game.board = board;
  game.pieces = pieces;
  game.status = "playing";
  game.completedAt = null;
  for (const p of Object.values(game.players)) p.piecesPlaced = 0;
  return true;
}

export function findPiece(game: Game, pieceId: string): Piece | undefined {
  return game.pieces.find((p) => p.id === pieceId);
}

function members(game: Game, group: number): Piece[] {
  return game.pieces.filter((p) => p.group === group);
}

// Occupation des cases : les pièces du bac (tray) ne sont pas sur le plateau.
function occupancy(game: Game): Map<string, Piece> {
  const map = new Map<string, Piece>();
  for (const p of game.pieces) if (!p.tray) map.set(key(p.gx, p.gy), p);
  return map;
}

function nextGroupId(game: Game): number {
  return game.pieces.reduce((m, p) => Math.max(m, p.group), 0) + 1;
}

function nextTrayOrder(game: Game): number {
  return game.pieces.reduce((m, p) => Math.max(m, p.trayOrder), 0) + 1;
}

export function grabGroup(
  game: Game,
  pieceId: string,
  playerId: string,
  single: boolean
): { ok: boolean; error?: string; group?: number; pieceIds?: string[] } {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.tray) return { ok: false, error: "piece_not_found" };
  if (piece.heldBy && piece.heldBy !== playerId) {
    return { ok: false, error: "locked" };
  }

  if (single && members(game, piece.group).length > 1) {
    piece.group = nextGroupId(game);
    piece.heldBy = playerId;
    return { ok: true, group: piece.group, pieceIds: [piece.id] };
  }

  const grp = members(game, piece.group);
  for (const p of grp) p.heldBy = playerId;
  return { ok: true, group: piece.group, pieceIds: grp.map((p) => p.id) };
}

export function moveGroup(
  game: Game,
  pieceId: string,
  gx: number,
  gy: number,
  playerId: string
): { ok: boolean; group?: number } {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.heldBy !== playerId || !game.board) return { ok: false };

  const dx = gx - piece.gx;
  const dy = gy - piece.gy;
  if (dx === 0 && dy === 0) return { ok: false };

  const grp = members(game, piece.group);
  const groupSet = new Set(grp.map((p) => p.id));
  const occ = occupancy(game);

  for (const p of grp) {
    const nx = p.gx + dx;
    const ny = p.gy + dy;
    if (nx < 0 || ny < 0 || nx >= game.board.cols || ny >= game.board.rows) {
      return { ok: false };
    }
    const other = occ.get(key(nx, ny));
    if (other && !groupSet.has(other.id)) return { ok: false };
  }

  for (const p of grp) {
    p.gx += dx;
    p.gy += dy;
  }
  return { ok: true, group: piece.group };
}

export interface DropResult {
  ok: boolean;
  settled?: Piece[];
  completed?: boolean;
}

function edgeInDir(game: Game, p: Piece, dx: number, dy: number): number {
  const e = pieceEdges(p.row, p.col, game.grid!);
  if (dx === 1) return e.right;
  if (dx === -1) return e.left;
  if (dy === 1) return e.bottom;
  return e.top;
}

// Soudure « libre » : fusionne dans `base` les voisins dont les bords s'emboîtent.
function bond(game: Game, base: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    const occ = occupancy(game);
    for (const p of members(game, base)) {
      for (const [dx, dy] of DIRS) {
        const q = occ.get(key(p.gx + dx, p.gy + dy));
        if (!q || q.group === base) continue;
        const a = edgeInDir(game, p, dx, dy);
        const b = edgeInDir(game, q, -dx, -dy);
        if (edgesFit(a, b)) {
          for (const m of members(game, q.group)) m.group = base;
          changed = true;
        }
      }
    }
  }
}

export function dropGroup(
  game: Game,
  pieceId: string,
  playerId: string
): DropResult {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.heldBy !== playerId) return { ok: false };

  const base = piece.group;
  for (const p of members(game, base)) p.heldBy = null;

  bond(game, base);
  updateScores(game, playerId, base);

  const completed = isSolved(game.pieces);
  if (completed && !game.completedAt) game.completedAt = Date.now();

  return { ok: true, settled: members(game, base), completed };
}

// Met une pièce de côté dans le bac partagé (la détache, la retire du plateau).
export function trayPiece(
  game: Game,
  pieceId: string,
  playerId: string
): { ok: boolean; order?: number } {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.tray) return { ok: false };
  if (piece.heldBy && piece.heldBy !== playerId) return { ok: false };

  piece.group = nextGroupId(game);
  piece.heldBy = null;
  piece.tray = true;
  piece.trayOrder = nextTrayOrder(game);

  retally(game); // une voisine a pu perdre sa correction
  return { ok: true, order: piece.trayOrder };
}

// Repose une pièce du bac sur une case libre du plateau, puis soude.
export function untrayPiece(
  game: Game,
  pieceId: string,
  gx: number,
  gy: number,
  playerId: string
): DropResult {
  const piece = findPiece(game, pieceId);
  if (!piece || !piece.tray || !game.board) return { ok: false };
  if (gx < 0 || gy < 0 || gx >= game.board.cols || gy >= game.board.rows) {
    return { ok: false };
  }
  if (occupancy(game).get(key(gx, gy))) return { ok: false };

  piece.tray = false;
  piece.trayOrder = 0;
  piece.gx = gx;
  piece.gy = gy;
  piece.group = nextGroupId(game);
  piece.heldBy = null;

  const base = piece.group;
  bond(game, base);
  updateScores(game, playerId, base);

  const completed = isSolved(game.pieces);
  if (completed && !game.completedAt) game.completedAt = Date.now();

  return { ok: true, settled: members(game, base), completed };
}

// Recalcule les pièces bien placées. On ne crédite que celles que ce joueur
// vient de placer : le groupe posé et ses voisines directes.
export function updateScores(game: Game, playerId: string, group: number): void {
  const well = wellPlacedSet(game.pieces);
  const occ = occupancy(game);
  const affected = new Set<string>();
  for (const p of members(game, group)) {
    affected.add(p.id);
    for (const [dx, dy] of DIRS) {
      const q = occ.get(key(p.gx + dx, p.gy + dy));
      if (q) affected.add(q.id);
    }
  }
  for (const p of game.pieces) {
    if (!well.has(p.id)) p.placedBy = null;
    else if (affected.has(p.id) && !p.placedBy) p.placedBy = playerId;
  }
  tally(game);
}

// Retire le crédit des pièces qui ne sont plus bien placées, puis recompte.
function retally(game: Game): void {
  const well = wellPlacedSet(game.pieces);
  for (const p of game.pieces) if (!well.has(p.id)) p.placedBy = null;
  tally(game);
}

function tally(game: Game): void {
  for (const player of Object.values(game.players)) player.piecesPlaced = 0;
  for (const p of game.pieces) {
    if (p.placedBy && game.players[p.placedBy]) {
      game.players[p.placedBy].piecesPlaced += 1;
    }
  }
}

export function releaseHeldBy(game: Game, playerId: string): Piece[] {
  const released: Piece[] = [];
  for (const p of game.pieces) {
    if (p.heldBy === playerId) {
      p.heldBy = null;
      released.push(p);
    }
  }
  return released;
}

export function placedCount(game: Game): number {
  return wellPlacedSet(game.pieces).size;
}

export function contributions(game: Game): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of Object.values(game.players)) out[p.id] = p.piecesPlaced;
  return out;
}
