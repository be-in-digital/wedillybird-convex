// Store Zustand de l'espace couple « /mon-mariage » — source de vérité CLIENT.
// Hydraté une fois depuis le bundle Convex (RSC), puis muté de façon OPTIMISTE :
// l'état local change immédiatement, la server action persiste en arrière-plan,
// et on revert + toast en cas d'échec. Les vues (donut RSVP, postes budget,
// rétroplanning léger) se dérivent des slices via les sélecteurs exportés.

import { create } from 'zustand';
import type {
  McActive,
  McCouple,
  McGuest,
  McPayment,
  McPhase,
  McVendor,
} from '@/components/mon-mariage/data';
import type {
  CeremonyStep,
  MmBundle,
  MmEvent,
  MmGuest,
  MmInvoice,
  MmReferral,
  MmRoom,
  MmSeatingNotifications,
} from '@/lib/mon-mariage/types';
import {
  activeFromEvent,
  coupleFromEvent,
  fromIsoDate,
  guestFromMm,
  paymentFromMm,
  phasesFromMm,
  seatGuestFromMm,
  seatTableFromMm,
  toMajor,
  toMinor,
  usageFromBundle,
  vendorFromMm,
} from '@/lib/mon-mariage/adapt';
import type { McUsage } from '@/components/mon-mariage/data';
import type { RoomConfig, RoomElement, SeatTable } from '@/components/mon-mariage/seating-model';
import type { CoupleTaskStatus, CoupleVendorStatus } from '@/convex/lib/coupleModel';
import { useUIStore } from '@/stores/ui-store';
import {
  mmAddGuestAction,
  mmAddPaymentAction,
  mmAddPhaseAction,
  mmAddTaskAction,
  mmAddVendorAction,
  mmAssignGuestTableAction,
  mmAutoNumberSeatsAction,
  mmBroadcastSeatPassesAction,
  mmEnsurePlanningAction,
  mmRefreshBundleAction,
  mmRemovePaymentAction,
  mmRemoveTableAction,
  mmRemoveTaskAction,
  mmRemoveVendorAction,
  mmSaveRoomAction,
  mmSetBudgetEnvelopeAction,
  mmSetCeremonyScheduleAction,
  mmSetInvitationDesignAction,
  mmSetPaymentPaidAction,
  mmSetSeatingPublicationAction,
  mmSetTaskStatusAction,
  mmUpdateVendorAction,
  mmUpsertTableAction,
} from '@/app/[locale]/(app)/mon-mariage/actions';

/** Toast d'erreur générique (le libellé i18n est résolu par le composant Toasts). */
function failToast() {
  useUIStore.getState().pushToast({ title: 'MonMariage.common.saveError', variant: 'error' });
}

let tempSeq = 0;
const tempId = () => `mm-tmp-${++tempSeq}`;

export interface MonMariageState {
  hydrated: boolean;
  /** Mode démo (/capture-mm) : mutations optimistes locales, aucune server action. */
  demo: boolean;
  /** Horloge serveur au chargement (hydration-safe pour les J−). */
  now: number;
  event: MmEvent | null;
  couple: McCouple | null;
  active: McActive | null;
  usage: McUsage;
  /** Invités BRUTS (avec tableId) — les vues McGuest/SeatGuest se dérivent via les sélecteurs. */
  guests: MmGuest[];
  vendors: McVendor[];
  payments: McPayment[];
  phases: McPhase[];
  /** Enveloppe budget en unités MAJEURES (null = pas encore fixée). */
  budgetTotal: number | null;
  seatTables: SeatTable[];
  room: MmRoom | null;
  invoices: MmInvoice[];
  /** Parrainage : code du couple + crédit disponible (récompenses vested). */
  referral: MmReferral | null;
  /** File d'envoi des pass placement (recalculée à chaque bundle). */
  seatingNotifications: MmSeatingNotifications;

  hydrate: (bundle: MmBundle | null, now: number) => void;
  refresh: () => Promise<void>;

  addGuest: (input: {
    fullName: string;
    phone?: string;
    category?: string;
    plusOnesAllowed: number;
  }) => Promise<boolean>;

  addVendor: (v: Omit<McVendor, 'id'>) => Promise<void>;
  updateVendor: (id: string, patch: Partial<Omit<McVendor, 'id'>>) => Promise<void>;
  removeVendor: (id: string) => Promise<void>;

