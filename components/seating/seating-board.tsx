'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  AlertTriangle,
  GripVertical,
  LayoutGrid,
  Map as MapIcon,
  Plus,
  Printer,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  assignSeatAction,
  autoAssignGuestsAction,
  createTableAction,
  deleteTableAction,
  setSeatNumberAction,
  updateTableAction,
} from '@/app/[locale]/(app)/events/[eventId]/seating/actions';
import {
  applyMove,
  containerOf,
  defaultTablePos,
  UNASSIGNED,
  withOccupancy,
  type BoardState,
  type SeatGuest,
  type SeatingNotifications,
  type SeatingPlan,
  type SeatingPublication,
  type SeatTable,
} from '@/lib/seating/board';
import { SeatingCanvas, TABLE_DRAG_PREFIX } from '@/components/seating/seating-canvas';
import { SeatingPublishPanel } from '@/components/seating/seating-publish-panel';

const DEFAULT_CAPACITY = 8;
const POS_MAX = 4000;

function clampPos(n: number): number {
  return Math.max(0, Math.min(Math.round(n), POS_MAX));
}

interface Props {
  eventId: string;
  initial: SeatingPlan;
}

export function SeatingBoard({ eventId, initial }: Props) {
  const t = useTranslations('Seating');
  const [tables, setTables] = useState<SeatTable[]>(initial.tables);
  const [unassigned, setUnassigned] = useState<SeatGuest[]>(initial.unassigned);
  const [publication, setPublication] = useState<SeatingPublication>(initial.publication);
  const [notifications, setNotifications] = useState<SeatingNotifications>(initial.notifications);
  const [planStats, setPlanStats] = useState(initial.stats);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'list' | 'plan'>('list');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const activeGuest = useMemo<SeatGuest | null>(() => {
    if (!activeId) return null;
    return (
      unassigned.find((g) => g._id === activeId) ??
      tables.flatMap((tb) => tb.assigned).find((g) => g._id === activeId) ??
      null
    );
  }, [activeId, tables, unassigned]);

  const seatedSeats = tables.reduce((sum, tb) => sum + tb.occupancy, 0);
  const totalSeats = seatedSeats + unassigned.reduce((sum, g) => sum + g.seats, 0);

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const type = (event.active.data.current as { type?: string } | undefined)?.type;

    // Repositionnement d'une table (vue Plan) — basé sur le delta du drag.
    if (type === 'table') {
      const tableId = String(event.active.id).slice(TABLE_DRAG_PREFIX.length);
      const delta = event.delta;
      if (!delta || (delta.x === 0 && delta.y === 0)) return;
      const idx = tables.findIndex((tb) => tb._id === tableId);
      if (idx < 0) return;
      const current = tables[idx]!;
      const fb = defaultTablePos(idx);
      const posX = clampPos((current.posX ?? fb.x) + delta.x);
      const posY = clampPos((current.posY ?? fb.y) + delta.y);
      setTables((cur) => cur.map((tb) => (tb._id === tableId ? { ...tb, posX, posY } : tb)));
      void updateTableAction(tableId, { posX, posY }).then((res) => {
        if (!res.ok) setError(t('error'));
      });
      return;
    }

    // Assignation d'une personne vers une table ou la zone « non placés ».
    if (!event.over) return;
    const unitKey = String(event.active.id);
    const target = String(event.over.id);
    const state: BoardState = { tables, unassigned };
    if (containerOf(state, unitKey) === target) return;
    const unit =
      state.unassigned.find((u) => u._id === unitKey) ??
      state.tables.flatMap((tb) => tb.assigned).find((u) => u._id === unitKey);
    if (!unit) return;

    const next = applyMove(state, unitKey, target);
    setTables(next.tables);
    setUnassigned(next.unassigned);
    setError('');

    void assignSeatAction(
      eventId,
      unit.guestId,
      unit.memberIndex,
      target === UNASSIGNED ? null : target,
    ).then((res) => {
      if (!res.ok) {
        // Revert optimiste sur échec serveur.
        setTables(state.tables);
        setUnassigned(state.unassigned);
        setError(t('error'));
      }
    });
  }

  /** Remplace l'état local par la vérité serveur (opérations en masse). */
  function applyPlan(plan: SeatingPlan) {
    setTables(plan.tables);
    setUnassigned(plan.unassigned);
    setPublication(plan.publication);
    setNotifications(plan.notifications);
    setPlanStats(plan.stats);
  }

  async function handleAutoPlace() {
    setBusy(true);
    setError('');
    const res = await autoAssignGuestsAction(eventId);
    setBusy(false);
    if (res.ok) {
      applyPlan(res.plan);
    } else {
      setError(t('error'));
    }
  }

  /**
   * Numéro de chaise saisi à la main. On repart systématiquement du plan
   * serveur : poser quelqu'un sur une chaise occupée échange les deux
   * personnes, ce qu'un patch local ne saurait reproduire fidèlement.
   */
  async function handleSeatNumberChange(unit: SeatGuest, tableId: string, raw: string) {
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
    const next = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    if (next === unit.seatNumber) return;
    setBusy(true);
    setError('');
    const res = await setSeatNumberAction(eventId, unit.guestId, unit.memberIndex, tableId, next);
    setBusy(false);
    if (res.ok) applyPlan(res.plan);
    else setError(t('error'));
  }

  function handleToggleShape(tableId: string, next: 'round' | 'rect') {
    setTables((cur) => cur.map((tb) => (tb._id === tableId ? { ...tb, shape: next } : tb)));
    void updateTableAction(tableId, { shape: next }).then((res) => {
      if (!res.ok) setError(t('error'));
    });
  }

  function handleUnassignGuest(unitKey: string) {
    const state: BoardState = { tables, unassigned };
    if (containerOf(state, unitKey) === UNASSIGNED) return;
    const unit = state.tables.flatMap((tb) => tb.assigned).find((u) => u._id === unitKey);
    if (!unit) return;
    const next = applyMove(state, unitKey, UNASSIGNED);
    setTables(next.tables);
    setUnassigned(next.unassigned);
    void assignSeatAction(eventId, unit.guestId, unit.memberIndex, null).then((res) => {
      if (!res.ok) {
        setTables(state.tables);
        setUnassigned(state.unassigned);
        setError(t('error'));
      }
    });
  }

  async function handleAddTable() {
    setBusy(true);
    setError('');
    const res = await createTableAction(eventId);
    setBusy(false);
    if (res.ok && res.tableId) {
      setTables((prev) => [
        ...prev,
        withOccupancy({
          _id: res.tableId as string,
          name: t('defaultTableName', { n: prev.length + 1 }),
          capacity: DEFAULT_CAPACITY,
          order: prev.length,
          assigned: [],
          occupancy: 0,
          overCapacity: false,
          seatConflicts: [],
          unnumbered: 0,
        }),
      ]);
    } else {
      setError(t('error'));
    }
  }

  async function handleDeleteTable(tableId: string) {
    const table = tables.find((tb) => tb._id === tableId);
    if (!table) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('deleteConfirm', { name: table.name }))
    ) {
      return;
    }
    const prev = { tables, unassigned };
    setTables((cur) => cur.filter((tb) => tb._id !== tableId));
    setUnassigned((cur) => [...cur, ...table.assigned]);
    setError('');
    const res = await deleteTableAction(tableId);
    if (!res.ok) {
      setTables(prev.tables);
      setUnassigned(prev.unassigned);
      setError(t('error'));
    }
  }

  function handleCapacityChange(tableId: string, raw: string) {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 1) return;
    setTables((cur) =>
      cur.map((tb) => (tb._id === tableId ? withOccupancy({ ...tb, capacity: value }) : tb)),
    );
    void updateTableAction(tableId, { capacity: value }).then((res) => {
      if (!res.ok) setError(t('error'));
    });
  }

  const hasAttending = totalSeats > 0;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[color:var(--color-ink-500)]">
            {t('stats', {
              seated: seatedSeats,
              total: totalSeats,
              tables: tables.length,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-lg border border-[color:var(--color-border)] p-0.5"
              role="group"
            >
              <button
                type="button"
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                data-testid="view-list"
                className={`focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  view === 'list'
                    ? 'bg-[color:var(--color-ink-900)] text-white'
                    : 'text-[color:var(--color-ink-500)]'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('viewList')}
              </button>
              <button
                type="button"
                onClick={() => setView('plan')}
                aria-pressed={view === 'plan'}
                data-testid="view-plan"
                className={`focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  view === 'plan'
                    ? 'bg-[color:var(--color-ink-900)] text-white'
                    : 'text-[color:var(--color-ink-500)]'
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('viewPlan')}
              </button>
            </div>
            <Button
              type="button"
              size="md"
              variant="outline"
              onClick={handleAutoPlace}
              disabled={busy || unassigned.length === 0}
              data-testid="auto-place"
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
              {t('autoPlace')}
            </Button>
            <Link
              href={`/events/${eventId}/seating/print` as never}
              target="_blank"
              className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
              data-testid="print-plan"
            >
              <Printer className="h-4 w-4" strokeWidth={2} aria-hidden />
              {t('print')}
            </Link>
            <Button
              type="button"
              size="md"
              onClick={handleAddTable}
              disabled={busy}
              data-testid="add-table"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              {t('addTable')}
            </Button>
          </div>
        </div>

        {error ? (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/8 px-4 py-2.5 text-sm text-[color:var(--color-danger)]"
            role="alert"
          >
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="OK">
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        ) : null}

        {hasAttending ? (
          <SeatingPublishPanel
            eventId={eventId}
            publication={publication}
            notifications={notifications}
            stats={{
              seatConflicts: planStats.seatConflicts,
              unnumbered: planStats.unnumbered,
            }}
            onPlanRefreshed={applyPlan}
          />
        ) : null}

        {!hasAttending ? (
          <p className="rounded-2xl border border-dashed border-[color:var(--color-border)] px-4 py-10 text-center text-sm text-[color:var(--color-ink-500)]">
            {t('noAttending')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(220px,300px)_1fr]">
            <UnassignedColumn
              guests={unassigned}
              activeId={activeId}
              label={t('unassignedTitle')}
              emptyLabel={t('unassignedEmpty')}
              hint={t('unassignedHint')}
              seatLabel={t('seatLabel')}
            />

            {tables.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[color:var(--color-border)] px-4 py-10 text-center text-sm text-[color:var(--color-ink-500)]">
                {t('noTables')}
              </p>
            ) : view === 'plan' ? (
              <SeatingCanvas
                tables={tables}
                onUnassignGuest={handleUnassignGuest}
                onToggleShape={handleToggleShape}
                onDelete={handleDeleteTable}
                labels={{
                  shapeToggle: t('shapeToggle'),
                  del: t('deleteTable'),
                  unassign: t('clickToUnassign'),
                  empty: t('tableEmpty'),
                }}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {tables.map((table) => (
                  <TableCard
                    key={table._id}
                    table={table}
                    activeId={activeId}
                    onDelete={() => handleDeleteTable(table._id)}
                    onCapacityChange={(raw) => handleCapacityChange(table._id, raw)}
                    onSeatNumberChange={(unit, raw) =>
                      void handleSeatNumberChange(unit, table._id, raw)
                    }
                    numbering={publication.numbering}
                    labels={{
                      occupancy: t('occupancy', {
                        occupied: table.occupancy,
                        capacity: table.capacity,
                      }),
                      over: t('overCapacity'),
                      del: t('deleteTable'),
                      capacity: t('capacityLabel'),
                      empty: t('tableEmpty'),
                      seat: t('seatLabel'),
                      seatNumber: t('seatColumnLabel'),
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <DragOverlay>
        {activeGuest ? <GuestChip guest={activeGuest} overlay seatLabel={t('seatLabel')} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function UnassignedColumn({
  guests,
  activeId,
  label,
  emptyLabel,
  hint,
  seatLabel,
}: {
  guests: SeatGuest[];
  activeId: string | null;
  label: string;
  emptyLabel: string;
  hint: string;
  seatLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNASSIGNED });
  return (
    <section
      ref={setNodeRef}
      data-testid="unassigned-column"
      className={`flex flex-col gap-3 rounded-2xl border bg-[color:var(--color-surface)] p-4 transition-colors ${
        isOver
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5'
          : 'border-[color:var(--color-border)]'
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-[color:var(--color-ink-900)]">
          {label} · {guests.length}
        </h2>
        <p className="text-xs text-[color:var(--color-ink-500)]">{hint}</p>
      </div>
      <div className="flex flex-col gap-2">
        {guests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[color:var(--color-border)] px-3 py-6 text-center text-xs text-[color:var(--color-ink-500)]">
            {emptyLabel}
          </p>
        ) : (
          guests.map((g) => (
            <GuestChip key={g._id} guest={g} dimmed={activeId === g._id} seatLabel={seatLabel} />
          ))
        )}
      </div>
    </section>
  );
}

function TableCard({
  table,
  activeId,
  onDelete,
  onCapacityChange,
  onSeatNumberChange,
  numbering,
  labels,
}: {
  table: SeatTable;
  activeId: string | null;
  onDelete: () => void;
  onCapacityChange: (raw: string) => void;
  onSeatNumberChange: (unit: SeatGuest, raw: string) => void;
  numbering: 'table' | 'seat';
  labels: {
    occupancy: string;
    over: string;
    del: string;
    capacity: string;
    empty: string;
    seat: string;
    seatNumber: string;
  };
}) {
  // Chaises attribuées deux fois : signalées sur la puce concernée, pas
  // seulement dans le compteur global du panneau de publication.
  const conflicting = new Set(table.seatConflicts.flatMap((c) => c.unitIds));
  const { setNodeRef, isOver } = useDroppable({ id: table._id });
  return (
    <section
      ref={setNodeRef}
      data-testid="table-card"
      data-table-id={table._id}
      className={`flex flex-col gap-3 rounded-2xl border bg-[color:var(--color-surface)] p-4 transition-colors ${
        isOver
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5'
          : table.overCapacity
            ? 'border-[color:var(--color-danger)]/50'
            : 'border-[color:var(--color-border)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-[color:var(--color-ink-900)]">{table.name}</h3>
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              table.overCapacity
                ? 'text-[color:var(--color-danger)]'
                : 'text-[color:var(--color-ink-500)]'
            }`}
            data-testid="table-occupancy"
          >
            <Users className="h-3 w-3" strokeWidth={2} aria-hidden />
            {labels.occupancy}
            {table.overCapacity ? (
              <AlertTriangle
                className="h-3 w-3"
                strokeWidth={2}
                aria-hidden
                data-testid="over-capacity"
              />
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 text-xs text-[color:var(--color-ink-500)]">
            <span className="sr-only">{labels.capacity}</span>
            <input
              type="number"
              min={1}
              max={30}
              defaultValue={table.capacity}
              onBlur={(e) => onCapacityChange(e.target.value)}
              className="w-12 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-1.5 py-1 text-center text-xs"
              aria-label={labels.capacity}
              data-testid="table-capacity-input"
            />
          </label>
          <button
            type="button"
            onClick={onDelete}
            aria-label={labels.del}
            data-testid="delete-table"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--color-ink-500)] transition-colors hover:bg-[color:var(--color-danger)]/10 hover:text-[color:var(--color-danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex min-h-[3rem] flex-col gap-2">
        {table.assigned.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[color:var(--color-border)] px-3 py-4 text-center text-xs text-[color:var(--color-ink-500)]">
            {labels.empty}
          </p>
        ) : (
          table.assigned.map((g) => (
            <GuestChip
              key={g._id}
              guest={g}
              dimmed={activeId === g._id}
              seatLabel={labels.seat}
              seatNumberLabel={labels.seatNumber}
              capacity={table.capacity}
              conflicting={conflicting.has(g._id)}
              onSeatNumberChange={
                numbering === 'seat' ? (raw) => onSeatNumberChange(g, raw) : undefined
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function GuestChip({
  guest,
  dimmed,
  overlay,
  seatLabel,
  seatNumberLabel,
  capacity,
  conflicting,
  onSeatNumberChange,
}: {
  guest: SeatGuest;
  dimmed?: boolean;
  overlay?: boolean;
  seatLabel: string;
  /** Fournis uniquement pour une puce posée à une table. */
  seatNumberLabel?: string;
  capacity?: number;
  conflicting?: boolean;
  onSeatNumberChange?: (raw: string) => void;
}) {
  const t = useTranslations('Seating');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: guest._id,
    data: { type: 'guest' },
  });
  const plusOnes = guest.seats - 1;
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      data-testid="guest-chip"
      data-guest-id={guest._id}
      data-member-index={guest.memberIndex}
      className={`flex cursor-grab touch-none items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-ivory-100)] px-2.5 py-2 text-sm active:cursor-grabbing ${
        dimmed || isDragging ? 'opacity-40' : ''
      } ${overlay ? 'shadow-[var(--shadow-popover)]' : ''}`}
    >
      <GripVertical
        className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-500)]"
        strokeWidth={2}
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[color:var(--color-ink-900)]">{guest.fullName}</span>
        {guest.hostName ? (
          <span className="truncate text-[10px] text-[color:var(--color-ink-500)]">
            {t('guestOf', { host: guest.hostName })}
          </span>
        ) : null}
      </span>
      {plusOnes > 0 ? (
        <span className="shrink-0 rounded-full bg-[color:var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--color-ink-500)]">
          {seatLabel} {guest.seats}
        </span>
      ) : null}
      {onSeatNumberChange ? (
        <input
          type="number"
          min={1}
          max={capacity}
          defaultValue={guest.seatNumber ?? ''}
          aria-label={seatNumberLabel}
          data-testid="seat-number-input"
          data-unit-id={guest._id}
          // Sans ça, dnd-kit capte le pointeur et le champ ne prend jamais le
          // focus : la puce entière est une poignée de drag.
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={(e) => onSeatNumberChange(e.target.value)}
          className={`w-10 shrink-0 rounded-md border bg-[color:var(--color-surface)] px-1 py-0.5 text-center font-mono text-xs ${
            conflicting
              ? 'border-[color:var(--color-danger)] text-[color:var(--color-danger)]'
              : 'border-[color:var(--color-border)]'
          }`}
        />
      ) : null}
    </div>
  );
}
