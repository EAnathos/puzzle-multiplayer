// Logique de puzzle côté serveur (source de vérité).
// Table libre : positions continues (en cases), chevauchements permis, table
// bornée. Au dépôt, un groupe proche d'une voisine compatible s'aimante puis se
// soude (tenon ↔ mortaise), même à la mauvaise place ; près de sa place dans
// le cadre central, il s'y aimante aussi.
// Le score ne compte que les pièces réellement bien placées.
// Bac partagé : une pièce peut être mise de côté (tray) hors du plateau.

import {
  DEFAULT_ASPECT,
  DIFFICULTIES,
  IMAGES,
  MAX_CUSTOM_IMAGE_BYTES,
  boardSize,
  clampAspect,
  edgesFit,
  frameOrigin,
  SNAP_DIST,
  clampGroupMove,
  isSolved,
  near,
  pieceEdges,
  tableBounds,
  wellPlacedSet,
  type Difficulty,
  type Game,
  type GameImage,
  type Piece,
} from "../../shared/types.ts";

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const r2 = (n: number) => Math.round(n * 100) / 100;

// Images importées : uniquement des data-URL d'image en base64 (pas d'URL
// externe qui ferait fuiter l'IP des joueurs, pas d'injection dans le CSS).
const CUSTOM_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export function isValidCustomImage(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length <= MAX_CUSTOM_IMAGE_BYTES * 1.4 && // base64 ≈ +33 %
    CUSTOM_IMAGE_RE.test(url)
  );
}

