import { getTranslations } from 'next-intl/server';
import {
  ELEMENT_KINDS,
  tableChairsM,
  tableSurfaceM,
  type ElementKind,
  type FloorKind,
  type TableShape,
} from '@/components/mon-mariage/seating-model';

/**
 * Plan de salle **lecture seule** destiné à l'invité — vue du dessus, à
 * l'échelle réelle (le `viewBox` est en mètres, comme le modèle).
 *
 * Rendu 100 % serveur : aucun JS envoyé au client. C'est volontaire, la page
 * s'ouvre souvent sur un réseau saturé (salle des fêtes, 200 téléphones) et
 * doit s'afficher immédiatement.
 *
 * Lisibilité : la table de l'invité est en or plein et légendée ; toutes les
 * autres restent en trait clair sans nom d'occupant. Le plan situe, il ne
 * divulgue pas la liste des invités.
 */

export interface SeatRoomPlanTable {
  _id: string;
  name: string;
  shape: TableShape;
  capacity: number;
  /** centre de la table, en mètres depuis le coin haut-gauche de la salle */
  x: number;
  y: number;
  rotation: number;
  honor: boolean;
  mine: boolean;
}

export interface SeatRoomPlanElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  label?: string;
}

export interface SeatRoomPlanProps {
  room: { name: string; widthM: number; lengthM: number; floor: FloorKind };
  tables: SeatRoomPlanTable[];
  elements: SeatRoomPlanElement[];
  /** Table de l'invité + sa chaise, pour poser le repère doré. */
  highlight: { tableId: string | null; seatNumber: number | null };
}

/**
 * Taille de police (en mètres) tenant dans la largeur d'un élément, ou `null`
 * si même le plancher de lisibilité déborde.
 *
 * Approximation volontairement grossière — 0,52 em de large par glyphe couvre
 * la Geist Sans en minuscules comme en capitales. On préfère un label absent
 * à un label qui chevauche la table d'à côté.
 */
function fitLabel(label: string, widthM: number): number | null {
  const MAX = 0.36;
  const MIN = 0.24;
  const GLYPH_RATIO = 0.52;
  const usable = widthM - 0.16;
  if (usable <= 0 || label.length === 0) return null;
  const ideal = usable / (label.length * GLYPH_RATIO);
  if (ideal >= MAX) return MAX;
  if (ideal >= MIN) return ideal;
  return null;
}

/** Teinte de sol — assez pâle pour que les tables restent le sujet. */
const FLOOR_FILL: Record<FloorKind, string> = {
  parquet: 'var(--color-champagne-100)',
  marble: 'var(--color-ivory-100)',
  carpet: 'var(--color-blush-100)',
  grass: 'var(--color-sage-100)',
  concrete: 'var(--color-ivory-200)',
};

const ACCENT_FILL: Record<string, string> = {
  gold: 'var(--color-champagne-200)',
  blush: 'var(--color-blush-100)',
  sage: 'var(--color-sage-100)',
  ink: 'var(--color-ivory-200)',
};

