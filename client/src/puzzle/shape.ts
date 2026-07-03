// Forme des pièces (tenons/mortaises arrondis) côté client.
// Courbe de jigsaw classique (d'après le générateur Draradech) : une épaule qui
// rentre légèrement, un col étroit, puis une tête ronde en contre-dépouille.
// Déterministe à partir de (row, col) → tous les clients voient les mêmes
// formes, et les bords voisins sont complémentaires.

import { cellSize, pieceEdges, type Edges, type Grid } from "../../../shared/types.ts";

const T = 0.1; // hauteur du tenon en fraction de la longueur du bord

export interface PieceGeometry {
  cellW: number;
  cellH: number;
  pad: number;
  boxW: number;
  boxH: number;
  bgX: number;
  bgY: number;
  bgW: number;
  bgH: number;
  clip: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Un bord de A vers A + t*L, tenon/mortaise de signe s le long de la normale n.
function edge(
  A: number[],
  t: number[],
  n: number[],
  L: number,
  s: number
): string {
  const end = [A[0] + t[0] * L, A[1] + t[1] * L];
  if (!s) return `L ${r2(end[0])} ${r2(end[1])} `;
  // Point le long du bord (a ∈ [0,1]) avec décalage perpendiculaire (p).
  const P = (a: number, p: number) => {
    const x = A[0] + t[0] * (a * L) + n[0] * (s * p * L);
    const y = A[1] + t[1] * (a * L) + n[1] * (s * p * L);
    return `${r2(x)} ${r2(y)}`;
  };
  return (
    `C ${P(0.2, 0)} ${P(0.5, -T)} ${P(0.5 - T, T)} ` + // épaule → col
    `C ${P(0.5 - 2 * T, 3 * T)} ${P(0.5 + 2 * T, 3 * T)} ${P(0.5 + T, T)} ` + // tête ronde
    `C ${P(0.5, -T)} ${P(0.8, 0)} ${P(1, 0)} ` // col → épaule
  );
}

function piecePath(e: Edges, w: number, h: number, pad: number): string {
  const TL = [pad, pad];
  const TR = [pad + w, pad];
  const BR = [pad + w, pad + h];
  const BL = [pad, pad + h];
  let d = `M ${r2(TL[0])} ${r2(TL[1])} `;
  d += edge(TL, [1, 0], [0, -1], w, e.top);
  d += edge(TR, [0, 1], [1, 0], h, e.right);
  d += edge(BR, [-1, 0], [0, 1], w, e.bottom);
  d += edge(BL, [0, -1], [-1, 0], h, e.left);
  return d + "Z";
}

export function pieceGeometry(row: number, col: number, grid: Grid): PieceGeometry {
  const { w: cellW, h: cellH } = cellSize(grid);
  const pad = Math.ceil(0.34 * Math.max(cellW, cellH));
  const clip = piecePath(pieceEdges(row, col, grid), cellW, cellH, pad);
  return {
    cellW,
    cellH,
    pad,
    boxW: cellW + pad * 2,
    boxH: cellH + pad * 2,
    bgX: pad - col * cellW,
    bgY: pad - row * cellH,
    bgW: grid.cols * cellW,
    bgH: grid.rows * cellH,
    clip: `path('${clip}')`,
  };
}

export function buildGeometries(grid: Grid): Map<string, PieceGeometry> {
  const map = new Map<string, PieceGeometry>();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      map.set(`${r}-${c}`, pieceGeometry(r, c, grid));
    }
  }
  return map;
}
