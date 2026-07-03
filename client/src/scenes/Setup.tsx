import { useState } from "react";
import { socket } from "../net/socket.ts";
import {
  DIFFICULTIES,
  IMAGES,
  type Difficulty,
  type Game,
} from "../../../shared/types.ts";
import { PlayersPanel } from "./PlayersPanel.tsx";

export function Setup({ game, myId }: { game: Game; myId: string }) {
  const isHost = game.hostId === myId;
  const [imageId, setImageId] = useState(IMAGES[0].id);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [copied, setCopied] = useState(false);

  function start() {
    socket.emit("game:configure", { imageId, difficulty });
  }

  function copyCode() {
    navigator.clipboard?.writeText(game.id).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  }

  return (
    <div className="setup">
      <div className="setup-main card">
        <div className="code-banner">
          <span>Code de la partie</span>
          <button className="code-chip" onClick={copyCode} title="Copier">
            {game.id} {copied ? "✓" : "⧉"}
          </button>
          <small>Partage ce code pour que d'autres rejoignent.</small>
        </div>

        {isHost ? (
          <>
            <h2>Choisis une image</h2>
            <div className="image-grid">
              {IMAGES.map((img) => (
                <button
                  key={img.id}
                  className={`image-choice ${imageId === img.id ? "selected" : ""}`}
                  onClick={() => setImageId(img.id)}
                >
                  <img src={img.url} alt={img.label} />
                  <span>{img.label}</span>
                </button>
              ))}
            </div>

            <h2>Niveau de difficulté</h2>
            <div className="difficulty-row">
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => {
                const def = DIFFICULTIES[d];
                return (
                  <button
                    key={d}
                    className={`diff-choice ${difficulty === d ? "selected" : ""}`}
                    onClick={() => setDifficulty(d)}
                  >
                    <strong>{def.label}</strong>
                    <span>{def.rows * def.cols} pièces</span>
                  </button>
                );
              })}
            </div>

            <button className="btn primary big" onClick={start}>
              Démarrer le puzzle
            </button>
          </>
        ) : (
          <div className="waiting">
            <div className="spinner" />
            <p>En attente de l'hôte pour choisir l'image et le niveau…</p>
          </div>
        )}
      </div>

      <PlayersPanel game={game} myId={myId} />
    </div>
  );
}
