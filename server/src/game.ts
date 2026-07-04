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

// Position du groupe au moment de la saisie (pour revenir en arrière si le dépôt
// crée une adjacence incompatible). Clé : `${gameId}:${playerId}`.
const grabSnapshots = new Map<string, { id: string; gx: number; gy: number }[]>();
const snapKey = (game: Game, playerId: string) => `${game.id}:${playerId}`;

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

  // Cases en damier (parité) d'abord : deux pièces ne démarrent jamais
  // orthogonalement adjacentes → aucune adjacence incompatible au départ.
  const even: { gx: number; gy: number }[] = [];
  const odd: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < board.rows; gy++) {
    for (let gx = 0; gx < board.cols; gx++) {
      ((gx + gy) % 2 === 0 ? even : odd).push({ gx, gy });
    }
  }
  const shuffle = (a: { gx: number; gy: number }[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  };
  shuffle(even);
  shuffle(odd);
  const cells = [...even, ...odd];

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

// Composantes connexes (adjacence orthogonale) parmi les pièces d'un groupe.
function connectedComponentsOf(game: Game, group: number): Piece[][] {
  const mem = members(game, group);
  const occ = new Map<string, Piece>();
  for (const p of mem) occ.set(key(p.gx, p.gy), p);
  const seen = new Set<string>();
  const comps: Piece[][] = [];
  for (const start of mem) {
    if (seen.has(start.id)) continue;
    const comp: Piece[] = [];
    const stack = [start];
    seen.add(start.id);
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      for (const [dx, dy] of DIRS) {
        const q = occ.get(key(p.gx + dx, p.gy + dy));
        if (q && !seen.has(q.id)) {
          seen.add(q.id);
          stack.push(q);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

// Après retrait d'une pièce, un groupe peut se retrouver en plusieurs morceaux
// physiquement séparés : on rend à chaque morceau son propre id. La 1re
// composante garde l'id d'origine. Renvoie les pièces dont le groupe a changé.
function splitGroup(game: Game, group: number): { id: string; group: number }[] {
  const comps = connectedComponentsOf(game, group);
  const changes: { id: string; group: number }[] = [];
  for (let i = 1; i < comps.length; i++) {
    const ng = nextGroupId(game);
    for (const p of comps[i]) {
      p.group = ng;
      changes.push({ id: p.id, group: ng });
    }
  }
  return changes;
}

function nextTrayOrder(game: Game): number {
  return game.pieces.reduce((m, p) => Math.max(m, p.trayOrder), 0) + 1;
}

export function grabGroup(
  game: Game,
  pieceId: string,
  playerId: string,
  single: boolean
): {
  ok: boolean;
  error?: string;
  group?: number;
  pieceIds?: string[];
  regroup?: { id: string; group: number }[];
} {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.tray) return { ok: false, error: "piece_not_found" };
  if (piece.heldBy && piece.heldBy !== playerId) {
    return { ok: false, error: "locked" };
  }

  const oldGroup = piece.group;
  let grabbed: Piece[];
  let regroup: { id: string; group: number }[] = [];
  if (single && members(game, oldGroup).length > 1) {
    piece.group = nextGroupId(game);
    grabbed = [piece];
    regroup = splitGroup(game, oldGroup); // le reste peut se scinder en morceaux
  } else {
    grabbed = members(game, oldGroup);
  }
  for (const p of grabbed) p.heldBy = playerId;
  grabSnapshots.set(
    snapKey(game, playerId),
    grabbed.map((p) => ({ id: p.id, gx: p.gx, gy: p.gy }))
  );
  return {
    ok: true,
    group: piece.group,
    pieceIds: grabbed.map((p) => p.id),
    regroup,
  };
}

// Toutes les adjacences du groupe sont-elles compatibles (tenon ↔ mortaise) ?
function groupFits(game: Game, group: number): boolean {
  const occ = occupancy(game);
  for (const p of members(game, group)) {
    for (const [dx, dy] of DIRS) {
      const q = occ.get(key(p.gx + dx, p.gy + dy));
      if (!q || q.group === group) continue;
      if (!edgesFit(edgeInDir(game, p, dx, dy), edgeInDir(game, q, -dx, -dy))) {
        return false;
      }
    }
  }
  return true;
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
  rejected?: boolean; // adjacence incompatible → remis à sa place
  rejectedIds?: string[];
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

  const snap = grabSnapshots.get(snapKey(game, playerId));
  grabSnapshots.delete(snapKey(game, playerId));

  // Dépôt refusé si une pièce touche un voisin dont les bords ne s'emboîtent
  // pas : on remet le groupe à sa position d'avant la saisie.
  let rejected = false;
  if (!groupFits(game, base)) {
    rejected = true;
    if (snap) {
      const byId = new Map(snap.map((s) => [s.id, s]));
      for (const p of members(game, base)) {
        const s = byId.get(p.id);
        if (s) {
          p.gx = s.gx;
          p.gy = s.gy;
        }
      }
    }
  }

  bond(game, base);
  updateScores(game, playerId, base);

  const completed = !rejected && isSolved(game.pieces);
  if (completed && !game.completedAt) game.completedAt = Date.now();

  return {
    ok: true,
    settled: members(game, base),
    completed,
    rejected,
    rejectedIds: rejected ? snap?.map((s) => s.id) ?? [pieceId] : undefined,
  };
}

// Met une pièce de côté dans le bac partagé (la détache, la retire du plateau).
export function trayPiece(
  game: Game,
  pieceId: string,
  playerId: string
): { ok: boolean; order?: number; regroup?: { id: string; group: number }[] } {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.tray) return { ok: false };
  if (piece.heldBy && piece.heldBy !== playerId) return { ok: false };

  const oldGroup = piece.group;
  piece.group = nextGroupId(game);
  piece.heldBy = null;
  piece.tray = true;
  piece.trayOrder = nextTrayOrder(game);
  const regroup = splitGroup(game, oldGroup); // le bloc restant peut se scinder

  retally(game); // une voisine a pu perdre sa correction
  return { ok: true, order: piece.trayOrder, regroup };
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
    return { ok: false, rejected: true };
  }
  const occ = occupancy(game);
  if (occ.get(key(gx, gy))) return { ok: false, rejected: true };
  // Refuse si un voisin a un bord incompatible.
  for (const [dx, dy] of DIRS) {
    const q = occ.get(key(gx + dx, gy + dy));
    if (q && !edgesFit(edgeInDir(game, piece, dx, dy), edgeInDir(game, q, -dx, -dy))) {
      return { ok: false, rejected: true };
    }
  }

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
  grabSnapshots.delete(snapKey(game, playerId));
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
