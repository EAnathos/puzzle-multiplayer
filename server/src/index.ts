// Serveur : sert le client (build Vite) et héberge le temps réel Socket.IO.

import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
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
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

app.use(express.static(clientDist));
app.get("*", (_req, res) => res.sendFile(join(clientDist, "index.html")));

interface SocketData {
  gameId?: string;
  playerId?: string;
}

io.on("connection", (socket) => {
  const data = socket.data as SocketData;

  socket.on("game:create", ({ pseudo }, ack) => {
    const game = createGame(socket.id);
    const player = addPlayer(game, socket.id, pseudo);
    data.gameId = game.id;
    data.playerId = player.id;
    socket.join(game.id);
    ack({ ok: true, gameId: game.id });
    socket.emit("game:state", game);
  });

  socket.on("game:join", ({ gameId, pseudo }, ack) => {
    const game = getGame(gameId);
    if (!game) return ack({ ok: false, error: "game_not_found" });

    const player = addPlayer(game, socket.id, pseudo);
    data.gameId = game.id;
    data.playerId = player.id;
    socket.join(game.id);

    ack({ ok: true, game });
    // L'arrivant reçoit l'état complet → lobby ou partie en cours selon le statut.
    socket.emit("game:state", game);
    socket.to(game.id).emit("player:joined", player);
  });

  socket.on("game:configure", ({ imageId, difficulty, customImage }) => {
    const game = getGame(data.gameId ?? "");
    if (!game || game.hostId !== socket.id) return;
    if (configureGame(game, imageId, difficulty, customImage)) {
      io.to(game.id).emit("game:state", game);
    }
  });

  socket.on("cursor:move", ({ x, y }) => {
    const game = getGame(data.gameId ?? "");
    const player = game?.players[socket.id];
    if (!game || !player) return;
    player.cursor = { x, y };
    socket.to(game.id).emit("cursor:update", { playerId: socket.id, x, y });
  });

  socket.on("piece:grab", ({ pieceId, single }, ack) => {
    const game = getGame(data.gameId ?? "");
    if (!game) return ack({ ok: false, error: "game_not_found" });
    const res = grabGroup(game, pieceId, socket.id, single);
    ack({ ok: res.ok, error: res.error, group: res.group });
    if (res.ok && res.group !== undefined && res.pieceIds) {
      io.to(game.id).emit("piece:grabbed", {
        group: res.group,
        playerId: socket.id,
        pieceIds: res.pieceIds,
      });
    }
  });

  socket.on("group:move", ({ pieceId, gx, gy }) => {
    const game = getGame(data.gameId ?? "");
    if (!game) return;
    const res = moveGroup(game, pieceId, gx, gy, socket.id);
    if (res.ok && res.group !== undefined) {
      io.to(game.id).emit("group:moved", {
        group: res.group,
        anchorId: pieceId,
        gx,
        gy,
      });
    }
  });

  socket.on("piece:drop", ({ pieceId }) => {
    const game = getGame(data.gameId ?? "");
    if (!game) return;
    const res = dropGroup(game, pieceId, socket.id);
    if (!res.ok || !res.settled) return;

    io.to(game.id).emit("group:settled", {
      pieces: res.settled.map((p) => ({
        id: p.id,
        gx: p.gx,
        gy: p.gy,
        group: p.group,
      })),
      playerId: socket.id,
    });

    // Les scores (pièces bien placées) ont pu changer pour tout le monde.
    io.to(game.id).emit("game:progress", {
      placed: placedCount(game),
      total: game.pieces.length,
    });
    for (const player of Object.values(game.players)) {
      io.to(game.id).emit("player:update", player);
    }

    if (res.completed && game.completedAt) {
      game.status = "completed";
      io.to(game.id).emit("game:completed", {
        completedAt: game.completedAt,
        durationMs: game.completedAt - game.createdAt,
        contributions: contributions(game),
      });
    }
  });

  function broadcastScores(gameId: string) {
    const g = getGame(gameId);
    if (!g) return;
    io.to(gameId).emit("game:progress", {
      placed: placedCount(g),
      total: g.pieces.length,
    });
    for (const player of Object.values(g.players)) {
      io.to(gameId).emit("player:update", player);
    }
  }

  socket.on("piece:tray", ({ pieceId }) => {
    const game = getGame(data.gameId ?? "");
    if (!game) return;
    const res = trayPiece(game, pieceId, socket.id);
    if (!res.ok || res.order === undefined) return;
    io.to(game.id).emit("piece:trayed", { pieceId, order: res.order });
    broadcastScores(game.id);
  });

  socket.on("piece:untray", ({ pieceId, gx, gy }) => {
    const game = getGame(data.gameId ?? "");
    if (!game) return;
    const res = untrayPiece(game, pieceId, gx, gy, socket.id);
    if (!res.ok || !res.settled) return;
    io.to(game.id).emit("piece:untrayed", {
      pieces: res.settled.map((p) => ({
        id: p.id,
        gx: p.gx,
        gy: p.gy,
        group: p.group,
      })),
      pieceId,
    });
    broadcastScores(game.id);
    if (res.completed && game.completedAt) {
      game.status = "completed";
      io.to(game.id).emit("game:completed", {
        completedAt: game.completedAt,
        durationMs: game.completedAt - game.createdAt,
        contributions: contributions(game),
      });
    }
  });

  socket.on("disconnect", () => {
    const game = getGame(data.gameId ?? "");
    if (!game) return;

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
  });
});

startCleanup();
httpServer.listen(PORT, () => {
  console.log(`Puzzle multiplayer sur http://localhost:${PORT}`);
});
