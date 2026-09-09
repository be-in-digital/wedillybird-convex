'use client';
// Écran — Plan de table (espace couple self-serve). Éditeur de salle pseudo-3D :
// scène en perspective inclinable (Plan ↔ 3D), tout à l'échelle (mètres). Le pool
// d'invités dérive de la liste du mariage ; le couple ajoute des personnes, des
// tables (7 formes), des éléments de salle, et configure la salle (gabarit, dimensions,
// sol). Données mock — câblage Convex à venir.

import { useState, useRef, useEffect, useMemo, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Icon } from './icons';
import { McBtn } from './parts';
import { McModal, McField, McInput } from './modal';
import { mcDateShort } from './data';
import { SeatPublishCard } from './seat-publish-card';
import { seatGuestsView, useMonMariage } from '@/stores/mon-mariage';
import {
  BASE_PPM,
  TILT_3D,
  SEAT_CATS,
  SEAT_CAT_KEYS,
  TABLE_SHAPES,
  ELEMENT_KINDS,
  ROOM_TEMPLATES,
  FLOOR_KEYS,
  FLOOR_LABEL_KEYS,
  type SeatCatKey,
  type SeatTable,
  type SeatView,
  type RoomElement,
  type RoomConfig,
  type TableShape,
  type ElementKind,
  type FloorKind,
  type RoomTemplate,
  seatTotals,
  tableOccupancy,
  totalSeats,
  roomAreaM2,
  comfortPerGuest,
  comfortState,
  fmtM,
} from './seating-model';
import {
  PoolPanel,
  RoomStage,
  Inspector,
  AddPalette,
  AssignMenu,
  SeatList,
} from './seating-engine';

/* ---- liste d'invités du mariage → invités à placer ---- */

/* ---- géométrie ---- */
const snap = (m: number): number => Math.round(m * 4) / 4; // 0,25 m
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const norm = (d: number): number => ((Math.round(d) % 360) + 360) % 360;

let uid = 100;
const newId = (p: string): string => p + ++uid;

function buildElements(tpl: RoomTemplate): RoomElement[] {
  return tpl.elements.map((e) => {
    const spec = ELEMENT_KINDS[e.kind];
    return {
      id: newId('e'),
      kind: e.kind,
      x: e.x,
      y: e.y,
      w: e.w ?? spec.w,
      h: e.h ?? spec.h,
      rotation: e.rotation ?? 0,
    };
  });
}

interface DragInfo {
  guestId: string;
  fromTableId: string | null;
  name: string;
  cat: SeatCatKey;
  party: number;
}
interface DragState extends DragInfo {
  x: number;
  y: number;
}
type HitTarget = { kind: 'table'; id: string } | { kind: 'pool' } | null;
function hitTarget(x: number, y: number): HitTarget {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const tn = el.closest('[data-table-id]');
  if (tn) return { kind: 'table', id: tn.getAttribute('data-table-id') ?? '' };
  if (el.closest('[data-pool]')) return { kind: 'pool' };
  return null;
}

