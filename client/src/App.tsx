import { useEffect, useRef, useState } from "react";
import { socket } from "./net/socket.ts";
import { codeFromUrl, savedPseudo, setUrlCode } from "./net/share.ts";
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
  const [online, setOnline] = useState(socket.connected);
  const [notice, setNotice] = useState("");
  // Code reçu par lien d'invitation (lu une seule fois, au chargement).
  const [initialCode] = useState(codeFromUrl);

  // Partie et pseudo courants, pour se reconnecter automatiquement.
  const gameIdRef = useRef<string | null>(null);
  const pseudoRef = useRef("");
  gameIdRef.current = game?.id ?? null;
  if (game && game.players[myId]) pseudoRef.current = game.players[myId].pseudo;

  // L'URL reflète la partie courante (lien partageable, rechargement = retour).
  const hadGame = useRef(false);
  useEffect(() => {
    if (game?.id) {
      hadGame.current = true;
      setUrlCode(game.id);
    } else if (hadGame.current) {
      setUrlCode(null);
    }
  }, [game?.id]);

  useEffect(() => {
    function onConnect() {
      setMyId(socket.id ?? "");
      setOnline(true);
      // Reconnexion (coupure réseau, redémarrage du serveur) : on revient dans
      // la partie avec un nouvel identifiant. Si elle n'existe plus, retour au
      // lobby avec un message.
      const gameId = gameIdRef.current;
      if (!gameId) return;
      const pseudo = pseudoRef.current || savedPseudo() || "Joueur";
      socket.emit("game:join", { gameId, pseudo }, (res) => {
        if (res.ok) return;
        setGame(null);
        setCompletion(null);
        setNotice(`La partie ${gameId} n'existe plus.`);
      });
    }
    function onDisconnect() {
      setOnline(false);
    }
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
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
    // `regroup` scinde le reste du bloc en morceaux séparés.
    socket.on("piece:grabbed", ({ group, playerId, pieceIds, regroup }) => {
      const ids = new Set(pieceIds);
      const reg = new Map(regroup.map((r) => [r.id, r.group]));
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p) => {
                if (ids.has(p.id)) return { ...p, group, heldBy: playerId };
                if (reg.has(p.id)) return { ...p, group: reg.get(p.id)! };
                return p;
              }),
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
    // `regroup` scinde le reste du bloc en morceaux séparés.
    socket.on("piece:trayed", ({ pieceId, order, regroup }) => {
      const reg = new Map(regroup.map((r) => [r.id, r.group]));
      setGame((prev) =>
        prev
          ? {
              ...prev,
              pieces: prev.pieces.map((p) => {
                if (p.id === pieceId) {
                  return { ...p, tray: true, trayOrder: order, heldBy: null, group: -1 - order };
                }
                if (reg.has(p.id)) return { ...p, group: reg.get(p.id)! };
                return p;
              }),
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
      socket.off("disconnect", onDisconnect);
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

  if (!game) {
    // Après la perte d'une partie, on repart d'un lobby vierge avec le message.
    return <Lobby key={notice} initialCode={notice ? "" : initialCode} notice={notice} />;
  }

  const isHost = game.hostId === myId;
  const showSetup = game.status === "lobby" || (reconfigure && isHost);

  return (
    <>
      {showSetup ? (
        <Setup game={game} myId={myId} />
      ) : (
        <Board
          game={game}
          myId={myId}
          completion={completion}
          onReplay={() => setReconfigure(true)}
        />
      )}
      {!online && <div className="offline-banner">Connexion perdue, reconnexion…</div>}
    </>
  );
}
