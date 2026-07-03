import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { socket } from "../net/socket.ts";
import {
  cellSize,
  DIFFICULTIES,
  wellPlacedSet,
  type Game,
} from "../../../shared/types.ts";
import { buildGeometries } from "../puzzle/shape.ts";
import type { Completion } from "../App.tsx";

const CURSOR_MS = 45;
const MOVE_MS = 40;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;

type Interaction =
  | { mode: "idle" }
  | { mode: "pan"; panX: number; panY: number; ptrX: number; ptrY: number }
  | {
      mode: "drag";
      pieceId: string;
      offCx: number;
      offCy: number;
      lastGx: number;
      lastGy: number;
      single: boolean;
      ready: boolean;
    };

interface BoardProps {
  game: Game;
  myId: string;
  setGame: Dispatch<SetStateAction<Game | null>>;
  completion: Completion | null;
  onReplay: () => void;
}

export function Board({ game, myId, setGame, completion, onReplay }: BoardProps) {
  const grid = game.grid!;
  const board = game.board!;
  const { w: cellW, h: cellH } = cellSize(grid);
  const boardPxW = board.cols * cellW;
  const boardPxH = board.rows * cellH;
  const image = game.image!;
  const isHost = game.hostId === myId;

  const shapes = useMemo(() => buildGeometries(grid), [grid.rows, grid.cols]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const [cursors, setCursors] = useState<Record<string, { x: number; y: number }>>({});
  const [showRef, setShowRef] = useState(true);
  const [refBig, setRefBig] = useState(false);
  const [moveMode, setMoveMode] = useState<"single" | "block">("single");
  const [endDismissed, setEndDismissed] = useState(false);

  const it = useRef<Interaction>({ mode: "idle" });
  const lastCursor = useRef(0);
  const lastMove = useRef(0);

  // Cadre initial : ajuste le zoom pour voir tout le plateau, centré.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const z = Math.max(
      MIN_ZOOM,
      Math.min(1.4, (vw * 0.94) / boardPxW, (vh * 0.8) / boardPxH)
    );
    setZoom(z);
    setPan({ x: (vw - boardPxW * z) / 2, y: (vh - boardPxH * z) / 2 + 16 });
  }, [boardPxW, boardPxH]);

  // Curseurs des autres joueurs.
  useEffect(() => {
    function onCursor({ playerId, x, y }: { playerId: string; x: number; y: number }) {
      setCursors((prev) => ({ ...prev, [playerId]: { x, y } }));
    }
    socket.on("cursor:update", onCursor);
    return () => {
      socket.off("cursor:update", onCursor);
    };
  }, []);

  // Zoom molette centré sur le curseur (listener natif pour preventDefault).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const old = zoomRef.current;
      const next = clamp(old * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_ZOOM, MAX_ZOOM);
      const wx = (mx - panRef.current.x) / old;
      const wy = (my - panRef.current.y) / old;
      setPan({ x: mx - wx * next, y: my - wy * next });
      setZoom(next);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      canvasRef.current?.setPointerCapture(e.pointerId);
      const el = (e.target as HTMLElement).closest("[data-piece-id]");
      const pieceId = (el as HTMLElement | null)?.dataset.pieceId;
      const piece = pieceId ? game.pieces.find((p) => p.id === pieceId) : undefined;
      const grabbable =
        piece &&
        game.status !== "completed" &&
        !(piece.heldBy && piece.heldBy !== myId);

      if (piece && grabbable) {
        const modifier = e.shiftKey || e.ctrlKey || e.metaKey;
        // Défaut : une seule pièce. Shift/Ctrl (ou le bouton) → bloc entier.
        const single = (moveMode === "single") !== modifier;
        const w = toWorld(e.clientX, e.clientY);
        it.current = {
          mode: "drag",
          pieceId: piece.id,
          offCx: piece.gx - w.x / cellW,
          offCy: piece.gy - w.y / cellH,
          lastGx: piece.gx,
          lastGy: piece.gy,
          single,
          ready: false,
        };
        // Verrou/regroupement autoritatifs via l'événement piece:grabbed.
        socket.emit("piece:grab", { pieceId: piece.id, single }, (res) => {
          const cur = it.current;
          if (cur.mode !== "drag" || cur.pieceId !== piece.id) return;
          if (res.ok) cur.ready = true;
          else it.current = { mode: "idle" };
        });
      } else {
        it.current = {
          mode: "pan",
          panX: panRef.current.x,
          panY: panRef.current.y,
          ptrX: e.clientX,
          ptrY: e.clientY,
        };
      }
    },
    [game.status, game.pieces, myId, cellW, cellH, toWorld, moveMode]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const w = toWorld(e.clientX, e.clientY);
      const now = performance.now();
      if (now - lastCursor.current > CURSOR_MS) {
        lastCursor.current = now;
        socket.emit("cursor:move", { x: Math.round(w.x), y: Math.round(w.y) });
      }

      const cur = it.current;
      if (cur.mode === "drag") {
        if (!cur.ready) return;
        let gx = Math.round(w.x / cellW + cur.offCx);
        let gy = Math.round(w.y / cellH + cur.offCy);
        gx = clamp(gx, 0, board.cols - 1);
        gy = clamp(gy, 0, board.rows - 1);
        if (
          (gx !== cur.lastGx || gy !== cur.lastGy) &&
          now - lastMove.current > MOVE_MS
        ) {
          cur.lastGx = gx;
          cur.lastGy = gy;
          lastMove.current = now;
          socket.emit("group:move", { pieceId: cur.pieceId, gx, gy });
        }
      } else if (cur.mode === "pan") {
        setPan({
          x: cur.panX + (e.clientX - cur.ptrX),
          y: cur.panY + (e.clientY - cur.ptrY),
        });
      }
    },
    [toWorld, cellW, cellH, board.cols, board.rows]
  );

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const cur = it.current;
    if (cur.mode === "drag") {
      socket.emit("piece:drop", { pieceId: cur.pieceId });
    }
    it.current = { mode: "idle" };
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  const wellSet = useMemo(() => wellPlacedSet(game.pieces), [game.pieces]);
  const placed = wellSet.size;
  const total = game.pieces.length;
  const def = DIFFICULTIES[game.difficulty ?? "easy"];

  return (
    <div className="game">
      <div
        className="canvas"
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="world"
          style={{
            width: boardPxW,
            height: boardPxH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: `${cellW}px ${cellH}px`,
          }}
        >
          {game.pieces.map((p) => {
            const geom = shapes.get(p.id)!;
            const holder = p.heldBy ? game.players[p.heldBy]?.color : undefined;
            return (
              <Piece
                key={p.id}
                id={p.id}
                left={p.gx * cellW - geom.pad}
                top={p.gy * cellH - geom.pad}
                boxW={geom.boxW}
                boxH={geom.boxH}
                bgX={geom.bgX}
                bgY={geom.bgY}
                bgW={geom.bgW}
                bgH={geom.bgH}
                clip={geom.clip}
                url={image.url}
                mine={p.heldBy === myId}
                holderColor={holder}
              />
            );
          })}
        </div>
      </div>

      {/* Curseurs des autres joueurs, en espace écran (taille constante). */}
      <div className="overlay cursors">
        {Object.entries(cursors).map(([pid, pos]) => {
          if (pid === myId) return null;
          const player = game.players[pid];
          if (!player) return null;
          return (
            <Cursor
              key={pid}
              x={pan.x + pos.x * zoom}
              y={pan.y + pos.y * zoom}
              color={player.color}
              pseudo={player.pseudo}
            />
          );
        })}
      </div>

      {/* HUD flottant */}
      <div className="overlay hud">
        <div className="hud-panel top-left">
          <span className="hud-code">Code {game.id}</span>
          <span className="hud-diff">
            {def.label} · {game.pieces.length} pièces
          </span>
          <div className="hud-progress">
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${(placed / Math.max(1, total)) * 100}%` }}
              />
            </div>
            <span>
              {placed} / {total} bien placées
            </span>
          </div>
        </div>

        <div className="hud-panel top-right">
          <div className="players-inline">
            {Object.values(game.players).map((p) => (
              <span key={p.id} className="player-chip" title={p.pseudo}>
                <span className="dot" style={{ background: p.color }} />
                {p.pseudo}
                {p.id === myId && " (toi)"}
              </span>
            ))}
          </div>
          <div className="controls">
            <button
              className={`btn small mode ${moveMode}`}
              onClick={() =>
                setMoveMode((m) => (m === "single" ? "block" : "single"))
              }
              title="Sens par défaut du glisser. Shift/Ctrl inverse temporairement."
            >
              {moveMode === "single" ? "🧩 Pièce" : "🟦 Bloc"}
            </button>
            <button className="btn small" onClick={() => zoomBy(0.8)}>
              −
            </button>
            <button className="btn small" onClick={() => zoomBy(1.25)}>
              +
            </button>
            <label className="ghost-toggle">
              <input
                type="checkbox"
                checked={showRef}
                onChange={(e) => setShowRef(e.target.checked)}
              />
              Modèle
            </label>
            <button className="btn small" onClick={() => location.reload()}>
              Quitter
            </button>
          </div>
        </div>

        {showRef && (
          <div
            className={`reference${refBig ? " big" : ""}`}
            onClick={() => setRefBig((b) => !b)}
            title={refBig ? "Réduire le modèle" : "Agrandir le modèle"}
          >
            <img src={image.url} alt="Modèle" />
            <span>Modèle {refBig ? "▾" : "▸"}</span>
          </div>
        )}

        <div className="hint-bar">
          Glisse pour déplacer · Shift/Ctrl = bloc entier · molette = zoom · fond
          = se déplacer
        </div>
      </div>

      {game.status === "completed" && !endDismissed && (
        <EndScreen
          game={game}
          completion={completion}
          isHost={isHost}
          onReplay={onReplay}
          onDismiss={() => setEndDismissed(true)}
        />
      )}
    </div>
  );

  function zoomBy(factor: number) {
    const el = canvasRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const old = zoomRef.current;
    const next = clamp(old * factor, MIN_ZOOM, MAX_ZOOM);
    const wx = (cx - panRef.current.x) / old;
    const wy = (cy - panRef.current.y) / old;
    setPan({ x: cx - wx * next, y: cy - wy * next });
    setZoom(next);
  }
}

// --- Pièce (mémoïsée sur props primitives) ---

interface PieceProps {
  id: string;
  left: number;
  top: number;
  boxW: number;
  boxH: number;
  bgX: number;
  bgY: number;
  bgW: number;
  bgH: number;
  clip: string;
  url: string;
  mine: boolean;
  holderColor?: string;
}

const Piece = memo(function Piece({
  id,
  left,
  top,
  boxW,
  boxH,
  bgX,
  bgY,
  bgW,
  bgH,
  clip,
  url,
  mine,
  holderColor,
}: PieceProps) {
  const heldByOther = !!holderColor && !mine;
  const filter = holderColor
    ? `drop-shadow(0 2px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 2px ${holderColor}) drop-shadow(0 0 4px ${holderColor})`
    : "drop-shadow(0 2px 3px rgba(0,0,0,0.55))";
  return (
    <div
      className="piece"
      data-piece-id={id}
      style={{
        left,
        top,
        width: boxW,
        height: boxH,
        backgroundImage: `url(${url})`,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        clipPath: clip,
        WebkitClipPath: clip,
        filter,
        zIndex: mine ? 1000 : heldByOther ? 500 : 10,
        pointerEvents: heldByOther ? "none" : "auto",
        cursor: mine ? "grabbing" : "grab",
      }}
    />
  );
});

// --- Curseur d'un autre joueur (espace écran) ---

function Cursor({
  x,
  y,
  color,
  pseudo,
}: {
  x: number;
  y: number;
  color: string;
  pseudo: string;
}) {
  return (
    <div className="cursor" style={{ left: x, top: y }}>
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path
          d="M2 2 L2 14 L6 10 L9 16 L11 15 L8 9 L14 9 Z"
          fill={color}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <span className="cursor-label" style={{ background: color }}>
        {pseudo}
      </span>
    </div>
  );
}

// --- Écran de fin ---

function EndScreen({
  game,
  completion,
  isHost,
  onReplay,
  onDismiss,
}: {
  game: Game;
  completion: Completion | null;
  isHost: boolean;
  onReplay: () => void;
  onDismiss: () => void;
}) {
  const durationMs =
    completion?.durationMs ??
    (game.completedAt ? game.completedAt - game.createdAt : 0);
  const contributions =
    completion?.contributions ??
    Object.fromEntries(
      Object.values(game.players).map((p) => [p.id, p.piecesPlaced])
    );
  const ranking = Object.entries(contributions)
    .map(([id, count]) => ({ id, count, player: game.players[id] }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="end-overlay">
      <div className="end-card card">
        <h2>Puzzle terminé ! 🎉</h2>
        <img className="end-image" src={game.image!.url} alt="Puzzle résolu" />
        <p className="end-time">Temps : {formatDuration(durationMs)}</p>
        <h3>Contributions</h3>
        <ul className="end-ranking">
          {ranking.map(({ id, count, player }) => (
            <li key={id}>
              <span className="dot" style={{ background: player?.color ?? "#888" }} />
              <span className="pseudo">{player?.pseudo ?? "Joueur parti"}</span>
              <span className="count">{count} pièces</span>
            </li>
          ))}
        </ul>
        <div className="end-actions">
          <button className="btn" onClick={onDismiss}>
            Revoir le puzzle
          </button>
          {isHost && (
            <button className="btn primary" onClick={onReplay}>
              Nouvelle partie
            </button>
          )}
        </div>
        {!isHost && <p className="hint">L'hôte peut lancer une nouvelle partie.</p>}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}
