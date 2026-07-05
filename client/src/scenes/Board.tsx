import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { socket } from "../net/socket.ts";
import { cellSize, type Game } from "../../../shared/types.ts";
import { buildGeometries, type PieceGeometry } from "../puzzle/shape.ts";
import type { Completion } from "../App.tsx";

const CURSOR_MS = 45;
const MOVE_MS = 40;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const TRAY_THUMB = 64; // taille max d'une vignette du bac

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
      ready: boolean;
    };

interface BoardProps {
  game: Game;
  myId: string;
  setGame: Dispatch<SetStateAction<Game | null>>;
  completion: Completion | null;
  onReplay: () => void;
}

export function Board({ game, myId, completion, onReplay }: BoardProps) {
  const grid = game.grid!;
  const board = game.board!;
  const { w: cellW, h: cellH } = cellSize(grid);
  const boardPxW = board.cols * cellW;
  const boardPxH = board.rows * cellH;
  const image = game.image!;
  const isHost = game.hostId === myId;

  const shapes = useMemo(() => buildGeometries(grid), [grid.rows, grid.cols]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
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
  // Shift/Ctrl : mode « bloc » momentané (le temps qu'on maintient la touche).
  const [modeKeyHeld, setModeKeyHeld] = useState(false);
  const modeKeyRef = useRef(false);
  const [endDismissed, setEndDismissed] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Pièces refusées (adjacence incompatible) → petite animation d'erreur.
  const [errorPieces, setErrorPieces] = useState<Set<string>>(() => new Set());
  // Reprise d'une pièce depuis le bac (glisser vers le plateau).
  const [trayDrag, setTrayDrag] = useState<{ pieceId: string; sx: number; sy: number } | null>(null);
  const trayDragRef = useRef(trayDrag);
  trayDragRef.current = trayDrag;

  const it = useRef<Interaction>({ mode: "idle" });
  const lastCursor = useRef(0);
  const lastMove = useRef(0);
  // Multi-touch : pointeurs actifs pour le pincer-zoomer.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  // Appui long tactile → envoie la pièce au bac (équivalent du clic droit).
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const trayLongPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const clearLongPress = useCallback(() => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  }, []);

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

  useEffect(() => {
    function onCursor({ playerId, x, y }: { playerId: string; x: number; y: number }) {
      setCursors((prev) => ({ ...prev, [playerId]: { x, y } }));
    }
    socket.on("cursor:update", onCursor);
    return () => {
      socket.off("cursor:update", onCursor);
    };
  }, []);

  // Dépôt refusé : marque les pièces en erreur ~450ms.
  useEffect(() => {
    function onReject({ pieceIds }: { pieceIds: string[] }) {
      setErrorPieces((prev) => {
        const n = new Set(prev);
        for (const id of pieceIds) n.add(id);
        return n;
      });
      setTimeout(() => {
        setErrorPieces((prev) => {
          const n = new Set(prev);
          for (const id of pieceIds) n.delete(id);
          return n;
        });
      }, 450);
    }
    socket.on("piece:reject", onReject);
    return () => {
      socket.off("piece:reject", onReject);
    };
  }, []);

  // Raccourcis clavier : Échap ouvre le menu ; Shift/Ctrl active le mode
  // « bloc » de façon momentanée (seulement tant que la touche est maintenue),
  // pour éviter de rester coincé en mode bloc après une pression accidentelle.
  useEffect(() => {
    function setBlockKey(on: boolean) {
      modeKeyRef.current = on;
      setModeKeyHeld(on);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen((o) => !o);
        return;
      }
      if (e.key === "Shift" || e.key === "Control") setBlockKey(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Shift" || e.key === "Control") setBlockKey(false);
    }
    // Si la fenêtre perd le focus touche enfoncée, on ne reste pas bloqué.
    function onBlur() {
      setBlockKey(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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
      if (e.button !== 0) return; // clic gauche seulement (droit = bac)
      canvasRef.current?.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Deux doigts → pincer-zoomer : on annule toute autre interaction.
      if (pointers.current.size === 2) {
        clearLongPress();
        if (it.current.mode === "drag") {
          socket.emit("piece:drop", { pieceId: it.current.pieceId });
        }
        it.current = { mode: "idle" };
        const pts = [...pointers.current.values()];
        pinch.current = { dist: dist(pts[0], pts[1]), zoom: zoomRef.current };
        return;
      }
      if (pointers.current.size > 2) return;

      const el = (e.target as HTMLElement).closest("[data-piece-id]");
      const pieceId = (el as HTMLElement | null)?.dataset.pieceId;
      const piece = pieceId ? game.pieces.find((p) => p.id === pieceId) : undefined;
      const grabbable =
        piece &&
        !piece.tray &&
        game.status !== "completed" &&
        !(piece.heldBy && piece.heldBy !== myId);

      if (piece && grabbable) {
        // Touche maintenue → bloc ; sinon le mode choisi par le bouton.
        const single = !modeKeyRef.current && moveMode === "single";
        const w = toWorld(e.clientX, e.clientY);
        it.current = {
          mode: "drag",
          pieceId: piece.id,
          offCx: piece.gx - w.x / cellW,
          offCy: piece.gy - w.y / cellH,
          lastGx: piece.gx,
          lastGy: piece.gy,
          ready: false,
        };
        socket.emit("piece:grab", { pieceId: piece.id, single }, (res) => {
          const cur = it.current;
          if (cur.mode !== "drag" || cur.pieceId !== piece.id) return;
          if (res.ok) cur.ready = true;
          else it.current = { mode: "idle" };
        });
        // Appui long (tactile) → envoie la pièce au bac.
        if (e.pointerType === "touch") {
          longPress.current = {
            x: e.clientX,
            y: e.clientY,
            timer: window.setTimeout(() => {
              socket.emit("piece:tray", { pieceId: piece.id });
              it.current = { mode: "idle" };
              longPress.current = null;
            }, 500),
          };
        }
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
    [game.status, game.pieces, myId, cellW, cellH, toWorld, moveMode, clearLongPress]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Pincer-zoomer : deux doigts pilotent le zoom autour de leur milieu.
      if (pinch.current && pointers.current.size >= 2) {
        const pts = [...pointers.current.values()];
        const next = clamp(
          (pinch.current.zoom * dist(pts[0], pts[1])) / pinch.current.dist,
          MIN_ZOOM,
          MAX_ZOOM
        );
        const rect = canvasRef.current!.getBoundingClientRect();
        const cx = (pts[0].x + pts[1].x) / 2 - rect.left;
        const cy = (pts[0].y + pts[1].y) / 2 - rect.top;
        const old = zoomRef.current;
        const wx = (cx - panRef.current.x) / old;
        const wy = (cy - panRef.current.y) / old;
        setPan({ x: cx - wx * next, y: cy - wy * next });
        setZoom(next);
        return;
      }

      const w = toWorld(e.clientX, e.clientY);
      const now = performance.now();
      if (now - lastCursor.current > CURSOR_MS) {
        lastCursor.current = now;
        socket.emit("cursor:move", { x: Math.round(w.x), y: Math.round(w.y) });
      }

      // Annule l'appui long si le doigt s'éloigne (c'est un glisser).
      if (longPress.current) {
        const ddx = e.clientX - longPress.current.x;
        const ddy = e.clientY - longPress.current.y;
        if (ddx * ddx + ddy * ddy > 100) clearLongPress();
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
    [toWorld, cellW, cellH, board.cols, board.rows, clearLongPress]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      pointers.current.delete(e.pointerId);
      clearLongPress();
      canvasRef.current?.releasePointerCapture(e.pointerId);

      // Fin du pincer-zoomer : on ignore le drop tant que 2 doigts sont posés.
      if (pinch.current) {
        if (pointers.current.size < 2) pinch.current = null;
        it.current = { mode: "idle" };
        return;
      }

      const cur = it.current;
      if (cur.mode === "drag") {
        socket.emit("piece:drop", { pieceId: cur.pieceId });
      }
      it.current = { mode: "idle" };
    },
    [clearLongPress]
  );

  // Clic droit : envoie la pièce dans le bac partagé.
  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const el = (e.target as HTMLElement).closest("[data-piece-id]");
      const pieceId = (el as HTMLElement | null)?.dataset.pieceId;
      const piece = pieceId ? game.pieces.find((p) => p.id === pieceId) : undefined;
      if (!piece || piece.tray) return;
      if (piece.heldBy && piece.heldBy !== myId) return;
      socket.emit("piece:tray", { pieceId: piece.id });
    },
    [game.pieces, myId]
  );

  // --- Reprise depuis le bac ---
  function onTrayDown(e: ReactPointerEvent, pieceId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setTrayDrag({ pieceId, sx: e.clientX, sy: e.clientY });
    // Appui long (tactile) → remet la pièce en jeu au hasard.
    if (e.pointerType === "touch") {
      trayLongPress.current = {
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          setTrayDrag(null);
          trayLongPress.current = null;
          onTrayReturn(pieceId);
        }, 500),
      };
    }
  }
  function onTrayMove(e: ReactPointerEvent) {
    if (trayLongPress.current) {
      const ddx = e.clientX - trayLongPress.current.x;
      const ddy = e.clientY - trayLongPress.current.y;
      if (ddx * ddx + ddy * ddy > 100) {
        clearTimeout(trayLongPress.current.timer);
        trayLongPress.current = null;
      }
    }
    if (!trayDragRef.current) return;
    setTrayDrag((d) => (d ? { ...d, sx: e.clientX, sy: e.clientY } : d));
  }
  function onTrayUp(e: ReactPointerEvent) {
    if (trayLongPress.current) {
      clearTimeout(trayLongPress.current.timer);
      trayLongPress.current = null;
    }
    const d = trayDragRef.current;
    setTrayDrag(null);
    if (!d) return;
    const shelf = shelfRef.current?.getBoundingClientRect();
    const overShelf = shelf && e.clientY >= shelf.top;
    if (!overShelf) {
      const w = toWorld(e.clientX, e.clientY);
      const gx = clamp(Math.round(w.x / cellW), 0, board.cols - 1);
      const gy = clamp(Math.round(w.y / cellH), 0, board.rows - 1);
      socket.emit("piece:untray", { pieceId: d.pieceId, gx, gy });
    }
  }

  // Clic droit sur une pièce du bac : le serveur la repose sur une case
  // valide au hasard (remise en jeu).
  function onTrayReturn(pieceId: string) {
    socket.emit("piece:untray-random", { pieceId });
  }

  const trayPieces = game.pieces
    .filter((p) => p.tray)
    .sort((a, b) => a.trayOrder - b.trayOrder);

  return (
    <div className="game">
      <div
        className="canvas"
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
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
            if (p.tray) return null; // au bac : pas sur le plateau
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
                error={errorPieces.has(p.id)}
              />
            );
          })}
        </div>
      </div>

      {/* Curseurs des autres joueurs, en espace écran. */}
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
          <button
            className="hud-code"
            title="Copier le code"
            onClick={() => {
              navigator.clipboard?.writeText(game.id).then(
                () => {
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 1500);
                },
                () => {}
              );
            }}
          >
            Code {game.id} {codeCopied ? "✓" : "⧉"}
          </button>
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
              className={`btn small mode ${
                modeKeyHeld || moveMode === "block" ? "block" : "single"
              }`}
              onClick={() =>
                setMoveMode((m) => (m === "single" ? "block" : "single"))
              }
              title="Sens du glisser. Maintenir Shift ou Ctrl force le mode bloc."
            >
              {modeKeyHeld || moveMode === "block" ? "🟦 Bloc" : "🧩 Pièce"}
            </button>
            <button className="btn small" onClick={() => zoomBy(0.8)}>
              −
            </button>
            <button className="btn small" onClick={() => zoomBy(1.25)}>
              +
            </button>
            <button className="btn small" onClick={() => setMenuOpen(true)}>
              Menu
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

        {/* Bac partagé */}
        <div
          className={`tray-shelf${showRef && refBig ? " shifted" : ""}`}
          ref={shelfRef}
        >
          <span className="tray-label">
            Bac {trayPieces.length > 0 ? `(${trayPieces.length})` : ""}
          </span>
          <div className="tray-items">
            {trayPieces.map((p) => (
              <TrayPiece
                key={p.id}
                id={p.id}
                geom={shapes.get(p.id)!}
                url={image.url}
                dragging={trayDrag?.pieceId === p.id}
                error={errorPieces.has(p.id)}
                onDown={onTrayDown}
                onMove={onTrayMove}
                onUp={onTrayUp}
                onReturn={onTrayReturn}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Fantôme suivant le curseur pendant la reprise. */}
      {trayDrag &&
        (() => {
          const geom = shapes.get(trayDrag.pieceId);
          if (!geom) return null;
          const s = TRAY_THUMB / Math.max(geom.boxW, geom.boxH);
          return (
            <div
              className="tray-ghost"
              style={{
                left: trayDrag.sx,
                top: trayDrag.sy,
                width: geom.boxW * s,
                height: geom.boxH * s,
              }}
            >
              <div
                style={{
                  width: geom.boxW,
                  height: geom.boxH,
                  transform: `scale(${s})`,
                  transformOrigin: "top left",
                  backgroundImage: `url(${image.url})`,
                  backgroundSize: `${geom.bgW}px ${geom.bgH}px`,
                  backgroundPosition: `${geom.bgX}px ${geom.bgY}px`,
                  clipPath: geom.clip,
                  WebkitClipPath: geom.clip,
                  filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.6))",
                }}
              />
            </div>
          );
        })()}

      {menuOpen && (
        <div className="menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="menu-card card" onClick={(e) => e.stopPropagation()}>
            <h2>Menu</h2>
            <ul className="shortcuts">
              <li>
                <kbd>Shift</kbd> / <kbd>Ctrl</kbd> (maintenir) Déplacer le bloc entier
              </li>
              <li>
                <kbd>Clic droit</kbd> / <kbd>Appui long</kbd> Envoyer la pièce au bac
                / Reprendre la pièce du bac
              </li>
              <li>
                <kbd>Molette</kbd> / <kbd>Pincer</kbd> Zoomer
              </li>
              <li>
                <kbd>Échap</kbd> Ouvrir / fermer ce menu
              </li>
            </ul>
            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={showRef}
                onChange={(e) => setShowRef(e.target.checked)}
              />
              Afficher le modèle
            </label>
            <div className="menu-actions">
              <button className="btn" onClick={() => setMenuOpen(false)}>
                Reprendre
              </button>
              <button className="btn primary" onClick={() => location.reload()}>
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}

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

// --- Pièce sur le plateau (mémoïsée) ---

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
  error?: boolean;
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
  error,
}: PieceProps) {
  const heldByOther = !!holderColor && !mine;
  const filter = holderColor
    ? `drop-shadow(0 2px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 2px ${holderColor}) drop-shadow(0 0 4px ${holderColor})`
    : "drop-shadow(0 2px 3px rgba(0,0,0,0.55))";
  return (
    <div
      className={`piece${error ? " error" : ""}`}
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

// --- Vignette d'une pièce dans le bac ---

function TrayPiece({
  id,
  geom,
  url,
  dragging,
  error,
  onDown,
  onMove,
  onUp,
  onReturn,
}: {
  id: string;
  geom: PieceGeometry;
  url: string;
  dragging: boolean;
  error: boolean;
  onDown: (e: ReactPointerEvent, id: string) => void;
  onMove: (e: ReactPointerEvent) => void;
  onUp: (e: ReactPointerEvent) => void;
  onReturn: (id: string) => void;
}) {
  const s = TRAY_THUMB / Math.max(geom.boxW, geom.boxH);
  return (
    <div
      className={`tray-piece${error ? " error" : ""}`}
      style={{ width: geom.boxW * s, height: geom.boxH * s, opacity: dragging ? 0.3 : 1 }}
      onPointerDown={(e) => onDown(e, id)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onContextMenu={(e) => {
        e.preventDefault();
        onReturn(id);
      }}
      title="Glisse sur le plateau, ou clic droit pour la remettre en jeu"
    >
      <div
        style={{
          width: geom.boxW,
          height: geom.boxH,
          transform: `scale(${s})`,
          transformOrigin: "top left",
          backgroundImage: `url(${url})`,
          backgroundSize: `${geom.bgW}px ${geom.bgH}px`,
          backgroundPosition: `${geom.bgX}px ${geom.bgY}px`,
          clipPath: geom.clip,
          WebkitClipPath: geom.clip,
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// --- Curseur d'un autre joueur ---

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

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}
