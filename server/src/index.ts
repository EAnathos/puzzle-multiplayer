// Serveur : sert le client (build Vite) et héberge le temps réel Socket.IO.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request } from "express";
import { Server } from "socket.io";
import {
  DIFFICULTIES,
  MAX_CUSTOM_IMAGE_BYTES,
  wellPlacedSet,
  type ClientToServerEvents,
  type Game,
  type ServerToClientEvents,
} from "../../shared/types.ts";
import {
  configureGame,
  contributions,
  dropGroup,
  grabGroup,
  moveGroup,
  placedCount,
  releaseHeldBy,
  trayPiece,
  untrayPiece,
  untrayPieceRandom,
  type DropResult,
} from "./game.ts";
import {
  addPlayer,
  createGame,
  ensureHost,
  getGame,
  removePlayer,
  startCleanup,
} from "./store.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "../../client/dist");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  // Les images importées (GIF animés compris) transitent en data-URL.
  maxHttpBufferSize: Math.ceil(MAX_CUSTOM_IMAGE_BYTES * 1.4) + 64 * 1024,
});

// Derrière un reverse proxy (nginx) : protocole et hôte d'origine.
app.set("trust proxy", true);
// `index: false` : la page d'accueil passe par la route ci-dessous (balises OG).
app.use(express.static(clientDist, { index: false }));

// --- Aperçu des liens (Discord, WhatsApp, Slack…) ---
// Ces robots n'exécutent pas le JS : on injecte des balises Open Graph dans
// index.html, propres à la partie quand le lien porte un code.

let indexHtml: string | null = null;
function loadIndex(): string | null {
  if (indexHtml === null) {
    try {
      indexHtml = readFileSync(join(clientDist, "index.html"), "utf8");
    } catch {
      return null; // client pas encore buildé
    }
  }
  return indexHtml;
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function publicOrigin(req: Request): string {
  return process.env.PUBLIC_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
}

function ogTags(req: Request): string {
  const origin = publicOrigin(req);
  const code = typeof req.query.code === "string" ? req.query.code.toUpperCase().slice(0, 8) : "";
  const game = code ? getGame(code) : undefined;

  let title = "Puzzle Multiplayer";
  let description = "Assemblez un puzzle à plusieurs, en temps réel. Crée une partie et invite tes amis !";
  let image = `${origin}/og/default.png`;
  let url = `${origin}/`;

  if (game) {
    const n = Object.keys(game.players).length;
    const players = `${n} joueur${n > 1 ? "s" : ""}`;
    url = `${origin}/?code=${game.id}`;
    title = `🧩 Rejoins la partie ${game.id}`;
    if (game.status === "lobby" || !game.image || !game.difficulty) {
      description = `Partie en préparation · ${players}. Clique pour rejoindre !`;
    } else {
      const total = game.pieces.length;
      const pct = total ? Math.round((wellPlacedSet(game.pieces).size / total) * 100) : 0;
      const state = game.status === "completed" ? "terminé" : `${pct} % assemblé`;
      description = `Puzzle « ${game.image.label} » · ${total} pièces · ${state} · ${players}.`;
      // L'empreinte change avec l'image : Discord garde ses aperçus en cache.
      image = `${origin}/og-image/${game.id}?v=${game.createdAt}-${game.image.id}`;
    }
  }

  const meta = (k: string, v: string, attr = "property") =>
    `<meta ${attr}="${k}" content="${esc(v)}" />`;
  return [
    meta("description", description, "name"),
    meta("og:site_name", "Puzzle Multiplayer"),
    meta("og:type", "website"),
    meta("og:locale", "fr_FR"),
    meta("og:title", title),
    meta("og:description", description),
    meta("og:url", url),
    meta("og:image", image),
    meta("twitter:card", "summary_large_image", "name"),
    meta("twitter:title", title, "name"),
    meta("twitter:description", description, "name"),
    meta("twitter:image", image, "name"),
  ].join("\n    ");
}

// Image de la partie : image importée (décodée de sa data-URL, GIF compris)
// ou aperçu JPEG de l'image fournie (les robots n'affichent pas le SVG).
app.get("/og-image/:code", (req, res) => {
  const game = getGame(String(req.params.code).slice(0, 8));
  const img = game?.image;
  res.set("Cache-Control", "public, max-age=300");
  if (!img) return res.sendFile(join(clientDist, "og/default.png"));
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(img.url);
  if (m) return res.type(m[1]).send(Buffer.from(m[2], "base64"));
  res.sendFile(join(clientDist, `og/${img.id}.jpg`), (err) => {
    if (err && !res.headersSent) res.sendFile(join(clientDist, "og/default.png"));
  });
});

app.get("*", (req, res) => {
  const html = loadIndex();
  if (!html) return res.status(503).send("Client non buildé (npm run build).");
  res.set("Cache-Control", "no-cache");
  res.type("html").send(html.replace("<!--og-->", ogTags(req)));
});

interface SocketData {
  gameId?: string;
  playerId?: string;
}

// Un message malformé ne doit jamais faire tomber le serveur (et toutes les
// parties en mémoire avec lui) : chaque gestionnaire est protégé.
function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      console.error("socket handler error:", err);
    }
  };
}

