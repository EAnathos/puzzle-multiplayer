// Types et constantes partagés entre le client et le serveur.
// Modèle « grille » : chaque pièce occupe une case entière (déplacements de case
// en case, une pièce par case). Deux pièces voisines se soudent si leurs bords
// (tenon/mortaise) sont compatibles — même si ce n'est pas la bonne voisine.
// Le score ne compte que les pièces réellement bien placées.

export type Difficulty = "easy" | "medium" | "hard";
export type GameStatus = "lobby" | "playing" | "completed";

export interface Piece {
  id: string; // `${row}-${col}`
  row: number; // ligne correcte dans le puzzle
  col: number; // colonne correcte
  gx: number; // case courante (colonne)
  gy: number; // case courante (ligne)
  group: number; // groupe soudé (déplacé d'un bloc)
  heldBy: string | null; // joueur qui tient le groupe
  placedBy: string | null; // joueur qui l'a correctement placée (score)
}

export interface Player {
  id: string;
  pseudo: string;
  color: string;
  cursor: { x: number; y: number };
  connected: boolean;
  piecesPlaced: number; // pièces correctement placées par ce joueur
}

export interface GameImage {
  id: string;
  label: string;
  url: string;
}

export interface Grid {
  rows: number;
  cols: number;
}

export interface Game {
  id: string;
  status: GameStatus;
  image: GameImage | null;
  difficulty: Difficulty | null;
  grid: Grid | null; // dimensions du puzzle
  board: Grid | null; // dimensions du plateau
  pieces: Piece[];
  players: Record<string, Player>;
  hostId: string;
  createdAt: number;
  completedAt: number | null;
}

export const DIFFICULTIES: Record<
  Difficulty,
  { rows: number; cols: number; label: string }
> = {
  easy: { rows: 5, cols: 5, label: "Facile" },
  medium: { rows: 10, cols: 10, label: "Moyen" },
  hard: { rows: 20, cols: 20, label: "Difficile" },
};

export const IMAGES: GameImage[] = [
  { id: "sunset", label: "Coucher de soleil", url: "/images/sunset.svg" },
  { id: "ocean", label: "Vagues", url: "/images/ocean.svg" },
  { id: "bloom", label: "Fleurs", url: "/images/bloom.svg" },
];

export const PLAYER_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#eab308",
];

export function cellSize(grid: Grid): { w: number; h: number } {
  return {
    w: Math.max(34, Math.round(560 / grid.cols)),
    h: Math.max(26, Math.round(420 / grid.rows)),
  };
}

export function boardSize(grid: Grid): Grid {
  return {
    cols: Math.round(grid.cols * 1.8) + 2,
    rows: Math.round(grid.rows * 1.8) + 2,
  };
}

// --- Bords des pièces (tenon = +1, mortaise = -1, plat = 0) ---
// Déterministe : les mêmes formes partout, bords voisins complémentaires.

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function edgeSign(a: number, b: number): 1 | -1 {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h) < 0.5 ? 1 : -1;
}

export function pieceEdges(row: number, col: number, grid: Grid): Edges {
  const vertical = (r: number, c: number) => edgeSign(r * 2 + 1, c * 3 + 7);
  const horizontal = (r: number, c: number) => edgeSign(r * 3 + 5, c * 2 + 2);
  return {
    top: row > 0 ? -horizontal(row - 1, col) : 0,
    bottom: row < grid.rows - 1 ? horizontal(row, col) : 0,
    left: col > 0 ? -vertical(row, col - 1) : 0,
    right: col < grid.cols - 1 ? vertical(row, col) : 0,
  };
}

// Deux bords opposés s'emboîtent si un tenon rencontre une mortaise (ou deux
// bords plats). a et b sont les signes des deux bords en contact.
export function edgesFit(a: number, b: number): boolean {
  return a + b === 0;
}

const cellKey = (x: number, y: number) => `${x},${y}`;

// Pièces réellement bien placées : au moins une vraie voisine à la bonne
// position relative (peu importe le groupe / les soudures « libres »).
export function wellPlacedSet(pieces: Piece[]): Set<string> {
  const occ = new Map<string, Piece>();
  for (const p of pieces) occ.set(cellKey(p.gx, p.gy), p);
  const set = new Set<string>();
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const p of pieces) {
    for (const [dcol, drow] of dirs) {
      const q = occ.get(cellKey(p.gx + dcol, p.gy + drow));
      if (q && q.row === p.row + drow && q.col === p.col + dcol) {
        set.add(p.id);
        break;
      }
    }
  }
  return set;
}

// Puzzle terminé : toutes les pièces au bon décalage relatif (image correcte).
export function isSolved(pieces: Piece[]): boolean {
  if (!pieces.length) return false;
  const ref = pieces[0];
  return pieces.every(
    (p) =>
      p.gx - ref.gx === p.col - ref.col && p.gy - ref.gy === p.row - ref.row
  );
}

// --- Protocole temps réel ---

export interface ServerToClientEvents {
  "game:state": (game: Game) => void;
  "player:joined": (player: Player) => void;
  "player:left": (data: { playerId: string }) => void;
  "player:update": (player: Player) => void;
  "host:changed": (data: { hostId: string }) => void;
  "cursor:update": (data: { playerId: string; x: number; y: number }) => void;
  "piece:grabbed": (data: {
    group: number;
    playerId: string;
    pieceIds: string[];
  }) => void;
  "group:moved": (data: {
    group: number;
    anchorId: string;
    gx: number;
    gy: number;
  }) => void;
  "group:settled": (data: {
    pieces: { id: string; gx: number; gy: number; group: number }[];
    playerId: string;
  }) => void;
  "piece:unlocked": (data: { pieceIds: string[] }) => void;
  "game:progress": (data: { placed: number; total: number }) => void;
  "game:completed": (data: {
    completedAt: number;
    durationMs: number;
    contributions: Record<string, number>;
  }) => void;
}

export interface ClientToServerEvents {
  "game:create": (
    data: { pseudo: string },
    ack: (res: { ok: true; gameId: string } | { ok: false; error: string }) => void
  ) => void;
  "game:join": (
    data: { gameId: string; pseudo: string },
    ack: (res: { ok: true; game: Game } | { ok: false; error: string }) => void
  ) => void;
  "game:configure": (data: { imageId: string; difficulty: Difficulty }) => void;
  "cursor:move": (data: { x: number; y: number }) => void;
  "piece:grab": (
    data: { pieceId: string; single: boolean },
    ack: (res: { ok: boolean; error?: string; group?: number }) => void
  ) => void;
  "group:move": (data: { pieceId: string; gx: number; gy: number }) => void;
  "piece:drop": (data: { pieceId: string }) => void;
}
