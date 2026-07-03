// État en mémoire des parties, indexé par code de partie.
// Pas de base de données : tout vit ici (voir docs/ARCHITECTURE.md).

import { PLAYER_COLORS, type Game, type Player } from "../../shared/types.ts";

const games = new Map<string, Game>();

// Durée de vie d'une partie sans aucun joueur connecté avant nettoyage.
const EMPTY_TTL_MS = 10 * 60 * 1000;
const emptySince = new Map<string, number>();

// Codes lisibles, sans caractères ambigus (0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(length = 4): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function createGame(hostId: string): Game {
  let id = makeCode();
  while (games.has(id)) id = makeCode();

  const game: Game = {
    id,
    status: "lobby",
    image: null,
    difficulty: null,
    grid: null,
    board: null,
    pieces: [],
    players: {},
    hostId,
    createdAt: Date.now(),
    completedAt: null,
  };
  games.set(id, game);
  return game;
}

export function getGame(id: string): Game | undefined {
  return games.get(id.toUpperCase());
}

// Attribue la première couleur libre de la palette.
export function pickColor(game: Game): string {
  const used = new Set(Object.values(game.players).map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
}

export function addPlayer(game: Game, id: string, pseudo: string): Player {
  const player: Player = {
    id,
    pseudo: pseudo.trim().slice(0, 20) || "Joueur",
    color: pickColor(game),
    cursor: { x: 0, y: 0 },
    connected: true,
    piecesPlaced: 0,
  };
  game.players[id] = player;
  emptySince.delete(game.id);
  return player;
}

export function removePlayer(game: Game, id: string): void {
  delete game.players[id];
  if (Object.keys(game.players).length === 0) {
    emptySince.set(game.id, Date.now());
  }
}

// Réassigne l'hôte si celui qui part était l'hôte. Renvoie le nouvel hôte.
export function ensureHost(game: Game): string | null {
  if (game.players[game.hostId]) return null;
  const next = Object.keys(game.players)[0];
  if (!next) return null;
  game.hostId = next;
  return next;
}

// Nettoyage périodique des parties vides depuis trop longtemps.
export function startCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, since] of emptySince) {
      if (now - since > EMPTY_TTL_MS) {
        games.delete(id);
        emptySince.delete(id);
      }
    }
  }, 60 * 1000).unref();
}