export async function SeatRoomPlan({ room, tables, elements, highlight }: SeatRoomPlanProps) {
  const t = await getTranslations('SeatPass');
  // Marge autour de la salle pour que les traits de bord ne soient pas rognés.
  const pad = 0.6;
  const vbW = room.widthM + pad * 2;
  const vbH = room.lengthM + pad * 2;

  return (
    <figure className="m-0">
      <div className="overflow-x-auto rounded-2xl border border-[color:var(--color-champagne-300)] bg-[color:var(--color-ivory-50)] p-2">
        <svg
          viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
          className="block h-auto w-full min-w-[280px]"
          role="img"
          aria-label={`${t('roomTitle')} — ${room.name}`}
        >
          {/* Sol */}
          <rect
            x={0}
            y={0}
            width={room.widthM}
            height={room.lengthM}
            rx={0.3}
            fill={FLOOR_FILL[room.floor]}
            stroke="var(--color-champagne-300)"
            strokeWidth={0.06}
          />

          {/* Éléments de salle (piste, bar, entrée…) */}
          {elements.map((el) => {
            const spec = ELEMENT_KINDS[el.kind];
            const label = el.label?.trim() || t(`elements.${el.kind}`);
            // Un petit élément (gâteau, cadeaux…) ne peut pas porter son nom :
            // le texte déborderait sur la table voisine. On réduit la graisse
            // jusqu'à un plancher lisible, puis on renonce au label.
            const fontSize = fitLabel(label, el.w);
            return (
              <g
                key={el.id}
                transform={`rotate(${el.rotation} ${el.x} ${el.y})`}
                aria-hidden="true"
              >
                <rect
                  x={el.x - el.w / 2}
                  y={el.y - el.h / 2}
                  width={el.w}
                  height={el.h}
                  rx={spec.variant === 'round' ? Math.min(el.w, el.h) / 2 : 0.18}
                  fill={ACCENT_FILL[spec.accent] ?? 'var(--color-ivory-200)'}
                  stroke="var(--color-champagne-300)"
                  strokeWidth={0.04}
                />
                {fontSize !== null ? (
                  <text
                    x={el.x}
                    y={el.y + fontSize * 0.36}
                    textAnchor="middle"
                    fill="var(--color-ink-400)"
                    style={{ fontSize, letterSpacing: 0.01 }}
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Tables */}
          {tables.map((table) => {
            const surface = tableSurfaceM(table.shape, table.capacity);
            const round = table.shape === 'round';
            const chairs = tableChairsM(table.shape, table.capacity);
            const seatIndex =
              table.mine && highlight.tableId === table._id && highlight.seatNumber !== null
                ? highlight.seatNumber - 1
                : -1;
            const chair = seatIndex >= 0 ? chairs[seatIndex] : undefined;

            return (
              <g key={table._id} transform={`rotate(${table.rotation} ${table.x} ${table.y})`}>
                {/* Halo de repérage de la table de l'invité */}
                {table.mine ? (
                  <ellipse
                    cx={table.x}
                    cy={table.y}
                    rx={surface.w / 2 + 0.85}
                    ry={surface.h / 2 + 0.85}
                    fill="var(--color-champagne-200)"
                    opacity={0.55}
                  />
                ) : null}

                {/* Chaises — repère visuel du nombre de couverts */}
                {chairs.map((c, i) => (
                  <circle
                    key={i}
                    cx={table.x + c.x}
                    cy={table.y + c.y}
                    r={0.17}
                    fill={
                      i === seatIndex ? 'var(--color-champagne-700)' : 'var(--color-champagne-300)'
                    }
                  />
                ))}

                {/* Plateau */}
                {round ? (
                  <circle
                    cx={table.x}
                    cy={table.y}
                    r={surface.w / 2}
                    fill={table.mine ? 'var(--color-champagne-100)' : 'var(--color-ivory-50)'}
                    stroke={
                      table.mine
                        ? 'var(--color-champagne-700)'
                        : table.honor
                          ? 'var(--color-champagne-500)'
                          : 'var(--color-champagne-300)'
                    }
                    strokeWidth={table.mine ? 0.1 : 0.05}
                  />
                ) : (
                  <rect
                    x={table.x - surface.w / 2}
                    y={table.y - surface.h / 2}
                    width={surface.w}
                    height={surface.h}
                    rx={0.14}
                    fill={table.mine ? 'var(--color-champagne-100)' : 'var(--color-ivory-50)'}
                    stroke={
                      table.mine
                        ? 'var(--color-champagne-700)'
                        : table.honor
                          ? 'var(--color-champagne-500)'
                          : 'var(--color-champagne-300)'
                    }
                    strokeWidth={table.mine ? 0.1 : 0.05}
                  />
                )}

                {/* Nom : uniquement la table de l'invité, pour ne pas surcharger */}
                {table.mine ? (
                  <text
                    x={table.x}
                    y={table.y + 0.14}
                    textAnchor="middle"
                    fill="var(--color-ink-900)"
                    style={{ fontSize: 0.42, fontWeight: 600 }}
                  >
                    {table.name}
                  </text>
                ) : null}

                {/* Repère de la chaise attribuée, posé par-dessus le plateau */}
                {chair ? (
                  <circle
                    cx={table.x + chair.x}
                    cy={table.y + chair.y}
                    r={0.26}
                    fill="var(--color-champagne-700)"
                    stroke="var(--color-ivory-50)"
                    strokeWidth={0.07}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--color-ink-400)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: 'var(--color-champagne-700)' }}
            aria-hidden
          />
          {t('roomYourTable')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border"
            style={{ borderColor: 'var(--color-champagne-300)' }}
            aria-hidden
          />
          {t('roomOtherTable')}
        </span>
        <span className="font-mono">
          {t('roomDimensions', { width: room.widthM, length: room.lengthM })}
        </span>
      </figcaption>
    </figure>
  );
}
