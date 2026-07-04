import { useState } from "react";
import { socket } from "../net/socket.ts";

export function Lobby() {
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const name = pseudo.trim();

  function create() {
    if (!name || busy) return;
    setBusy(true);
    setError("");
    socket.emit("game:create", { pseudo: name }, (res) => {
      setBusy(false);
      if (!res.ok) setError("Impossible de créer la partie.");
    });
  }

  function join() {
    if (!name || !code.trim() || busy) return;
    setBusy(true);
    setError("");
    socket.emit("game:join", { gameId: code.trim(), pseudo: name }, (res) => {
      setBusy(false);
      if (!res.ok) setError("Partie introuvable. Vérifie le code.");
    });
  }

  return (
    <div className="lobby">
      <div className="card">
        <h1>🧩 Puzzle Multiplayer</h1>
        <p className="subtitle">Assemblez un puzzle à plusieurs, en temps réel.</p>

        <div className="join-row">
          <input
            value={pseudo}
            maxLength={12}
            placeholder="Ton pseudo"
            onChange={(e) => setPseudo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="btn primary" disabled={!name || busy} onClick={create}>
            Créer
          </button>
        </div>

        <div className="divider">ou rejoindre</div>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={6}
            placeholder="CODE"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button
            className="btn"
            disabled={!name || !code.trim() || busy}
            onClick={join}
          >
            Rejoindre
          </button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