export function configureGame(
  game: Game,
  imageId: string,
  difficulty: Difficulty,
  customImage?: { url: string; label: string; aspect?: number }
): boolean {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) return false;
  const def = DIFFICULTIES[difficulty];

  let image: GameImage | undefined;
  if (imageId === "custom") {
    if (!customImage || !isValidCustomImage(customImage.url)) return false;
    image = {
      id: "custom",
      label: String(customImage.label || "Mon image").slice(0, 40),
      url: customImage.url,
      aspect: clampAspect(Number(customImage.aspect)),
    };
  } else {
    const found = IMAGES.find((i) => i.id === imageId);
    if (found) image = { ...found, aspect: found.aspect ?? DEFAULT_ASPECT };
  }
  if (!image) return false;

  const grid = { rows: def.rows, cols: def.cols };
  const board = boardSize(grid);
  const frame = frameOrigin(grid, board);

  // Les pièces démarrent éparpillées autour du cadre central (marge d'une
  // case), jamais dedans. Tirage en damier (parité) puis léger décalage
  // aléatoire : pas de rangées alignées, et deux pièces ne démarrent jamais
  // assez proches pour s'aimanter.
  const inFrame = (gx: number, gy: number) =>
    gx >= frame.gx - 1 &&
    gx <= frame.gx + grid.cols &&
    gy >= frame.gy - 1 &&
    gy <= frame.gy + grid.rows;
  const even: { gx: number; gy: number }[] = [];
  const odd: { gx: number; gy: number }[] = [];
  const inside: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < board.rows; gy++) {
    for (let gx = 0; gx < board.cols; gx++) {
      if (inFrame(gx, gy)) inside.push({ gx, gy });
      else ((gx + gy) % 2 === 0 ? even : odd).push({ gx, gy });
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
  shuffle(inside);
  // Repli (jamais atteint avec les plateaux actuels) : cases du cadre.
  const cells = [...even, ...odd, ...inside];

  const pieces: Piece[] = [];
  let g = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = cells[pieces.length];
      const jitter = () => r2((Math.random() - 0.5) * 0.36);
      pieces.push({
        id: `${row}-${col}`,
        row,
        col,
        gx: cell.gx + jitter(),
        gy: cell.gy + jitter(),
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

function nextGroupId(game: Game): number {
  return game.pieces.reduce((m, p) => Math.max(m, p.group), 0) + 1;
}

function edgeInDir(game: Game, p: Piece, dx: number, dy: number): number {
  const e = pieceEdges(p.row, p.col, game.grid!);
  if (dx === 1) return e.right;
  if (dx === -1) return e.left;
  if (dy === 1) return e.bottom;
  return e.top;
}

// q est-elle collée à p dans la direction (dx, dy) ?
const touches = (p: Piece, q: Piece, dx: number, dy: number) =>
  near(q.gx - p.gx, dx) && near(q.gy - p.gy, dy);

// Composantes connexes (pièces collées orthogonalement) parmi un groupe.
function connectedComponentsOf(game: Game, group: number): Piece[][] {
  const mem = members(game, group);
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
      for (const q of mem) {
        if (seen.has(q.id)) continue;
        if (DIRS.some(([dx, dy]) => touches(p, q, dx, dy))) {
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
  return {
    ok: true,
    group: piece.group,
    pieceIds: grabbed.map((p) => p.id),
    regroup,
  };
}

// Déplace le groupe tenu (ancre = pièce saisie). La position est bornée à la
// table ; renvoie la position effectivement appliquée.
export function moveGroup(
  game: Game,
  pieceId: string,
  gx: number,
  gy: number,
  playerId: string
): { ok: boolean; group?: number; gx?: number; gy?: number } {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.tray || piece.heldBy !== playerId || !game.board) return { ok: false };

  const grp = members(game, piece.group);
  const pos = clampGroupMove(grp, piece, gx, gy, game.board);
  const dx = r2(pos.gx) - piece.gx;
  const dy = r2(pos.gy) - piece.gy;
  if (dx === 0 && dy === 0) return { ok: false };
  for (const p of grp) {
    p.gx += dx;
    p.gy += dy;
  }
  return { ok: true, group: piece.group, gx: piece.gx, gy: piece.gy };
}

export interface DropResult {
  ok: boolean;
  settled?: Piece[];
  completed?: boolean;
}

// Aimantation : cherche le plus petit décalage qui colle une pièce du groupe à
// une voisine compatible (ou à sa place dans le cadre), sans poser une pièce
// exactement sur une autre.
function snapOffset(game: Game, group: number): { dx: number; dy: number } | null {
  const grp = members(game, group);
  const others = game.pieces.filter((p) => !p.tray && p.group !== group);
  const frame = frameOrigin(game.grid!, game.board!);
  const candidates: { dx: number; dy: number; d: number }[] = [];
  const consider = (dx: number, dy: number) => {
    if (Math.abs(dx) > SNAP_DIST || Math.abs(dy) > SNAP_DIST) return;
    candidates.push({ dx, dy, d: Math.hypot(dx, dy) });
  };

  for (const p of grp) {
    // Sa place dans le cadre central.
    consider(frame.gx + p.col - p.gx, frame.gy + p.row - p.gy);
    for (const q of others) {
      if (Math.abs(q.gx - p.gx) > 1.5 || Math.abs(q.gy - p.gy) > 1.5) continue;
      for (const [dx, dy] of DIRS) {
        if (!edgesFit(edgeInDir(game, p, dx, dy), edgeInDir(game, q, -dx, -dy))) continue;
        // p doit finir en (q - dir).
        consider(q.gx - dx - p.gx, q.gy - dy - p.gy);
      }
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    const overlaps = grp.some((p) =>
      others.some((q) => near(q.gx, p.gx + c.dx, 0.15) && near(q.gy, p.gy + c.dy, 0.15))
    );
    if (!overlaps) return c;
  }
  return null;
}

// Soudure « libre » : fusionne dans `base` les voisins collés dont les bords
// s'emboîtent.
function bond(game: Game, base: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    const grp = members(game, base);
    for (const q of game.pieces) {
      if (q.tray || q.group === base) continue;
      const fits = grp.some((p) =>
        DIRS.some(
          ([dx, dy]) =>
            touches(p, q, dx, dy) &&
            edgesFit(edgeInDir(game, p, dx, dy), edgeInDir(game, q, -dx, -dy))
        )
      );
      if (fits) {
        const target = q.group;
        for (const m of members(game, target)) m.group = base;
        changed = true;
      }
    }
  }
}

// Pose d'un groupe : aimantation, soudure, scores, fin de partie.
function settle(game: Game, base: number, playerId: string): DropResult {
  const snap = snapOffset(game, base);
  if (snap) {
    for (const p of members(game, base)) {
      p.gx = r2(p.gx + snap.dx);
      p.gy = r2(p.gy + snap.dy);
    }
  }
  bond(game, base);
  updateScores(game, playerId, base);

  const completed = isSolved(game.pieces);
  if (completed && !game.completedAt) game.completedAt = Date.now();
  return { ok: true, settled: members(game, base), completed };
}

export function dropGroup(game: Game, pieceId: string, playerId: string): DropResult {
  const piece = findPiece(game, pieceId);
  if (!piece || piece.heldBy !== playerId) return { ok: false };
  const base = piece.group;
  for (const p of members(game, base)) p.heldBy = null;
  return settle(game, base, playerId);
}

// Met une pièce de côté dans le bac partagé (la détache, la retire de la table).
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

// Repose une pièce du bac à l'endroit visé (borné à la table), puis la pose.
export function untrayPiece(
  game: Game,
  pieceId: string,
  gx: number,
  gy: number,
  playerId: string
): DropResult {
  const piece = findPiece(game, pieceId);
  if (!piece || !piece.tray || !game.board) return { ok: false };
  const b = tableBounds(game.board);
  piece.tray = false;
  piece.trayOrder = 0;
  piece.gx = r2(Math.min(b.maxX, Math.max(b.minX, gx)));
  piece.gy = r2(Math.min(b.maxY, Math.max(b.minY, gy)));
  piece.group = nextGroupId(game);
  piece.heldBy = null;
  return settle(game, piece.group, playerId);
}

// Repose une pièce du bac au hasard *à l'écart* : hors du cadre central et
// loin des autres pièces, pour qu'elle revienne détachée sur la table.
export function untrayPieceRandom(game: Game, pieceId: string, playerId: string): DropResult {
  const piece = findPiece(game, pieceId);
  if (!piece || !piece.tray || !game.board || !game.grid) return { ok: false };

  const board = game.board;
  const frame = frameOrigin(game.grid, board);
  const onTable = game.pieces.filter((p) => !p.tray);
  const inFrame = (x: number, y: number) =>
    x > frame.gx - 1.5 &&
    x < frame.gx + game.grid!.cols + 0.5 &&
    y > frame.gy - 1.5 &&
    y < frame.gy + game.grid!.rows + 0.5;
  let best = { gx: 0, gy: 0, d: -1 };
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * (board.cols - 1);
    const y = Math.random() * (board.rows - 1);
    if (inFrame(x, y)) continue;
    let d = Infinity;
    for (const q of onTable) d = Math.min(d, Math.max(Math.abs(q.gx - x), Math.abs(q.gy - y)));
    if (d > best.d) best = { gx: x, gy: y, d };
    if (d > 1.6) break; // assez dégagé
  }
  return untrayPiece(game, pieceId, best.gx, best.gy, playerId);
}

// Recalcule les pièces bien placées. On ne crédite que celles que ce joueur
// vient de placer : le groupe posé et ses vraies voisines.
export function updateScores(game: Game, playerId: string, group: number): void {
  const well = wellPlacedSet(game.pieces);
  const affected = new Set<string>();
  for (const p of members(game, group)) {
    affected.add(p.id);
    for (const [dx, dy] of DIRS) affected.add(`${p.row + dy}-${p.col + dx}`);
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