  addPayment: (p: {
    vendorName: string;
    category: string;
    kind: 'deposit' | 'balance' | 'other';
    dueIso: string;
    amount: number;
  }) => Promise<void>;
  setPaymentPaid: (
    id: string,
    paidAmount: number,
    payIso?: string,
    factures?: Array<{ name: string; kind: string }>,
  ) => Promise<void>;
  removePayment: (id: string) => Promise<void>;
  setBudgetTotal: (major: number) => Promise<void>;

  /** Cinématique + musique + photo de l'invitation publique (optimiste sur `event`). */
  setInvitationDesign: (input: {
    cinematic?: string;
    music?:
      | { source: 'library'; trackId: string }
      | { source: 'custom'; s3Key: string; title: string }
      | null;
    /** `url` = aperçu local (object URL) affiché immédiatement ; `s3Key` persisté. */
    photo?: { s3Key: string; url: string; width?: number; height?: number } | null;
  }) => Promise<void>;

  /** Déroulé de la journée affiché sur l'invitation (optimiste sur `event`). */
  setCeremonySchedule: (schedule: CeremonyStep[]) => Promise<void>;

  ensurePlanning: () => Promise<void>;
  addPhase: (label: string, sub?: string) => Promise<void>;
  addTask: (phaseId: string, label: string, dueIso?: string) => Promise<void>;
  setTaskStatus: (phaseId: string, taskId: string, status: CoupleTaskStatus) => Promise<void>;
  removeTask: (phaseId: string, taskId: string) => Promise<void>;

  /** Mutations LOCALES du plan (drag 60fps, saisie) — persistance via upsertSeatTable. */
  patchSeatTableLocal: (id: string, patch: Partial<SeatTable>) => void;
  addSeatTableLocal: (table: SeatTable) => void;
  /** Persiste la table (upsert idempotent) ; résout l'id réel Convex. */
  upsertSeatTable: (table: SeatTable, isNew: boolean) => Promise<string | null>;
  removeSeatTable: (tableId: string) => Promise<void>;
  assignGuestTable: (guestId: string, tableId: string | null) => Promise<void>;
  saveRoom: (config: RoomConfig, elements: RoomElement[]) => Promise<void>;
  /** Numérote les chaises puis recharge le bundle (les numéros viennent du serveur). */
  autoNumberSeats: (mode?: 'fill' | 'renumber') => Promise<number>;
  /** Publie / dépublie le plan pour les invités et enregistre les réglages. */
  setSeatingPublication: (input: {
    published: boolean;
    numbering?: 'table' | 'seat';
    showRoomPlan?: boolean;
    note?: string;
  }) => Promise<boolean>;
  /** Envoie les pass placement aux invités à (re)prévenir. */
  broadcastSeatPasses: (force?: boolean) => Promise<{ sent: number; failed: number } | null>;
}

const EMPTY_USAGE: McUsage = { guests: 0, storageGo: 0 };
const EMPTY_SEAT_NOTIFICATIONS: MmSeatingNotifications = {
  placedGuests: 0,
  notified: 0,
  needsNotify: 0,
};

