import { useEffect, useState } from "react";
import { socket } from "../net/socket.ts";
import { isValidCode, normalizeCode, savePseudo, savedPseudo } from "../net/share.ts";
import type { GameStatus } from "../../../shared/types.ts";

// État de la vérification du code saisi (ou reçu par lien).
type Lookup =
  | { state: "idle" }
  | { state: "checking"; code: string }
  | { state: "found"; code: string; players: number; status?: GameStatus }
  | { state: "missing"; code: string };

const STATUS_LABEL: Record<GameStatus, string> = {
  lobby: "en préparation",
  playing: "en cours",
  completed: "terminée",
};

export function Lobby({ initialCode = "", notice = "" }: { initialCode?: string; notice?: string }) {
  const [pseudo, setPseudo] = useState(savedPseudo);
  const [code, setCode] = useState(initialCode);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  // Arrivée par lien d'invitation : écran simplifié tant que la partie existe.
  const [invited, setInvited] = useState(isValidCode(initialCode));

  const name = pseudo.trim();
  const canJoin = lookup.state === "found" && lookup.code === code;

  // Vérifie l'existence de la partie dès que le code est complet : on ne peut
  // pas rejoindre une partie qui n'existe pas.
  useEffect(() => {
    if (!isValidCode(code)) {
      setLookup({ state: "idle" });
      return;
    }
    let cancelled = false;
    setLookup({ state: "checking", code });
    const check = () =>
      socket.emit("game:exists", { gameId: code }, (res) => {
        if (cancelled) return;
        if (res.exists) {
          setLookup({ state: "found", code, players: res.players ?? 0, status: res.status });
        } else {
          setLookup({ state: "missing", code });
          setInvited(false);
        }
      });
    // Le socket peut ne pas encore être connecté au tout premier rendu.
    if (socket.connected) check();
    else socket.once("connect", check);
    return () => {
      cancelled = true;
      socket.off("connect", check);
    };
  }, [code]);

  function create() {
    if (!name || busy) return;
    setBusy(true);
    setError("");
    savePseudo(name);
    socket.emit("game:create", { pseudo: name }, (res) => {
      setBusy(false);
      if (!res.ok) setError("Impossible de créer la partie.");
    });
  }

  function join() {
    if (!name || !canJoin || busy) return;
    setBusy(true);
    setError("");
    savePseudo(name);
    socket.emit("game:join", { gameId: code, pseudo: name }, (res) => {
      setBusy(false);
      if (!res.ok) {
        setLookup({ state: "missing", code });
        setError("Cette partie n'existe plus.");
      }
    });
  }

  const pseudoInput = (onEnter: () => void) => (
    <input
      value={pseudo}
      maxLength={12}
      placeholder="Ton pseudo"
      autoFocus
      onChange={(e) => setPseudo(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
    />
  );

  if (invited && lookup.state !== "missing") {
    return (
      <div className="lobby">
        <div className="card">
          <h1>🧩 Puzzle Multiplayer</h1>
          <p className="subtitle">
            Tu es invité à rejoindre la partie <strong className="code-inline">{code}</strong>
            {lookup.state === "found" &&
              ` (${lookup.players} joueur${lookup.players > 1 ? "s" : ""}${
                lookup.status ? `, ${STATUS_LABEL[lookup.status]}` : ""
              })`}
            .
          </p>
          <div className="join-row">
            {pseudoInput(join)}
            <button className="btn primary" disabled={!name || !canJoin || busy} onClick={join}>
              {lookup.state === "checking" ? "…" : "Rejoindre"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="link-btn" onClick={() => setInvited(false)}>
            Créer ma propre partie
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <div className="card">
        <h1>🧩 Puzzle Multiplayer</h1>
        <p className="subtitle">Assemblez un puzzle à plusieurs, en temps réel.</p>

        <div className="join-row">
          {pseudoInput(create)}
          <button className="btn primary" disabled={!name || busy} onClick={create}>
            Créer
          </button>
        </div>

        <div className="divider">ou rejoindre</div>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            placeholder="CODE"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setCode(normalizeCode(e.target.value));
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className="btn" disabled={!name || !canJoin || busy} onClick={join}>
            Rejoindre
          </button>
        </div>

        {lookup.state === "checking" && <p className="lookup">Recherche de la partie…</p>}
        {lookup.state === "found" && (
          <p className="lookup ok">
            Partie trouvée : {lookup.players} joueur{lookup.players > 1 ? "s" : ""}
            {lookup.status ? `, ${STATUS_LABEL[lookup.status]}` : ""}.
          </p>
        )}
        {lookup.state === "missing" && (
          <p className="error">Aucune partie avec le code {lookup.code}.</p>
        )}
        {code.length === 4 && !isValidCode(code) && (
          <p className="error">Code invalide (lettres et chiffres, sans 0, O, 1 ni I).</p>
        )}
        {error && lookup.state !== "missing" && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
