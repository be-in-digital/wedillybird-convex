// Espace couple self-serve « /mon-mariage » — types du bundle Convex côté client.
// Miroir 1:1 du payload de `convex/coupleSpace.ts#bundle` (ids sérialisés en string).
// Les montants sont en CENTIMES dans la devise de l'event (`event.currency`).

import type { BudgetCurrency } from '@/lib/currency';
import type {
  CouplePaymentKind,
  CoupleRoomElementKind,
  CoupleRoomFloor,
  CoupleTableShape,
  CoupleTaskStatus,
  CoupleVendorStatus,
} from '@/convex/lib/coupleModel';

export interface MmEvent {
  id: string;
  slug: string;
  title: string;
  coupleNames: { partnerA: string; partnerB: string };
  /** epoch ms */
  eventDate: number;
  timezone: string;
  currency: BudgetCurrency;
  budgetEnvelopeMinor: number | null;
  venue: { name: string; address: string; lat?: number; lng?: number } | null;
  status: 'draft' | 'active' | 'archived' | 'cancelled';
  planTier: 'essential' | 'premium' | null;
  pendingPlanTier: 'essential' | 'premium' | null;
  paidAt: number | null;
  /** Quota d'invitations du forfait (pas de personnes physiques). */
  maxGuests: number;
  galleryExpiresAt: number | null;
  hdUpsellPurchasedAt: number | null;
  /** Plan de table débloqué (Premium). */
  seatingUnlocked: boolean;
  /** Cinématique d'ouverture choisie (null = sceau, défaut). */
  invitationCinematic: string | null;
  /** Musique de l'invitation (résolue côté serveur) — null = silence. */
  invitationMusic: MmInvitationMusic | null;
  /** Photo du couple (URL résolue côté serveur) — null = pas de photo. */
  invitationPhoto: MmInvitationPhoto | null;
  /** Déroulé de la journée affiché sur l'invitation (vide = non renseigné). */
  ceremonySchedule: CeremonyStep[];
  /** Choix de cinématique + musique + photo débloqués (Premium). */
  cinematicUnlocked: boolean;
  /** Publication du plan de table côté invités (defaults déjà appliqués). */
  seatingPublication: MmSeatingPublication;
}

/** Une étape du déroulé de la journée (guest-facing). */
export interface CeremonyStep {
  time: string;
  title: string;
  note?: string;
}

export interface MmInvitationMusic {
  source: 'library' | 'custom';
  trackId?: string;
  title?: string;
  customUrl?: string;
}

export interface MmInvitationPhoto {
  url: string;
  width?: number;
  height?: number;
}

export type MmRsvpStatus = 'pending' | 'attending' | 'declined' | 'maybe';

export interface MmGuest {
  id: string;
  fullName: string;
  phone: string | null;
  category: string | null;
  plusOnesAllowed: number;
  rsvpStatus: MmRsvpStatus;
  tableId: string | null;
  /** Chaise attribuée à la table, `null` = placement sans numéro. */
  seatNumber: number | null;
}

export interface MmAttachment {
  name: string;
  kind: string;
}

export interface MmVendor {
  id: string;
  name: string;
  category: string;
  status: CoupleVendorStatus;
  amountMinor: number;
  paidMinor: number;
  contact: string | null;
  email: string | null;
  note: string | null;
  attachments: MmAttachment[];
}

export interface MmPayment {
  id: string;
  vendorId: string | null;
  vendorName: string;
  category: string;
  kind: CouplePaymentKind;
  /** epoch ms */
  dueDate: number;
  amountMinor: number;
  paidMinor: number;
  paidAt: number | null;
  attachments: MmAttachment[];
}

export interface MmTask {
  id: string;
  label: string | null;
  labelKey: string | null;
  status: CoupleTaskStatus;
  dueDate: number | null;
}

export interface MmPhase {
  id: string;
  label: string | null;
  labelKey: string | null;
  sub: string | null;
  subKey: string | null;
  order: number;
  tasks: MmTask[];
}

export interface MmRoomElement {
  id: string;
  kind: CoupleRoomElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  label?: string;
}

export interface MmRoom {
  name: string;
  widthM: number;
  lengthM: number;
  floor: CoupleRoomFloor;
  elements: MmRoomElement[];
}

export interface MmTable {
  id: string;
  name: string;
  capacity: number;
  shape: CoupleTableShape;
  /** Position en mètres (null = jamais posée sur le plan). */
  x: number | null;
  y: number | null;
  rotation: number;
  honor: boolean;
  notes: string | null;
}

export interface MmInvoice {
  id: string;
  kind: 'plan' | 'post_event_upsell';
  plan: 'essential' | 'premium' | null;
  amountMinor: number;
  currency: string;
  paidAt: number;
}

export interface MmUsage {
  invitations: number;
  storageBytes: number;
}

export interface MmReferral {
  /** Code de parrainage du couple (lien `?ref=CODE`) — null si pas encore créé. */
  code: string | null;
  /** Crédit disponible (récompenses vested), centimes dans la devise de l'event. */
  availableMinor: number;
}

/** Publication du plan de table pour les invités (`events.seatingConfig`). */
export interface MmSeatingPublication {
  published: boolean;
  publishedAt: number | null;
  numbering: 'table' | 'seat';
  showRoomPlan: boolean;
  note: string | null;
}

/** File d'envoi des pass placement. */
export interface MmSeatingNotifications {
  placedGuests: number;
  notified: number;
  needsNotify: number;
}

export interface MmBundle {
  event: MmEvent;
  guests: MmGuest[];
  vendors: MmVendor[];
  payments: MmPayment[];
  phases: MmPhase[];
  room: MmRoom | null;
  tables: MmTable[];
  invoices: MmInvoice[];
  usage: MmUsage;
  referral: MmReferral;
  seatingNotifications: MmSeatingNotifications;
}
