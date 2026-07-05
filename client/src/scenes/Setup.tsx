import { useRef, useState } from "react";
import { socket } from "../net/socket.ts";
import {
  DIFFICULTIES,
  IMAGES,
  type Difficulty,
  type Game,
} from "../../../shared/types.ts";
import { PlayersPanel } from "./PlayersPanel.tsx";

// Recadre l'image importée en cover 600×450 (ratio du puzzle) → data-URL légère.
function fileToImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const TW = 600;
        const TH = 450;
        const canvas = document.createElement("canvas");
        canvas.width = TW;
        canvas.height = TH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        const scale = Math.max(TW / img.width, TH / img.height);
        const sw = TW / scale;
        const sh = TH / scale;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, TW, TH);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function Setup({ game, myId }: { game: Game; myId: string }) {
  const isHost = game.hostId === myId;
  const [imageId, setImageId] = useState(IMAGES[0].id);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function start() {
    if (imageId === "custom") {
      if (!customUrl) return;
      socket.emit("game:configure", {
        imageId: "custom",
        difficulty,
        customImage: { url: customUrl, label: "Mon image" },
      });
    } else {
      socket.emit("game:configure", { imageId, difficulty });
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await fileToImage(file);
      setCustomUrl(url);
      setImageId("custom");
    } catch {
      /* ignore */
    }
    e.target.value = "";
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
              <button
                className="image-choice import-tile"
                onClick={() => fileRef.current?.click()}
              >
                <span className="plus">+</span>
                <span>Importer</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onFile}
              />

              {customUrl && (
                <button
                  className={`image-choice ${imageId === "custom" ? "selected" : ""}`}
                  onClick={() => setImageId("custom")}
                >
                  <img src={customUrl} alt="Mon image" />
                  <span>Mon image</span>
                </button>
              )}

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