const str = (v: unknown, max = 64): string =>
  typeof v === "string" ? v.slice(0, max) : "";
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const fn = <F>(v: F): F | null => (typeof v === "function" ? v : null);

io.on("connection", (socket) => {
  const data = socket.data as SocketData;
  const currentGame = () => (data.gameId ? getGame(data.gameId) : undefined);

  // Quitte proprement la partie courante (déconnexion ou changement de partie).
  function leaveCurrent() {
    const game = currentGame();
    data.gameId = undefined;
    data.playerId = undefined;
    if (!game) return;
    socket.leave(game.id);

    const released = releaseHeldBy(game, socket.id);
    if (released.length) {
      socket
        .to(game.id)
        .emit("piece:unlocked", { pieceIds: released.map((p) => p.id) });
    }

    removePlayer(game, socket.id);
    socket.to(game.id).emit("player:left", { playerId: socket.id });

    const newHost = ensureHost(game);
    if (newHost) io.to(game.id).emit("host:changed", { hostId: newHost });
  }

  socket.on("game:exists", safe((payload, ack) => {
    const reply = fn(ack);
    if (!reply) return;
    const game = getGame(str(payload?.gameId, 8));
    if (!game) return reply({ exists: false });
    reply({
      exists: true,
      players: Object.keys(game.players).length,
      status: game.status,
    });
  }));

  socket.on("game:create", safe((payload, ack) => {
    const reply = fn(ack);
    if (!reply) return;
    leaveCurrent();
    const game = createGame(socket.id);
    const player = addPlayer(game, socket.id, str(payload?.pseudo));
    data.gameId = game.id;
    data.playerId = player.id;
    socket.join(game.id);
    reply({ ok: true, gameId: game.id });
    socket.emit("game:state", game);
  }));

  socket.on("game:join", safe((payload, ack) => {
    const reply = fn(ack);
    if (!reply) return;
    const game = getGame(str(payload?.gameId, 8).trim());
    if (!game) return reply({ ok: false, error: "game_not_found" });
    if (data.gameId !== game.id) leaveCurrent();

    const player = addPlayer(game, socket.id, str(payload?.pseudo));
    data.gameId = game.id;
    data.playerId = player.id;
    socket.join(game.id);
    // Partie qui s'était vidée : l'ancien hôte n'existe plus, l'arrivant le devient.
    ensureHost(game);

    reply({ ok: true, game });
    // L'arrivant reçoit l'état complet → lobby ou partie en cours selon le statut.
    socket.emit("game:state", game);
    socket.to(game.id).emit("player:joined", player);
  }));

  socket.on("game:configure", safe((payload) => {
    const game = currentGame();
    if (!game || game.hostId !== socket.id || !payload) return;
    const difficulty = payload.difficulty;
    if (typeof difficulty !== "string" || !Object.hasOwn(DIFFICULTIES, difficulty)) return;
    if (configureGame(game, str(payload.imageId), difficulty, payload.customImage)) {
      io.to(game.id).emit("game:state", game);
    }
  }));

  socket.on("cursor:move", safe((payload) => {
    const game = currentGame();
    const player = game?.players[socket.id];
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (!game || !player || !Number.isFinite(x) || !Number.isFinite(y)) return;
    player.cursor = { x, y };
    socket.to(game.id).emit("cursor:update", { playerId: socket.id, x, y });
  }));

  socket.on("piece:grab", safe((payload, ack) => {
    const reply = fn(ack);
    if (!reply) return;
    const game = currentGame();
    if (!game) return reply({ ok: false, error: "game_not_found" });
    const res = grabGroup(game, str(payload?.pieceId, 16), socket.id, payload?.single === true);
    // Le regroupement est diffusé avant l'accusé : quand le client commence à
    // déplacer, son état connaît déjà le nouveau groupe.
    if (res.ok && res.group !== undefined && res.pieceIds) {
      io.to(game.id).emit("piece:grabbed", {
        group: res.group,
        playerId: socket.id,
        pieceIds: res.pieceIds,
        regroup: res.regroup ?? [],
      });
    }
    reply({ ok: res.ok, error: res.error, group: res.group });
  }));

  socket.on("group:move", safe((payload) => {
    const game = currentGame();
    const pieceId = str(payload?.pieceId, 16);
    const gx = num(payload?.gx);
    const gy = num(payload?.gy);
    if (!game || gx === null || gy === null) return;
    const res = moveGroup(game, pieceId, gx, gy, socket.id);
    // L'émetteur applique déjà le déplacement localement : seuls les autres
    // reçoivent l'écho (pas de retour en arrière dû à la latence).
    if (res.ok && res.group !== undefined && res.gx !== undefined && res.gy !== undefined) {
      socket.to(game.id).emit("group:moved", {
        group: res.group,
        anchorId: pieceId,
        gx: res.gx,
        gy: res.gy,
      });
    }
  }));

  // Progression commune + scores de chaque joueur.
  function broadcastScores(game: Game) {
    io.to(game.id).emit("game:progress", {
      placed: placedCount(game),
      total: game.pieces.length,
    });
    for (const player of Object.values(game.players)) {
      io.to(game.id).emit("player:update", player);
    }
  }

  function broadcastCompletion(game: Game, completed: boolean | undefined) {
    if (!completed || !game.completedAt || game.status === "completed") return;
    game.status = "completed";
    io.to(game.id).emit("game:completed", {
      completedAt: game.completedAt,
      durationMs: game.completedAt - game.createdAt,
      contributions: contributions(game),
    });
  }

  socket.on("piece:drop", safe((payload) => {
    const game = currentGame();
    if (!game) return;
    const res = dropGroup(game, str(payload?.pieceId, 16), socket.id);
    if (!res.ok || !res.settled) return;

    io.to(game.id).emit("group:settled", {
      pieces: res.settled.map((p) => ({ id: p.id, gx: p.gx, gy: p.gy, group: p.group })),
      playerId: socket.id,
    });
    // Les scores (pièces bien placées) ont pu changer pour tout le monde.
    broadcastScores(game);
    broadcastCompletion(game, res.completed);
  }));

  socket.on("piece:tray", safe((payload) => {
    const game = currentGame();
    if (!game) return;
    const pieceId = str(payload?.pieceId, 16);
    const res = trayPiece(game, pieceId, socket.id);
    if (!res.ok || res.order === undefined) return;
    io.to(game.id).emit("piece:trayed", {
      pieceId,
      order: res.order,
      regroup: res.regroup ?? [],
    });
    broadcastScores(game);
  }));

  // Diffuse le résultat d'un dépôt depuis le bac (manuel ou aléatoire).
  function settleUntray(game: Game, res: DropResult, pieceId: string) {
    if (!res.ok || !res.settled) return;
    io.to(game.id).emit("piece:untrayed", {
      pieces: res.settled.map((p) => ({ id: p.id, gx: p.gx, gy: p.gy, group: p.group })),
      pieceId,
    });
    broadcastScores(game);
    broadcastCompletion(game, res.completed);
  }

  socket.on("piece:untray", safe((payload) => {
    const game = currentGame();
    const pieceId = str(payload?.pieceId, 16);
    const gx = num(payload?.gx);
    const gy = num(payload?.gy);
    if (!game || gx === null || gy === null) return;
    settleUntray(game, untrayPiece(game, pieceId, gx, gy, socket.id), pieceId);
  }));

  socket.on("piece:untray-random", safe((payload) => {
    const game = currentGame();
    if (!game) return;
    const pieceId = str(payload?.pieceId, 16);
    settleUntray(game, untrayPieceRandom(game, pieceId, socket.id), pieceId);
  }));

  socket.on("disconnect", safe(() => leaveCurrent()));
});

startCleanup();
httpServer.listen(PORT, () => {
  console.log(`Puzzle multiplayer sur http://localhost:${PORT}`);
});
