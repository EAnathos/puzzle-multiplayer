import type { Game } from "../../../shared/types.ts";

// Liste de présence : pseudo, couleur, hôte, et pièces posées.
export function PlayersPanel({ game, myId }: { game: Game; myId: string }) {
  const players = Object.values(game.players).sort(
    (a, b) => b.piecesPlaced - a.piecesPlaced
  );

  return (
    <aside className="players-panel card">
      <h3>Joueurs ({players.length})</h3>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            <span className="dot" style={{ background: p.color }} />
            <span className="pseudo">
              {p.pseudo}
              {p.id === myId && " (toi)"}
            </span>
            {p.id === game.hostId && <span className="tag">hôte</span>}
            {game.status !== "lobby" && (
              <span className="count">{p.piecesPlaced}</span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