/* ============================ ÉCRAN ============================ */
export function SeatingScreen({ onNav }: { onNav?: (k: string) => void }) {
  const t = useTranslations('MonMariage.seating');
  const locale = useLocale();
  const ballroom = ROOM_TEMPLATES[0]!;

  const seatingUnlocked = useMonMariage((st) => st.event?.seatingUnlocked ?? false);
  const couple = useMonMariage((st) => st.couple);
  const storeGuestsRaw = useMonMariage((st) => st.guests);
  const tables = useMonMariage((st) => st.seatTables);
  const storeRoom = useMonMariage((st) => st.room);
  const patchTableLocal = useMonMariage((st) => st.patchSeatTableLocal);
  const addTableLocal = useMonMariage((st) => st.addSeatTableLocal);
  const persistTable = useMonMariage((st) => st.upsertSeatTable);
  const storeRemoveTable = useMonMariage((st) => st.removeSeatTable);
  const storeSaveRoom = useMonMariage((st) => st.saveRoom);
  const storeAssign = useMonMariage((st) => st.assignGuestTable);
  const storeAddGuest = useMonMariage((st) => st.addGuest);

  // Salle + éléments : état LOCAL (gestes fluides), seedé du store, persisté par
  // snapshots (saveRoomSoon) aux frontières d'interaction.
  const [room, setRoom] = useState<RoomConfig>(() =>
    storeRoom
      ? {
          name: storeRoom.name,
          widthM: storeRoom.widthM,
          lengthM: storeRoom.lengthM,
          floor: storeRoom.floor,
        }
      : {
          name: t('roomDefaultName'),
          widthM: ballroom.widthM,
          lengthM: ballroom.lengthM,
          floor: ballroom.floor,
        },
  );
  const [elements, setElements] = useState<RoomElement[]>(() =>
    storeRoom ? storeRoom.elements.map((e) => ({ ...e })) : buildElements(ballroom),
  );

  // Invités : dérivés du store (assignations incluses), déclinés exclus du pool.
  const guests = useMemo(
    () => seatGuestsView(storeGuestsRaw).filter((g) => g.status !== 'declined'),
    [storeGuestsRaw],
  );

  // refs snapshots pour la persistance débouncée (sync en effet — jamais au render)
  const roomRef = useRef(room);
  const elementsRef = useRef(elements);
  const tablesRef = useRef(tables);
  useEffect(() => {
    roomRef.current = room;
    elementsRef.current = elements;
    tablesRef.current = tables;
  }, [room, elements, tables]);
  const roomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRoomSoon = () => {
    if (roomTimer.current) clearTimeout(roomTimer.current);
    roomTimer.current = setTimeout(() => {
      roomTimer.current = null;
      void storeSaveRoom(roomRef.current, elementsRef.current);
    }, 600);
  };
  const tableTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const commitTableSoon = (id: string, isNew = false) => {
    const timers = tableTimers.current;
    if (timers[id]) clearTimeout(timers[id]);
    timers[id] = setTimeout(() => {
      delete timers[id];
      const tb = tablesRef.current.find((x) => x.id === id);
      if (!tb) return;
      void persistTable(tb, isNew).then((realId) => {
        if (isNew && realId && realId !== id) {
          setSelectedId((sel) => (sel === id ? realId : sel));
        }
      });
    }, 350);
  };

  const [view, setView] = useState<SeatView>({ x: 60, y: 30, k: 0.82, mode: '3d' });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SeatCatKey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; cant: boolean } | null>(null);
  const [palette, setPalette] = useState<{
    mode: 'table' | 'element';
    x: number;
    y: number;
  } | null>(null);
  const [assignMenu, setAssignMenu] = useState<{ guestId: string; x: number; y: number } | null>(
    null,
  );
  const [personDialog, setPersonDialog] = useState(false);
  const [roomDialog, setRoomDialog] = useState(false);
  const [autoPlacing, setAutoPlacing] = useState(false);

  const liveRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const announce = (m: string) => {
    if (liveRef.current) liveRef.current.textContent = m;
  };

  // centre la salle au montage
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const k = 0.82;
    setView((v) => ({
      ...v,
      k,
      x: Math.round((rect.width - room.widthM * BASE_PPM * k) / 2),
      y: Math.round((rect.height - room.lengthM * BASE_PPM * k) / 2.4),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = seatTotals(guests);
  const seatsTotal = totalSeats(tables);
  const area = roomAreaM2(room);
  const comfort = comfortPerGuest(room, totals.total);
  const comfortSt = comfortState(comfort);
  const selTable = tables.find((x) => x.id === selectedId) || null;
  const selElement = elements.find((x) => x.id === selectedId) || null;

  /* ---- placement d'un invité ---- */
  const assign = (guestId: string, tableId: string | null): boolean => {
    const g = guests.find((x) => x.id === guestId);
    if (!g) return false;
    if (tableId) {
      const occ = tableOccupancy(guests, tableId) - (g.tableId === tableId ? g.partySize : 0);
      const cap = tables.find((tb) => tb.id === tableId)?.capacity ?? 0;
      if (occ + g.partySize > cap) {
        announce(t('announceCapacityExceeded', { occ: occ + g.partySize, cap }));
        return false;
      }
    }
    void storeAssign(guestId, tableId);
    return true;
  };

  /* ---- mutations table (optimiste store + persistance débouncée) ---- */
  const patchTable = (id: string, patch: Partial<SeatTable>) => {
    patchTableLocal(id, patch);
    commitTableSoon(id);
  };
  const onShape = (id: string, shape: TableShape) => {
    const spec = TABLE_SHAPES[shape];
    const tb = tables.find((x) => x.id === id);
    if (!tb) return;
    patchTable(id, {
      shape,
      capacity: spec.fixedCap ? spec.defaultCap : clamp(tb.capacity, spec.minCap, spec.maxCap),
      honor: shape === 'sweetheart' ? true : tb.honor,
    });
  };
  const dupObject = (id: string) => {
    const tb = tables.find((x) => x.id === id);
    if (tb) {
      const nid = newId('T');
      addTableLocal({
        ...tb,
        id: nid,
        label: t('copyLabel', { label: tb.label }),
        x: clamp(tb.x + 1.5, 0, room.widthM),
        y: clamp(tb.y + 1.5, 0, room.lengthM),
      });
      commitTableSoon(nid, true);
      setSelectedId(nid);
    }
    const el = elements.find((x) => x.id === id);
    if (el) {
      const nid = newId('e');
      setElements((es) => [
        ...es,
        {
          ...el,
          id: nid,
          x: clamp(el.x + 1.5, 0, room.widthM),
          y: clamp(el.y + 1.5, 0, room.lengthM),
        },
      ]);
      setSelectedId(nid);
      saveRoomSoon();
    }
  };
  const delObject = (id: string) => {
    if (tables.some((tb) => tb.id === id)) {
      void storeRemoveTable(id); // désassigne aussi les invités posés dessus
    } else if (elements.some((e) => e.id === id)) {
      setElements((es) => es.filter((e) => e.id !== id));
      saveRoomSoon();
    }
    if (selectedId === id) setSelectedId(null);
    announce(t('announceDeleted'));
  };

  /* ---- ajout ---- */
  const addTable = (shape: TableShape) => {
    const spec = TABLE_SHAPES[shape];
    const nid = newId('T');
    const n = tables.length + 1;
    addTableLocal({
      id: nid,
      label: t('tableN', { n }),
      shape,
      capacity: spec.defaultCap,
      x: clamp(room.widthM / 2 + ((n % 3) - 1) * 1.6, 1, room.widthM - 1),
      y: clamp(room.lengthM / 2 + ((n % 2) - 0.5) * 1.6, 1, room.lengthM - 1),
      rotation: 0,
      ...(shape === 'sweetheart' ? { honor: true } : {}),
    });
    commitTableSoon(nid, true);
    setSelectedId(nid);
    setPalette(null);
  };
  const addElement = (kind: ElementKind) => {
    const spec = ELEMENT_KINDS[kind];
    const nid = newId('e');
    const n = elements.length + 1;
    setElements((es) => [
      ...es,
      {
        id: nid,
        kind,
        x: clamp(room.widthM / 2 + ((n % 3) - 1) * 1.2, 1, room.widthM - 1),
        y: clamp(room.lengthM / 2 + ((n % 2) - 0.5) * 1.2, 1, room.lengthM - 1),
        w: spec.w,
        h: spec.h,
        rotation: 0,
      },
    ]);
    setSelectedId(nid);
    setPalette(null);
    saveRoomSoon();
  };
  const addPerson = (name: string, party: number, cat: SeatCatKey) => {
    void storeAddGuest({ fullName: name, category: cat, plusOnesAllowed: Math.max(0, party - 1) });
    announce(t('announcePersonAdded', { name }));
  };

  /* ---- placement auto (regroupe par catégorie) ---- */
  const autoPlace = () => {
    setAutoPlacing(true);
    setTimeout(() => {
      const occ: Record<string, number> = {};
      tablesRef.current.forEach((tb) => (occ[tb.id] = 0));
      guests.forEach((g) => {
        if (g.tableId) occ[g.tableId] = (occ[g.tableId] ?? 0) + g.partySize;
      });
      const order = SEAT_CAT_KEYS;
      const pool = guests
        .filter((g) => !g.tableId)
        .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
      let placed = 0;
      for (const g of pool) {
        const tb = tablesRef.current.find((x) => (occ[x.id] ?? 0) + g.partySize <= x.capacity);
        if (tb) {
          occ[tb.id] = (occ[tb.id] ?? 0) + g.partySize;
          placed++;
          void storeAssign(g.id, tb.id);
        }
      }
      announce(t('announceAutoPlaced', { count: placed }));
      setAutoPlacing(false);
    }, 700);
  };

  /* ---- drag d'un invité (pool ↔ table) ---- */
  const startDragGuest = (guestId: string, fromTableId: string | null, e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    const g = guests.find((x) => x.id === guestId);
    if (!g) return;
    e.preventDefault();
    setDrag({
      guestId,
      fromTableId,
      name: g.name,
      cat: g.category,
      party: g.partySize,
      x: e.clientX,
      y: e.clientY,
    });
    const move = (ev: PointerEvent) => {
      const tgt = hitTarget(ev.clientX, ev.clientY);
      let dt: { id: string; cant: boolean } | null = null;
      if (tgt && tgt.kind === 'table') {
        const occ = tableOccupancy(guests, tgt.id) - (g.tableId === tgt.id ? g.partySize : 0);
        const cap = tables.find((tb) => tb.id === tgt.id)?.capacity ?? 0;
        dt = { id: tgt.id, cant: occ + g.partySize > cap };
      }
      setDropTarget(dt);
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
    };
    const up = (ev: PointerEvent) => {
      const tgt = hitTarget(ev.clientX, ev.clientY);
      if (tgt && tgt.kind === 'table') assign(guestId, tgt.id);
      else if (tgt && tgt.kind === 'pool') assign(guestId, null);
      setDrag(null);
      setDropTarget(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---- déplacement d'un objet (table/élément) à l'échelle ---- */
  const moveObject = (id: string, kind: 'table' | 'element', e: React.PointerEvent) => {
    e.preventDefault();
    const src =
      kind === 'table' ? tables.find((x) => x.id === id) : elements.find((x) => x.id === id);
    if (!src) return;
    const sx = e.clientX,
      sy = e.clientY,
      ox = src.x,
      oy = src.y,
      k = view.k;
    const cosT = view.mode === '3d' ? Math.cos((TILT_3D * Math.PI) / 180) : 1;
    const move = (ev: PointerEvent) => {
      const dxM = (ev.clientX - sx) / (BASE_PPM * k);
      const dyM = (ev.clientY - sy) / (BASE_PPM * k * cosT);
      const nx = clamp(snap(ox + dxM), 0, room.widthM);
      const ny = clamp(snap(oy + dyM), 0, room.lengthM);
      // pendant le geste : uniquement l'état local (pas d'aller-retour réseau)
      if (kind === 'table') patchTableLocal(id, { x: nx, y: ny });
      else setElements((es) => es.map((el) => (el.id === id ? { ...el, x: nx, y: ny } : el)));
    };
    const up = () => {
      // persistance au lâcher
      if (kind === 'table') commitTableSoon(id);
      else saveRoomSoon();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---- configuration de la salle ---- */
  const applyTemplate = (tpl: RoomTemplate) => {
    const nextRoom = {
      ...roomRef.current,
      widthM: tpl.widthM,
      lengthM: tpl.lengthM,
      floor: tpl.floor,
    };
    const nextElements = buildElements(tpl);
    setRoom(nextRoom);
    setElements(nextElements);
    void storeSaveRoom(nextRoom, nextElements);
    announce(t('announceTemplate', { name: t(tpl.nameKey) }));
  };

  /* ---- ouvertures ---- */
  const toggleFilter = (k: SeatCatKey) =>
    setFilters((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  const openPalette = (mode: 'table' | 'element', e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPalette({ mode, x: r.left, y: r.bottom + 6 });
  };
  const openAssign = (guestId: string, e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAssignMenu({ guestId, x: r.right - 220, y: r.bottom + 4 });
  };
  const recenter = () => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setView((v) => ({
      ...v,
      x: Math.round((rect.width - room.widthM * BASE_PPM * v.k) / 2),
      y: Math.round((rect.height - room.lengthM * BASE_PPM * v.k) / 2.4),
    }));
  };

  const assignGuest = assignMenu ? guests.find((g) => g.id === assignMenu.guestId) : null;
  const inspectOpen = !!(selTable || selElement);

  if (!seatingUnlocked) {
    return (
      <>
        <header className="mc-pagehead">
          <div className="ph-l">
            <span className="mc-eyebrow">{t('eyebrow')}</span>
            <h1>{t('title')}</h1>
          </div>
          <p className="ph-sub">{t('subtitle')}</p>
        </header>
        <section className="mc-card feature">
          <div className="mc-empty">
            <span className="ill">
              <Icon name="Armchair" size={32} stroke={1.7} />
            </span>
            <h3>{t('locked.title')}</h3>
            <p>{t('locked.body')}</p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <McBtn variant="halo" size="lg" onClick={() => onNav?.('forfait')}>
                <Icon name="Sparkles" size={16} stroke={1.9} />
                {t('locked.cta')}
              </McBtn>
            </div>
          </div>
        </section>
      </>
    );
  }
  const coupleNames = couple?.names ?? '';
  const coupleA = (coupleNames.split('&')[0] ?? '').trim();
  const coupleB = (coupleNames.split('&')[1] ?? '').trim();

  return (
    <>
      <header className="mc-pagehead">
        <div className="ph-l">
          <span className="mc-eyebrow">{t('eyebrow')}</span>
          <h1>{t('title')}</h1>
        </div>
        <p className="ph-sub">{t('subtitle')}</p>
      </header>

      <div className="mc-card seat-editor anim" style={{ overflow: 'hidden', padding: 0 }}>
        {/* barre d'outils */}
        <div className="seat-bar">
          <span className="seat-bar-ctx">
            <span className="ev">
              {coupleA} <span className="amp">&amp;</span> {coupleB}
            </span>
            <span className="dt">
              {couple ? mcDateShort(couple.weddingDate, locale) : ''} ·{' '}
              {t('seatedRatio', { seated: totals.seated, total: totals.total })}
            </span>
          </span>

          <span className="seat-bar-grow" />

          <div className="seat-viewseg" role="group" aria-label={t('viewLabel')}>
            <button
              className={view.mode === 'plan' ? 'on' : ''}
              onClick={() => setView((v) => ({ ...v, mode: 'plan' }))}
              aria-pressed={view.mode === 'plan'}
            >
              <Icon name="LayoutGrid" size={14} stroke={1.9} />
              {t('viewPlan')}
            </button>
            <button
              className={view.mode === '3d' ? 'on' : ''}
              onClick={() => setView((v) => ({ ...v, mode: '3d' }))}
              aria-pressed={view.mode === '3d'}
            >
              <Icon name="Sparkles" size={14} stroke={1.9} />
              {t('view3d')}
            </button>
          </div>

          <span className="seat-tb-sep" />

          <button className="seat-tbtn" onClick={(e) => openPalette('table', e)}>
            <Icon name="Plus" size={15} stroke={2.1} />
            {t('addTable')}
          </button>
          <button className="seat-tbtn" onClick={(e) => openPalette('element', e)}>
            <Icon name="Sparkles" size={14} stroke={1.9} />
            {t('addElement')}
          </button>
          <button className="seat-tbtn" onClick={autoPlace} disabled={autoPlacing}>
            <Icon
              name={autoPlacing ? 'Loader' : 'Wand2'}
              size={14}
              stroke={1.9}
              className={autoPlacing ? 'spin' : ''}
            />
            {t('autoPlace')}
          </button>
          <button className="seat-tbtn" onClick={() => setRoomDialog(true)}>
            <Icon name="Settings" size={14} stroke={1.9} />
            {t('roomSetup')}
          </button>
          <button
            className="seat-tbtn seat-bar-icon"
            onClick={recenter}
            aria-label={t('recenter')}
            title={t('recenter')}
          >
            <Icon name="Maximize2" size={15} stroke={1.9} />
          </button>
        </div>

        {/* statistiques */}
        <div className="seat-stats">
          <div className="seat-stat">
            <span className="si">
              <Icon name="UsersRound" size={17} stroke={1.9} />
            </span>
            <span className="st">
              <b>
                {totals.seated}
                <em> / {totals.total}</em>
              </b>
              <span>{t('statSeated')}</span>
            </span>
          </div>
          <div className="seat-stat gold">
            <span className="si">
              <Icon name="Armchair" size={17} stroke={1.9} />
            </span>
            <span className="st">
              <b>{seatsTotal}</b>
              <span>{t('statSeats', { tables: tables.length })}</span>
            </span>
          </div>
          <div className="seat-stat">
            <span className="si">
              <Icon name="LayoutGrid" size={16} stroke={1.9} />
            </span>
            <span className="st">
              <b>
                {fmtM(area)}
                <em> m²</em>
              </b>
              <span>{t('statArea')}</span>
            </span>
          </div>
          <div className="seat-stat sage">
            <span className="si">
              <Icon name="Sparkles" size={16} stroke={1.9} />
            </span>
            <span className="st">
              <b className={comfortSt}>
                {fmtM(comfort)}
                <em> m²</em>
              </b>
              <span>{t('statComfort_' + comfortSt)}</span>
            </span>
          </div>
        </div>

        {/* aperçu mobile (lecture seule) */}
        <div className="seat-mobile-only">
          <SeatList room={room} tables={tables} guests={guests} />
        </div>

        {/* zone éditeur */}
        <div className={'seat-work' + (inspectOpen ? ' inspect' : '')}>
          <PoolPanel
            guests={guests}
            totals={totals}
            search={search}
            setSearch={setSearch}
            filters={filters}
            toggleFilter={toggleFilter}
            onChipDown={startDragGuest}
            onAssign={openAssign}
            onAddPerson={() => setPersonDialog(true)}
            dropping={!!(drag && drag.fromTableId)}
          />
          <RoomStage
            room={room}
            tables={tables}
            elements={elements}
            guests={guests}
            selectedId={selectedId}
            dropTargetId={dropTarget ? dropTarget.id : null}
            dropCant={dropTarget ? dropTarget.cant : null}
            view={view}
            setView={setView}
            stageRef={stageRef}
            onSelect={setSelectedId}
            onSelectNone={() => setSelectedId(null)}
            onMoveTable={(id, e) => moveObject(id, 'table', e)}
            onMoveElement={(id, e) => moveObject(id, 'element', e)}
            onChairDown={(gid, _tid, e) => startDragGuest(gid, _tid, e)}
          />
          <Inspector
            table={selTable}
            element={selElement}
            guests={guests}
            onClose={() => setSelectedId(null)}
            onRenameTable={(id, label) => patchTable(id, { label })}
            onShape={onShape}
            onCap={(id, capacity) => patchTable(id, { capacity })}
            onRotate={(id, deg) => {
              if (tables.some((x) => x.id === id)) patchTable(id, { rotation: norm(deg) });
              else {
                setElements((es) =>
                  es.map((el) => (el.id === id ? { ...el, rotation: norm(deg) } : el)),
                );
                saveRoomSoon();
              }
            }}
            onHonor={(id, honor) => patchTable(id, { honor })}
            onNotes={(id, notes) => patchTable(id, { notes })}
            onRemoveGuest={(gid) => assign(gid, null)}
            onDuplicate={dupObject}
            onDelete={delObject}
            onChairDown={(gid, tid, e) => startDragGuest(gid, tid, e)}
            onResize={(id, w, h) => {
              setElements((es) => es.map((el) => (el.id === id ? { ...el, w, h } : el)));
              saveRoomSoon();
            }}
          />
        </div>
      </div>

      {/* Publication du plan aux invités — validation explicite avant tout envoi */}
      <SeatPublishCard />

      {/* fantôme de drag */}
      {drag && (
        <div
          className="seat-ghost gchip"
          style={
            {
              left: drag.x,
              top: drag.y,
              width: 218,
              '--cat': SEAT_CATS[drag.cat].color,
              '--cat-soft': SEAT_CATS[drag.cat].soft,
              '--cat-ink': SEAT_CATS[drag.cat].ink,
            } as CSSProperties
          }
        >
          <span className="gchip-av">{drag.name.slice(0, 2).toUpperCase()}</span>
          <span className="gchip-main">
            <span className="gchip-name">{drag.name}</span>
            <span className="gchip-meta">
              <span className="gchip-party">
                <Icon name="Users" size={10} stroke={2} />
                <b>{drag.party}</b>
              </span>
            </span>
          </span>
        </div>
      )}

      {/* popovers */}
      {palette && (
        <AddPalette
          mode={palette.mode}
          pos={palette}
          onPickShape={addTable}
          onPickElement={addElement}
          onClose={() => setPalette(null)}
        />
      )}
      {assignMenu && assignGuest && (
        <AssignMenu
          guest={assignGuest}
          tables={tables}
          guests={guests}
          pos={assignMenu}
          onClose={() => setAssignMenu(null)}
          onPick={(tid) => {
            assign(assignMenu.guestId, tid);
            setAssignMenu(null);
          }}
        />
      )}

      {/* modales */}
      {personDialog && <AddPersonDialog onClose={() => setPersonDialog(false)} onAdd={addPerson} />}
      {roomDialog && (
        <RoomSetupDialog
          room={room}
          onClose={() => {
            setRoomDialog(false);
            saveRoomSoon();
          }}
          onName={(name) => setRoom((r) => ({ ...r, name }))}
          onDims={(w, l) => setRoom((r) => ({ ...r, widthM: w, lengthM: l }))}
          onFloor={(floor) => setRoom((r) => ({ ...r, floor }))}
          onTemplate={applyTemplate}
        />
      )}

      <span ref={liveRef} className="sr-only" role="status" aria-live="polite" />
    </>
  );
}

/* ============================ MODALE — AJOUTER UNE PERSONNE ============================ */
function AddPersonDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string, party: number, cat: SeatCatKey) => void;
}) {
  const t = useTranslations('MonMariage.seating');
  const tRoot = useTranslations('MonMariage');
  const [name, setName] = useState('');
  const [party, setParty] = useState(1);
  const [cat, setCat] = useState<SeatCatKey>('family');
  const submit = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), party, cat);
    onClose();
  };
  return (
    <McModal
      eyebrow={t('eyebrow')}
      title={t('addPerson')}
      onClose={onClose}
      footer={
        <>
          <McBtn variant="ghost" size="md" onClick={onClose}>
            {t('cancel')}
          </McBtn>
          <McBtn variant="halo" size="md" onClick={submit}>
            <Icon name="UserPlus" size={16} stroke={2} />
            {t('addToList')}
          </McBtn>
        </>
      }
    >
      <div className="mc-formgrid">
        <McField label={t('nameLabel')} hint={t('nameHint')} full>
          <McInput
            icon="Users"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            autoFocus
          />
        </McField>
        <McField label={t('categoryLabel')}>
          <div className="ins-shapes" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {SEAT_CAT_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className={'ins-shape' + (cat === k ? ' on' : '')}
                onClick={() => setCat(k)}
                style={{ flexDirection: 'row', justifyContent: 'center', gap: 7 }}
              >
                <span
                  style={{ width: 9, height: 9, borderRadius: 3, background: SEAT_CATS[k].color }}
                />
                {tRoot(SEAT_CATS[k].short.replace(/^MonMariage\./, ''))}
              </button>
            ))}
          </div>
        </McField>
        <McField label={t('peopleCountLabel')}>
          <div className="ins-stepper">
            <button
              type="button"
              onClick={() => setParty((p) => Math.max(1, p - 1))}
              aria-label={t('decrease')}
            >
              <Icon name="Minus" size={16} stroke={2} />
            </button>
            <span className="v">{party}</span>
            <button type="button" onClick={() => setParty((p) => p + 1)} aria-label={t('increase')}>
              <Icon name="Plus" size={16} stroke={2} />
            </button>
          </div>
        </McField>
      </div>
    </McModal>
  );
}

