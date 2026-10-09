import { useRef, useState } from "react";
import { socket } from "../net/socket.ts";
import { copyText, inviteLink, shareInvite } from "../net/share.ts";
import {
  DIFFICULTIES,
  IMAGES,
  MAX_CUSTOM_IMAGE_BYTES,
  type Difficulty,
  type Game,
} from "../../../shared/types.ts";
import { PlayersPanel } from "./PlayersPanel.tsx";

interface ImportedImage {
  url: string;
  aspect: number; // largeur / hauteur
  animated: boolean;
}

const MAX_SIDE = 1400; // côté max d'une image fixe après redimensionnement

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Image fixe : redimensionnée (ratio conservé) en JPEG léger.
// GIF : gardé tel quel pour conserver l'animation (les pièces bougent).
async function importImage(file: File): Promise<ImportedImage> {
  const src = await readAsDataUrl(file);
  const img = await loadImage(src);
  const aspect = img.naturalWidth / img.naturalHeight || 4 / 3;

  if (file.type === "image/gif") {
    if (file.size > MAX_CUSTOM_IMAGE_BYTES) throw new Error("too_big");
    return { url: src, aspect, animated: true };
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  ctx.fillStyle = "#fff"; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL("image/jpeg", 0.85), aspect, animated: false };
}

export function Setup({ game, myId }: { game: Game; myId: string }) {
  const isHost = game.hostId === myId;
  const [imageId, setImageId] = useState(IMAGES[0].id);
  const [custom, setCustom] = useState<ImportedImage | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [feedback, setFeedback] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const link = inviteLink(game.id);

  function start() {
    if (imageId === "custom") {
      if (!custom) return;
      socket.emit("game:configure", {
        imageId: "custom",
        difficulty,
        customImage: {
          url: custom.url,
          label: custom.animated ? "Mon GIF" : "Mon image",
          aspect: custom.aspect,
        },
      });
    } else {
      socket.emit("game:configure", { imageId, difficulty });
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportError("");
    try {
      setCustom(await importImage(file));
      setImageId("custom");
    } catch (err) {
      setImportError(
        (err as Error).message === "too_big"
          ? `GIF trop lourd (max ${MAX_CUSTOM_IMAGE_BYTES / 1024 / 1024} Mo).`
          : "Impossible de lire cette image."
      );
    } finally {
      setImporting(false);
    }
  }

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(""), 1800);
  }

  async function copy(text: string, label: string) {
    flash((await copyText(text)) ? `${label} copié ✓` : "Copie impossible");
  }

  async function share() {
    const res = await shareInvite(game.id);
    if (res === "copied") flash("Lien copié ✓");
  }

  return (
    <div className="setup">
      <div className="setup-main card">
        <div className="code-banner">
          <span>Code de la partie</span>
          <button className="code-chip" onClick={() => copy(game.id, "Code")} title="Copier le code">
            {game.id} ⧉
          </button>
          <div className="invite-row">
            <input
              className="invite-link"
              value={link}
              readOnly
              onFocus={(e) => e.target.select()}
              aria-label="Lien d'invitation"
            />
            <button className="btn small primary" onClick={share}>
              Partager le lien
            </button>
          </div>
          <small>{feedback || "Envoie ce lien : il ouvre directement la partie."}</small>
        </div>

        {isHost ? (
          <>
            <h2>Choisis une image</h2>
            <div className="image-grid">
              <button
                className="image-choice import-tile"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                title="Image ou GIF animé"
              >
                <span className="plus">{importing ? "…" : "+"}</span>
                <span>Importer (image / GIF)</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onFile}
              />

              {custom && (
                <button
                  className={`image-choice ${imageId === "custom" ? "selected" : ""}`}
                  onClick={() => setImageId("custom")}
                >
                  <img src={custom.url} alt="Mon image" />
                  <span>{custom.animated ? "Mon GIF (animé)" : "Mon image"}</span>
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

            {importError && <p className="error">{importError}</p>}

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