export const useMonMariage = create<MonMariageState>()((set, get) => {
  function applyBundle(bundle: MmBundle | null, now: number) {
    if (!bundle) {
      set({
        hydrated: true,
        demo: false,
        now,
        event: null,
        couple: null,
        active: null,
        usage: EMPTY_USAGE,
        guests: [],
        vendors: [],
        payments: [],
        phases: [],
        budgetTotal: null,
        seatTables: [],
        room: null,
        invoices: [],
        referral: null,
        seatingNotifications: EMPTY_SEAT_NOTIFICATIONS,
      });
      return;
    }
    const tz = bundle.event.timezone;
    set({
      hydrated: true,
      demo: bundle.event.id.startsWith('demo-'),
      now,
      event: bundle.event,
      couple: coupleFromEvent(bundle.event),
      active: activeFromEvent(bundle.event),
      usage: usageFromBundle(bundle),
      guests: bundle.guests,
      vendors: bundle.vendors.map(vendorFromMm),
      payments: bundle.payments
        .map((p) => paymentFromMm(p, tz))
        .sort((a, b) => a.date.localeCompare(b.date)),
      phases: phasesFromMm(bundle.phases, tz),
      budgetTotal:
        bundle.event.budgetEnvelopeMinor != null ? toMajor(bundle.event.budgetEnvelopeMinor) : null,
      seatTables: bundle.tables.map(seatTableFromMm),
      room: bundle.room,
      invoices: bundle.invoices,
      referral: bundle.referral,
      seatingNotifications: bundle.seatingNotifications,
    });
  }

  return {
    hydrated: false,
    demo: false,
    now: 0,
    event: null,
    couple: null,
    active: null,
    usage: EMPTY_USAGE,
    guests: [],
    vendors: [],
    payments: [],
    phases: [],
    budgetTotal: null,
    seatTables: [],
    room: null,
    invoices: [],
    referral: null,
    seatingNotifications: EMPTY_SEAT_NOTIFICATIONS,

    hydrate: (bundle, now) => applyBundle(bundle, now),

    refresh: async () => {
      if (get().demo) return;
      const res = await mmRefreshBundleAction();
      if (res.ok) applyBundle(res.bundle, get().now || Date.now());
    },

    /* ============================ Invités ============================ */

    addGuest: async (input) => {
      const event = get().event;
      if (!event) return false;
      const id = tempId();
      const optimisticGuest: MmGuest = {
        id,
        fullName: input.fullName,
        phone: input.phone ?? null,
        category: input.category ?? null,
        plusOnesAllowed: input.plusOnesAllowed,
        rsvpStatus: 'pending',
        tableId: null,
        seatNumber: null,
      };
      const prevUsage = get().usage;
      set((s) => ({
        guests: [optimisticGuest, ...s.guests],
        usage: { ...s.usage, guests: s.usage.guests + 1 },
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmAddGuestAction(event.id, input);
      if (!res.ok) {
        set((s) => ({ guests: s.guests.filter((g) => g.id !== id), usage: prevUsage }));
        failToast();
        return false;
      }
      if (res.id) {
        const realId = res.id;
        set((s) => ({
          guests: s.guests.map((g) => (g.id === id ? { ...g, id: realId } : g)),
        }));
      }
      return true;
    },

    /* ============================ Prestataires ============================ */

    addVendor: async (v) => {
      const event = get().event;
      if (!event) return;
      const id = tempId();
      const prev = get().vendors;
      set((s) => ({ vendors: [...s.vendors, { ...v, id }] }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmAddVendorAction(event.id, {
            name: v.name,
            category: v.cat,
            status: v.status as CoupleVendorStatus,
            amountMinor: toMinor(v.amount),
            paidMinor: toMinor(v.paid),
            ...(v.contact ? { contact: v.contact } : {}),
            ...(v.email ? { email: v.email } : {}),
            ...(v.note ? { note: v.note } : {}),
            ...(v.attachments?.length
              ? { attachments: v.attachments.map((a) => ({ name: a.name, kind: a.kind })) }
              : {}),
          });
      if (!res.ok) {
        set({ vendors: prev });
        failToast();
        return;
      }
      if (res.id) {
        const realId = res.id;
        set((s) => ({ vendors: s.vendors.map((x) => (x.id === id ? { ...x, id: realId } : x)) }));
      }
    },

    updateVendor: async (id, patch) => {
      const prev = get().vendors;
      set((s) => ({ vendors: s.vendors.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmUpdateVendorAction(id, {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.cat !== undefined ? { category: patch.cat } : {}),
            ...(patch.status !== undefined ? { status: patch.status as CoupleVendorStatus } : {}),
            ...(patch.amount !== undefined ? { amountMinor: toMinor(patch.amount) } : {}),
            ...(patch.paid !== undefined ? { paidMinor: toMinor(patch.paid) } : {}),
            ...(patch.contact !== undefined ? { contact: patch.contact ?? '' } : {}),
            ...(patch.email !== undefined ? { email: patch.email ?? '' } : {}),
            ...(patch.note !== undefined ? { note: patch.note } : {}),
            ...(patch.attachments !== undefined
              ? { attachments: patch.attachments.map((a) => ({ name: a.name, kind: a.kind })) }
              : {}),
          });
      if (!res.ok) {
        set({ vendors: prev });
        failToast();
      }
    },

    removeVendor: async (id) => {
      const prev = get().vendors;
      set((s) => ({ vendors: s.vendors.filter((x) => x.id !== id) }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmRemoveVendorAction(id);
      if (!res.ok) {
        set({ vendors: prev });
        failToast();
      }
    },

    /* ============================ Budget ============================ */

    addPayment: async (p) => {
      const event = get().event;
      if (!event) return;
      const id = tempId();
      const prev = get().payments;
      const optimisticPayment: McPayment = {
        id,
        vendor: p.vendorName,
        cat: p.category as McPayment['cat'],
        kind: `MonMariage.data.paymentKind.${p.kind}`,
        date: p.dueIso,
        amount: p.amount,
        paid: false,
        payDate: null,
        factures: [],
      };
      set((s) => ({
        payments: [...s.payments, optimisticPayment].sort((a, b) => a.date.localeCompare(b.date)),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmAddPaymentAction(event.id, {
            vendorName: p.vendorName,
            category: p.category,
            kind: p.kind,
            dueDate: fromIsoDate(p.dueIso),
            amountMinor: toMinor(p.amount),
          });
      if (!res.ok) {
        set({ payments: prev });
        failToast();
        return;
      }
      if (res.id) {
        const realId = res.id;
        set((s) => ({ payments: s.payments.map((x) => (x.id === id ? { ...x, id: realId } : x)) }));
      }
    },

    setPaymentPaid: async (id, paidAmount, payIso, factures) => {
      const prev = get().payments;
      const target = prev.find((x) => x.id === id);
      if (!target) return;
      const fully = paidAmount >= target.amount;
      set((s) => ({
        payments: s.payments.map((x) =>
          x.id === id
            ? {
                ...x,
                paid: fully,
                ...(paidAmount > 0 && !fully ? { paidAmount } : { paidAmount: undefined }),
                payDate: paidAmount > 0 ? (payIso ?? x.date) : null,
              }
            : x,
        ),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmSetPaymentPaidAction(id, {
            paidMinor: toMinor(Math.min(paidAmount, target.amount)),
            ...(payIso ? { paidAt: fromIsoDate(payIso) } : {}),
            ...(factures ? { attachments: factures } : {}),
          });
      if (!res.ok) {
        set({ payments: prev });
        failToast();
      }
    },

    removePayment: async (id) => {
      const prev = get().payments;
      set((s) => ({ payments: s.payments.filter((x) => x.id !== id) }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmRemovePaymentAction(id);
      if (!res.ok) {
        set({ payments: prev });
        failToast();
      }
    },

    setBudgetTotal: async (major) => {
      const event = get().event;
      if (!event) return;
      const prev = get().budgetTotal;
      set({ budgetTotal: major });
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmSetBudgetEnvelopeAction(event.id, toMinor(major));
      if (!res.ok) {
        set({ budgetTotal: prev });
        failToast();
      }
    },

    setInvitationDesign: async (input) => {
      const event = get().event;
      if (!event) return;
      const next: MmEvent = {
        ...event,
        invitationCinematic:
          input.cinematic !== undefined
            ? input.cinematic === 'seal'
              ? null
              : input.cinematic
            : event.invitationCinematic,
        invitationMusic: input.music !== undefined ? input.music : event.invitationMusic,
        invitationPhoto:
          input.photo !== undefined
            ? input.photo
              ? { url: input.photo.url, width: input.photo.width, height: input.photo.height }
              : null
            : event.invitationPhoto,
      };
      set({ event: next });
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmSetInvitationDesignAction({
            eventId: event.id,
            cinematic: input.cinematic,
            music: input.music ?? undefined,
            clearMusic: input.music === null ? true : undefined,
            photo: input.photo
              ? { s3Key: input.photo.s3Key, width: input.photo.width, height: input.photo.height }
              : undefined,
            clearPhoto: input.photo === null ? true : undefined,
          });
      if (!res.ok) {
        set({ event });
        failToast();
      }
    },

    setCeremonySchedule: async (schedule) => {
      const event = get().event;
      if (!event) return;
      const cleaned = schedule
        .map((s) => ({
          time: s.time.trim(),
          title: s.title.trim(),
          note: s.note?.trim() || undefined,
        }))
        .filter((s) => s.title.length > 0 || s.time.length > 0)
        .slice(0, 20);
      set({ event: { ...event, ceremonySchedule: cleaned } });
      const res = get().demo
        ? ({ ok: true } as { ok: true })
        : await mmSetCeremonyScheduleAction({ eventId: event.id, schedule: cleaned });
      if (!res.ok) {
        set({ event });
        failToast();
      }
    },

    /* ============================ Rétroplanning ============================ */

    ensurePlanning: async () => {
      const { event, phases } = get();
      if (!event || phases.length > 0) return;
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmEnsurePlanningAction(event.id);
      if (res.ok) await get().refresh();
    },

    addPhase: async (label, sub) => {
      const event = get().event;
      if (!event) return;
      const id = tempId();
      const prev = get().phases;
      set((s) => ({
        phases: [...s.phases, { id, label, sub: sub ?? '', tasks: [] }],
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmAddPhaseAction(event.id, { label, ...(sub ? { sub } : {}) });
      if (!res.ok) {
        set({ phases: prev });
        failToast();
        return;
      }
      if (res.id) {
        const realId = res.id;
        set((s) => ({ phases: s.phases.map((p) => (p.id === id ? { ...p, id: realId } : p)) }));
      }
    },

    addTask: async (phaseId, label, dueIso) => {
      const id = tempId();
      const prev = get().phases;
      set((s) => ({
        phases: s.phases.map((p) =>
          p.id !== phaseId
            ? p
            : {
                ...p,
                tasks: [
                  ...p.tasks,
                  { id, label, status: 'todo', ...(dueIso ? { due: dueIso } : {}) },
                ],
              },
        ),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmAddTaskAction(phaseId, {
            label,
            ...(dueIso ? { dueDate: fromIsoDate(dueIso) } : {}),
          });
      if (!res.ok) {
        set({ phases: prev });
        failToast();
        return;
      }
      if (res.id) {
        const realId = res.id;
        set((s) => ({
          phases: s.phases.map((p) =>
            p.id !== phaseId
              ? p
              : { ...p, tasks: p.tasks.map((t) => (t.id === id ? { ...t, id: realId } : t)) },
          ),
        }));
      }
    },

    setTaskStatus: async (phaseId, taskId, status) => {
      const prev = get().phases;
      set((s) => ({
        phases: s.phases.map((p) =>
          p.id !== phaseId
            ? p
            : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) },
        ),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmSetTaskStatusAction(taskId, status);
      if (!res.ok) {
        set({ phases: prev });
        failToast();
      }
    },

    removeTask: async (phaseId, taskId) => {
      const prev = get().phases;
      set((s) => ({
        phases: s.phases.map((p) =>
          p.id !== phaseId ? p : { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) },
        ),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmRemoveTaskAction(taskId);
      if (!res.ok) {
        set({ phases: prev });
        failToast();
      }
    },

    /* ============================ Plan de table ============================ */

    patchSeatTableLocal: (id, patch) =>
      set((s) => ({
        seatTables: s.seatTables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })),

    addSeatTableLocal: (table) => set((s) => ({ seatTables: [...s.seatTables, table] })),

    upsertSeatTable: async (table, isNew) => {
      const event = get().event;
      if (!event) return null;
      const prev = get().seatTables;
      // Upsert idempotent : la table peut déjà être présente localement
      // (addSeatTableLocal / patchSeatTableLocal avant persistance).
      set((s) => ({
        seatTables: s.seatTables.some((t) => t.id === table.id)
          ? s.seatTables.map((t) => (t.id === table.id ? table : t))
          : [...s.seatTables, table],
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmUpsertTableAction(event.id, {
            ...(isNew ? {} : { tableId: table.id }),
            name: table.label,
            shape: table.shape,
            capacity: table.capacity,
            x: table.x,
            y: table.y,
            rotation: table.rotation,
            ...(table.honor !== undefined ? { honor: table.honor } : {}),
            ...(table.notes !== undefined ? { notes: table.notes } : {}),
          });
      if (!res.ok) {
        set({ seatTables: prev });
        failToast();
        return null;
      }
      if (isNew && res.id) {
        const realId = res.id;
        const tmp = table.id;
        set((s) => ({
          seatTables: s.seatTables.map((t) => (t.id === tmp ? { ...t, id: realId } : t)),
        }));
        return realId;
      }
      return table.id;
    },

    removeSeatTable: async (tableId) => {
      const prevTables = get().seatTables;
      const prevGuests = get().guests;
      set((s) => ({
        seatTables: s.seatTables.filter((t) => t.id !== tableId),
        guests: s.guests.map((g) => (g.tableId === tableId ? { ...g, tableId: null } : g)),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmRemoveTableAction(tableId);
      if (!res.ok) {
        set({ seatTables: prevTables, guests: prevGuests });
        failToast();
      }
    },

    assignGuestTable: async (guestId, tableId) => {
      const prev = get().guests;
      set((s) => ({
        guests: s.guests.map((g) => (g.id === guestId ? { ...g, tableId } : g)),
      }));
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmAssignGuestTableAction(guestId, tableId);
      if (!res.ok) {
        set({ guests: prev });
        failToast();
      }
    },

    saveRoom: async (config, elements) => {
      const event = get().event;
      if (!event) return;
      const prev = get().room;
      const next: MmRoom = {
        name: config.name,
        widthM: config.widthM,
        lengthM: config.lengthM,
        floor: config.floor,
        elements: elements.map((e) => ({
          id: e.id,
          kind: e.kind,
          x: e.x,
          y: e.y,
          w: e.w,
          h: e.h,
          rotation: e.rotation,
          ...(e.label ? { label: e.label } : {}),
        })),
      };
      set({ room: next });
      const res = get().demo
        ? ({ ok: true } as { ok: true; id?: string })
        : await mmSaveRoomAction(event.id, next);
      if (!res.ok) {
        set({ room: prev });
        failToast();
      }
    },

    /* ============================ Publication du plan ============================ */

    autoNumberSeats: async (mode) => {
      const event = get().event;
      if (!event) return 0;
      if (get().demo) return 0;
      const before = countUnnumbered(get().guests);
      const res = await mmAutoNumberSeatsAction(event.id, mode);
      if (!res.ok) {
        failToast();
        return 0;
      }
      // Les numéros sont calculés côté serveur (échanges compris) : on recharge
      // plutôt que de tenter un patch local qui divergerait.
      await get().refresh();
      return Math.max(0, before - countUnnumbered(get().guests));
    },

    setSeatingPublication: async (input) => {
      const event = get().event;
      if (!event) return false;
      const prev = event.seatingPublication;
      // Optimiste : le badge « publié » doit basculer sans attendre l'aller-retour.
      set({
        event: {
          ...event,
          seatingPublication: {
            ...prev,
            published: input.published,
            numbering: input.numbering ?? prev.numbering,
            showRoomPlan: input.showRoomPlan ?? prev.showRoomPlan,
            note: input.note !== undefined ? input.note || null : prev.note,
          },
        },
      });
      if (get().demo) return true;
      const res = await mmSetSeatingPublicationAction(event.id, input);
      if (!res.ok) {
        const current = get().event;
        if (current) set({ event: { ...current, seatingPublication: prev } });
        failToast();
        return false;
      }
      await get().refresh();
      return true;
    },

    broadcastSeatPasses: async (force) => {
      const event = get().event;
      if (!event) return null;
      if (get().demo) return { sent: 0, failed: 0 };
      const res = await mmBroadcastSeatPassesAction(event.id, force);
      if (!res.ok) {
        failToast();
        return null;
      }
      // Recharge : `seatNotifiedAt` change côté serveur, donc la file d'envoi.
      await get().refresh();
      return { sent: res.sent ?? 0, failed: res.failed ?? 0 };
    },
  };
});

/** Invités placés à une table sans numéro de chaise. */
function countUnnumbered(guests: ReadonlyArray<MmGuest>): number {
  return guests.filter((g) => g.tableId !== null && g.seatNumber === null).length;
}

/* ============================ Sélecteurs dérivés ============================ */

/** Devise de l'event (fallback EUR tant que le store n'est pas hydraté). */
export function useMmCurrency() {
  return useMonMariage((s) => s.event?.currency ?? 'EUR');
}

/** Vue « liste d'invités » du dashboard. */
export function guestsView(guests: ReadonlyArray<MmGuest>): McGuest[] {
  return guests.map(guestFromMm);
}

/** Vue « pool de placement » du plan de table (conserve tableId). */
export function seatGuestsView(guests: ReadonlyArray<MmGuest>) {
  return guests.map(seatGuestFromMm);
}
