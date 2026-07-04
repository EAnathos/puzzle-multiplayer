import { useEffect, useState } from "react";
import { socket } from "./net/socket.ts";
import { Lobby } from "./scenes/Lobby.tsx";
import { Setup } from "./scenes/Setup.tsx";
import { Board } from "./scenes/Board.tsx";
import type { Game, Piece, Player } from "../../shared/types.ts";

export interface Completion {
  durationMs: number;
  contributions: Record<string, number>;
}

export function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [myId, setMyId] = useState(socket.id ?? "");
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [reconfigure, setReconfigure] = useState(false);

  useEffect(() => {
    function onConnect() {
      setMyId(socket.id ?? "");
    }
    socket.on("connect", onConnect);
    if (socket.connected) setMyId(socket.id ?? "");

    socket.on("game:state", (g) => {
      setCompletion(null);
      setReconfigure(false);
      setGame(g);
    });

    socket.on("player:joined", (player: Player) => {
      setGame((prev) =>
        prev ? { ...prev, players: { ...prev.players, [player.id]: player } } : prev
      );
    });

    socket.on("player:left", ({ playerId }) => {
      setGame((prev) => {
        if (!prev) return prev;
        const players = { ...prev.players };
        delete players[playerId];
        return { ...prev, players };
      });
    });

    socket.on("player:update", (player: Player) => {
      setGame((prev) =>
        prev ? { ...prev, players: { ...prev.players, [player.id]: player } } : prev
      );
    });

    socket.on("host:changed", ({ hostId }) => {
      setGame((prev) => (prev ? { ...prev, hostId } : prev));
    });

    // Un joueur attrape un groupe (ou détache une pièce) → verrouille + regroupe.
    socket.on("piece:grabbed", ({ group, playerId, pieceIds }) => {
      const ids = new Set(pieceIds);
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p) =>
                ids.has(p.id) ? { ...p, group, heldBy: playerId } : p
              ),
            }
          : prev
      );
    });

    // Un groupe se déplace : translation de toutes ses pièces (offset arbitraire).
    socket.on("group:moved", ({ group, anchorId, gx, gy }) => {
      setGame((prev) => {
        if (!prev) return prev;
        const anchor = prev.pieces.find((p) => p.id === anchorId);
        if (!anchor) return prev;
        const dx = gx - anchor.gx;
        const dy = gy - anchor.gy;
        if (dx === 0 && dy === 0) return prev;
        return {
          ...prev,
          pieces: prev.pieces.map((p) =>
            p.group === group ? { ...p, gx: p.gx + dx, gy: p.gy + dy } : p
          ),
        };
      });
    });

    // Un groupe se pose (et fusionne avec ses voisins) : positions autoritaires.
    socket.on("group:settled", ({ pieces }) => {
      const byId = new Map(pieces.map((p) => [p.id, p]));
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p) => {
                const u = byId.get(p.id);
                return u
                  ? { ...p, gx: u.gx, gy: u.gy, group: u.group, heldBy: null }
                  : p;
              }),
            }
          : prev
      );
    });

    socket.on("piece:unlocked", ({ pieceIds }) => {
      const ids = new Set(pieceIds);
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p: Piece) =>
                ids.has(p.id) ? { ...p, heldBy: null } : p
              ),
            }
          : prev
      );
    });

    // Une pièce est mise de côté (bac partagé) → retirée du plateau.
    socket.on("piece:trayed", ({ pieceId, order }) => {
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p) =>
                p.id === pieceId
                  ? { ...p, tray: true, trayOrder: order, heldBy: null, group: -1 - order }
                  : p
              ),
            }
          : prev
      );
    });

    // Une pièce du bac est reposée sur le plateau (et soudée).
    socket.on("piece:untrayed", ({ pieces }) => {
      const byId = new Map(pieces.map((p) => [p.id, p]));
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p) => {
                const u = byId.get(p.id);
                return u
                  ? { ...p, gx: u.gx, gy: u.gy, group: u.group, heldBy: null, tray: false }
                  : p;
              }),
            }
          : prev
      );
    });

    socket.on("game:completed", ({ durationMs, contributions }) => {
      setCompletion({ durationMs, contributions });
      setGame((prev) => (prev ? { ...prev, status: "completed" } : prev));
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("game:state");
      socket.off("player:joined");
      socket.off("player:left");
      socket.off("player:update");
      socket.off("host:changed");
      socket.off("piece:grabbed");
      socket.off("group:moved");
      socket.off("group:settled");
      socket.off("piece:unlocked");
      socket.off("piece:trayed");
      socket.off("piece:untrayed");
      socket.off("game:completed");
    };
  }, []);

  if (!game) return <Lobby />;

  const isHost = game.hostId === myId;
  const showSetup = game.status === "lobby" || (reconfigure && isHost);

  if (showSetup) return <Setup game={game} myId={myId} />;

  return (
    <Board
      game={game}
      myId={myId}
      setGame={setGame}
      completion={completion}
      onReplay={() => setReconfigure(true)}
    />
  );
}
