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
  tray: boolean; // mise de côté dans le bac partagé (hors plateau)
  trayOrder: number; // ordre d'affichage dans le bac
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
  aspect?: number; // largeur / hauteur de l'image (4/3 par défaut)
}

// Ratio des images fournies (600×450) et ratio par défaut.
export const DEFAULT_ASPECT = 4 / 3;
// Au-delà, les pièces deviendraient trop allongées : on recadre (cover).
export const MIN_ASPECT = 0.5;
export const MAX_ASPECT = 2;
// Taille max d'une image importée (data-URL) acceptée par le serveur.
export const MAX_CUSTOM_IMAGE_BYTES = 8 * 1024 * 1024;

export function clampAspect(aspect: number | undefined): number {
  if (!aspect || !Number.isFinite(aspect)) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect));
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
  { id: "forest", label: "Forêt", url: "/images/forest.svg" },
  { id: "mountains", label: "Montagnes", url: "/images/mountains.svg" },
  { id: "city", label: "Ville la nuit", url: "/images/city.svg" },
  { id: "desert", label: "Désert", url: "/images/desert.svg" },
  { id: "galaxy", label: "Galaxie", url: "/images/galaxy.svg" },
  { id: "aurora", label: "Aurore boréale", url: "/images/aurora.svg" },
  { id: "balloons", label: "Montgolfières", url: "/images/balloons.svg" },
  { id: "reef", label: "Récif corallien", url: "/images/reef.svg" },
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

// Taille d'une case : le puzzle complet garde le ratio de l'image (surface
// ~560×420 px), avec un minimum de 26 px sur le plus petit côté.
export function cellSize(grid: Grid, aspect?: number): { w: number; h: number } {
  const a = clampAspect(aspect);
  const W = Math.sqrt(560 * 420 * a);
  const H = W / a;
  let w = W / grid.cols;
  let h = H / grid.rows;
  const min = Math.min(w, h);
  if (min < 26) {
    w *= 26 / min;
    h *= 26 / min;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

export function boardSize(grid: Grid): Grid {
  return {
    cols: Math.round(grid.cols * 1.8) + 2,
    rows: Math.round(grid.rows * 1.8) + 2,
  };
}

// Cadre du puzzle : zone centrale du plateau, de la taille exacte du puzzle.
// Les pièces démarrent autour, jamais dedans.
export function frameOrigin(grid: Grid, board: Grid): { gx: number; gy: number } {
  return {
    gx: Math.floor((board.cols - grid.cols) / 2),
    gy: Math.floor((board.rows - grid.rows) / 2),
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
  const board = pieces.filter((p) => !p.tray); // les pièces au bac ne comptent pas
  const occ = new Map<string, Piece>();
  for (const p of board) occ.set(cellKey(p.gx, p.gy), p);
  const set = new Set<string>();
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const p of board) {
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

// Puzzle terminé : toutes les pièces sur le plateau, au bon décalage relatif.
export function isSolved(pieces: Piece[]): boolean {
  if (!pieces.length) return false;
  if (pieces.some((p) => p.tray)) return false;
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
    regroup: { id: string; group: number }[];
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
  "piece:reject": (data: { pieceIds: string[] }) => void;
  "piece:trayed": (data: {
    pieceId: string;
    order: number;
    regroup: { id: string; group: number }[];
  }) => void;
  "piece:untrayed": (data: {
    pieces: { id: string; gx: number; gy: number; group: number }[];
    pieceId: string;
  }) => void;
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
  // Vérifie qu'une partie existe (lien d'invitation, saisie du code).
  "game:exists": (
    data: { gameId: string },
    ack: (res: { exists: boolean; players?: number; status?: GameStatus }) => void
  ) => void;
  "game:join": (
    data: { gameId: string; pseudo: string },
    ack: (res: { ok: true; game: Game } | { ok: false; error: string }) => void
  ) => void;
  "game:configure": (data: {
    imageId: string;
    difficulty: Difficulty;
    customImage?: { url: string; label: string; aspect?: number };
  }) => void;
  "cursor:move": (data: { x: number; y: number }) => void;
  "piece:grab": (
    data: { pieceId: string; single: boolean },
    ack: (res: { ok: boolean; error?: string; group?: number }) => void
  ) => void;
  "group:move": (data: { pieceId: string; gx: number; gy: number }) => void;
  "piece:drop": (data: { pieceId: string }) => void;
  "piece:tray": (data: { pieceId: string }) => void;
  "piece:untray": (data: { pieceId: string; gx: number; gy: number }) => void;
  // Repose une pièce du bac sur une case libre aléatoire (rules-compatible).
  "piece:untray-random": (data: { pieceId: string }) => void;
}
