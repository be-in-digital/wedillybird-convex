// Bundle DÉMO pour /capture-mm (screencasts vidéos de lancement) : reconstruit
// un MmBundle complet depuis les mocks historiques de data.ts. L'id d'event
// préfixé `demo-` bascule le store en mode démo (mutations optimistes locales,
// AUCUNE server action) — les interactions restent fluides à l'écran.

import type { MmBundle, MmGuest, MmRsvpStatus } from '@/lib/mon-mariage/types';
import { fromIsoDate, toMinor } from '@/lib/mon-mariage/adapt';
import {
  MC_ACTIVE,
  MC_COUPLE,
  MC_GUESTS,
  MC_INVOICES,
  MC_PAYMENTS,
  MC_PHASES,
  MC_TODAY,
  MC_USAGE,
  MC_VENDORS,
  type McGuestStatus,
} from './data';

const RSVP_FROM_MOCK: Record<McGuestStatus, MmRsvpStatus> = {
  confirmed: 'attending',
  pending: 'maybe',
  declined: 'declined',
  noreply: 'pending',
};

function demoGuests(): MmGuest[] {
  return MC_GUESTS.map((g) => ({
    id: `demo-${g.id}`,
    fullName: g.name,
    phone: `${g.cc} ${g.phone}`,
    category: g.group,
    plusOnesAllowed: Math.max(0, g.count - 1),
    rsvpStatus: RSVP_FROM_MOCK[g.status],
    tableId: null,
    seatNumber: null,
  }));
}

export function buildDemoBundle(): MmBundle {
  const [partnerA = '', partnerB = ''] = MC_COUPLE.names.split('&').map((x) => x.trim());
  const kindFromKey = (key: string): 'deposit' | 'balance' | 'other' =>
    key.endsWith('.deposit') ? 'deposit' : key.endsWith('.balance') ? 'balance' : 'other';

  return {
    event: {
      id: 'demo-event',
      slug: MC_COUPLE.slug,
      title: MC_COUPLE.names,
      coupleNames: { partnerA, partnerB },
      eventDate: fromIsoDate(MC_COUPLE.weddingDate),
      timezone: 'America/New_York',
      currency: 'USD',
      budgetEnvelopeMinor: toMinor(22000),
      venue: { name: MC_COUPLE.venue, address: MC_COUPLE.venue },
      status: 'active',
      planTier: MC_ACTIVE.planId === 'premium' ? 'premium' : 'essential',
      pendingPlanTier: null,
      paidAt: fromIsoDate(MC_ACTIVE.purchasedAt),
      maxGuests: MC_ACTIVE.guestCap,
      galleryExpiresAt: fromIsoDate(MC_ACTIVE.galleryExpires),
      hdUpsellPurchasedAt: null,
      seatingUnlocked: true,
      invitationCinematic: 'floral',
      invitationMusic: { source: 'library', trackId: 'jardin' },
      invitationPhoto: null,
      ceremonySchedule: [
        { time: '15 h 00', title: 'Cérémonie', note: 'Domaine des Oliviers' },
        { time: '16 h 30', title: 'Cocktail & photos' },
        { time: '19 h 30', title: 'Dîner' },
        { time: '22 h 00', title: 'Ouverture du bal' },
      ],
      cinematicUnlocked: true,
      seatingPublication: {
        published: false,
        publishedAt: null,
        numbering: 'seat',
        showRoomPlan: true,
        note: null,
      },
    },
    guests: demoGuests(),
    vendors: MC_VENDORS.map((v) => ({
      id: `demo-${v.id}`,
      name: v.name,
      category: v.cat,
      status: v.status,
      amountMinor: toMinor(v.amount),
      paidMinor: toMinor(v.paid),
      contact: v.contact ?? null,
      email: v.email ?? null,
      note: v.note ?? null,
      attachments: v.doc ? [{ name: v.doc, kind: 'devis' }] : [],
    })),
    payments: MC_PAYMENTS.map((e) => ({
      id: `demo-${e.id}`,
      vendorId: null,
      vendorName: e.vendor,
      category: e.cat,
      kind: kindFromKey(e.kind),
      dueDate: fromIsoDate(e.date),
      amountMinor: toMinor(e.amount),
      paidMinor: e.paid ? toMinor(e.amount) : 0,
      paidAt: e.paid ? fromIsoDate(e.date) : null,
      attachments: [],
    })),
    phases: MC_PHASES.map((p, i) => ({
      id: `demo-${p.id}`,
      label: null,
      labelKey: p.label,
      sub: null,
      subKey: p.sub,
      order: i,
      tasks: p.tasks.map((tk) => ({
        id: `demo-${tk.id}`,
        label: null,
        labelKey: tk.label,
        status: tk.status,
        dueDate: tk.due ? fromIsoDate(tk.due) : null,
      })),
    })),
    room: null, // l'éditeur retombe sur le gabarit ballroom
    tables: [
      {
        id: 'demo-T0',
        name: 'Head table',
        capacity: 10,
        shape: 'head',
        x: 9,
        y: 11.4,
        rotation: 0,
        honor: true,
        notes: null,
      },
      {
        id: 'demo-T1',
        name: 'Family',
        capacity: 8,
        shape: 'round',
        x: 3.4,
        y: 4,
        rotation: 0,
        honor: false,
        notes: null,
      },
      {
        id: 'demo-T2',
        name: 'Friends',
        capacity: 8,
        shape: 'round',
        x: 3.4,
        y: 8.4,
        rotation: 0,
        honor: false,
        notes: null,
      },
      {
        id: 'demo-T3',
        name: 'Table 3',
        capacity: 8,
        shape: 'round',
        x: 14,
        y: 9,
        rotation: 0,
        honor: false,
        notes: null,
      },
      {
        id: 'demo-T4',
        name: 'Table 4',
        capacity: 8,
        shape: 'round',
        x: 6.2,
        y: 9,
        rotation: 0,
        honor: false,
        notes: null,
      },
    ],
    invoices: MC_INVOICES.map((inv) => ({
      id: `demo-${inv.id}`,
      kind: 'plan',
      plan: 'premium',
      amountMinor: toMinor(inv.amount),
      currency: 'USD',
      paidAt: fromIsoDate(inv.date),
    })),
    usage: {
      invitations: MC_USAGE.guests,
      storageBytes: Math.round(MC_USAGE.storageGo * 1e9),
    },
    referral: { code: 'WBDEMO', availableMinor: 4000 },
    seatingNotifications: { placedGuests: 0, notified: 0, needsNotify: 0 },
  };
}

export const DEMO_NOW = MC_TODAY.getTime();
