// Logique de puzzle côté serveur (source de vérité).
// Cases entières, une pièce par case. Soudure « libre » : deux pièces se collent
// si leurs bords s'emboîtent (tenon ↔ mortaise), même à la mauvaise place.
// Le score ne compte que les pièces réellement bien placées.

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
  type Piece,
} from "../../shared/types.ts";

const key = (gx: number, gy: number) => `${gx},${gy}`;

export function configureGame(
  game: Game,
  imageId: string,
  difficulty: Difficulty
): boolean {
  const image = IMAGES.find((i) => i.id === imageId);
  const def = DIFFICULTIES[difficulty];
  if (!image || !def) return false;

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

function occupancy(game: Game): Map<string, Piece> {
  const map = new Map<string, Piece>();
  for (const p of game.pieces) map.set(key(p.gx, p.gy), p);
  return map;
}

function nextGroupId(game: Game): number {
  return game.pieces.reduce((m, p) => Math.max(m, p.group), 0) + 1;
}

// Attrape une pièce. single = extraire cette seule pièce du bloc ; sinon tout
// le bloc. Renvoie le groupe tenu et ses pièces.
export function grabGroup(
  game: Game,
  pieceId: string,
  playerId: string,
  single: boolean
): { ok: boolean; error?: string; group?: number; pieceIds?: string[] } {
  const piece = findPiece(game, pieceId);
  if (!piece) return { ok: false, error: "piece_not_found" };
  if (piece.heldBy && piece.heldBy !== playerId) {
    return { ok: false, error: "locked" };
  }

  if (single && members(game, piece.group).length > 1) {
    // Détache la pièce dans un nouveau groupe.
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

// Bord de p face à un voisin situé dans la direction (dx, dy) du plateau.
function edgeInDir(game: Game, p: Piece, dx: number, dy: number): number {
  const e = pieceEdges(p.row, p.col, game.grid!);
  if (dx === 1) return e.right;
  if (dx === -1) return e.left;
  if (dy === 1) return e.bottom;
  return e.top;
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

  // Soudure « libre » : fusionne les voisins dont les bords s'emboîtent.
  let changed = true;
  while (changed) {
    changed = false;
    const occ = occupancy(game);
    for (const p of members(game, base)) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
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

  updateScores(game, playerId, base);

  const completed = isSolved(game.pieces);
  if (completed && !game.completedAt) game.completedAt = Date.now();

  return { ok: true, settled: members(game, base), completed };
}

// Recalcule les pièces bien placées. On ne crédite que celles que ce joueur
// vient de placer : le groupe posé et ses voisines directes (pas les pièces
// qui se trouvaient déjà bien placées ailleurs).
export function updateScores(game: Game, playerId: string, group: number): void {
  const well = wellPlacedSet(game.pieces);
  const occ = occupancy(game);
  const affected = new Set<string>();
  for (const p of members(game, group)) {
    affected.add(p.id);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const q = occ.get(key(p.gx + dx, p.gy + dy));
      if (q) affected.add(q.id);
    }
  }
  for (const p of game.pieces) {
    if (!well.has(p.id)) p.placedBy = null; // séparée → n'est plus créditée
    else if (affected.has(p.id) && !p.placedBy) p.placedBy = playerId;
  }
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