/* ============================ MODALE — CONFIGURER LA SALLE ============================ */
function RoomSetupDialog({
  room,
  onClose,
  onName,
  onDims,
  onFloor,
  onTemplate,
}: {
  room: RoomConfig;
  onClose: () => void;
  onName: (name: string) => void;
  onDims: (w: number, l: number) => void;
  onFloor: (f: FloorKind) => void;
  onTemplate: (tpl: RoomTemplate) => void;
}) {
  const t = useTranslations('MonMariage.seating');
  return (
    <McModal
      eyebrow={t('eyebrow')}
      title={t('roomSetup')}
      onClose={onClose}
      wide
      footer={
        <McBtn variant="halo" size="md" onClick={onClose}>
          {t('done')}
        </McBtn>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <McField label={t('roomNameLabel')} full>
          <McInput
            icon="MapPin"
            value={room.name}
            onChange={(e) => onName(e.target.value)}
            placeholder={t('roomNamePlaceholder')}
          />
        </McField>

        <div>
          <span className="ins-lab" style={{ display: 'block', marginBottom: 9 }}>
            {t('templatesLabel')}
          </span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
              gap: 9,
            }}
          >
            {ROOM_TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                className="palette-item"
                onClick={() => onTemplate(tpl)}
              >
                <span className="pic">
                  <Icon name={tpl.icon} size={20} stroke={1.6} />
                </span>
                {t(tpl.nameKey)}
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--color-muted-foreground)',
                  }}
                >
                  {fmtM(tpl.widthM)}×{fmtM(tpl.lengthM)} m
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="ins-grid2">
          <McField label={t('roomWidthLabel')}>
            <div className="ins-stepper">
              <button
                type="button"
                onClick={() => onDims(Math.max(6, room.widthM - 1), room.lengthM)}
                aria-label={t('decrease')}
              >
                <Icon name="Minus" size={16} stroke={2} />
              </button>
              <span className="v">{fmtM(room.widthM)}</span>
              <button
                type="button"
                onClick={() => onDims(Math.min(40, room.widthM + 1), room.lengthM)}
                aria-label={t('increase')}
              >
                <Icon name="Plus" size={16} stroke={2} />
              </button>
            </div>
          </McField>
          <McField label={t('roomLengthLabel')}>
            <div className="ins-stepper">
              <button
                type="button"
                onClick={() => onDims(room.widthM, Math.max(6, room.lengthM - 1))}
                aria-label={t('decrease')}
              >
                <Icon name="Minus" size={16} stroke={2} />
              </button>
              <span className="v">{fmtM(room.lengthM)}</span>
              <button
                type="button"
                onClick={() => onDims(room.widthM, Math.min(40, room.lengthM + 1))}
                aria-label={t('increase')}
              >
                <Icon name="Plus" size={16} stroke={2} />
              </button>
            </div>
          </McField>
        </div>

        <div>
          <span className="ins-lab" style={{ display: 'block', marginBottom: 9 }}>
            {t('floorLabel')}
          </span>
          <div className="seat-filters">
            {FLOOR_KEYS.map((f) => (
              <button
                key={f}
                type="button"
                className={'seat-fchip' + (room.floor === f ? ' on' : '')}
                style={
                  {
                    '--cat': 'var(--color-gold-500)',
                    '--cat-soft': 'var(--color-accent-soft)',
                  } as CSSProperties
                }
                onClick={() => onFloor(f)}
                aria-pressed={room.floor === f}
              >
                {t(FLOOR_LABEL_KEYS[f])}
              </button>
            ))}
          </div>
        </div>
      </div>
    </McModal>
  );
}
