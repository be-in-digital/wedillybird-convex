import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import frMessages from '@/messages/fr.json';

// Link de next-intl tire la navigation react-client (next/navigation) que
// vitest ne résout pas — on le remplace par une simple ancre.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}));

// `Cockpit` est un Server Component qui consomme `getTranslations` ; vitest n'a
// pas le contexte de requête next-intl, donc on adosse `getTranslations` aux
// vraies clés FR (`messages/fr.json`) via `createTranslator`. Les assertions
// portent ainsi sur la copie réelle, pas sur des clés brutes.
vi.mock('next-intl/server', () => ({
  // `namespace` du vrai `getTranslations` est une union littérale stricte ; côté
  // mock on le forwarde via `never` (toujours assignable) puisque la valeur
  // réelle passée par le composant (`'Pro.main'`) est une clé valide.
  getTranslations: async (namespace?: string) =>
    createTranslator({ locale: 'fr', messages: frMessages, namespace: namespace as never }),
  getLocale: async () => 'fr',
}));

import { Cockpit, type CockpitData } from '@/components/pro/cockpit';

const baseData: CockpitData = {
  org: {
    name: 'Studio Lumière',
    subscriptionTier: 'business',
    subscriptionStatus: 'active',
    subscriptionPeriodEnd: null,
    paygCredits: 2,
  },
  usage: {
    activeEvents: 7,
    storageBytes: 84_000_000_000,
    whatsappMessagesThisMonth: 6200,
    seatsUsed: 3,
  },
  kpis: {
    activeWeddings: 7,
    pendingRsvp: 342,
    totalEvents: 9,
    draftEvents: 2,
    weekDeadlines: 3,
    weddingsThisMonth: 2,
    respondedLast7: 18,
    collectedMinor: 285_000,
    paidInvoicesCount: 4,
  },
  kpiTrends: {
    weddings: [0, 1, 0, 2, 1, 0, 1, 2],
    rsvp: [0, 1, 2, 1, 3, 0, 4, 2, 5, 1, 3, 6, 2, 4],
    tasksDone: [1, 0, 2, 1, 3, 2, 1, 4],
    revenue: [0, 500, 0, 1200, 0, 800, 2100, 300],
  },
  upcoming: [
    {
      _id: 'ev1',
      partnerA: 'Awa',
      partnerB: 'Karim',
      eventDate: Date.UTC(2026, 8, 12),
      timezone: 'Europe/Paris',
      daysUntil: 99,
      rsvpAttending: 186,
      rsvpTotal: 240,
      status: 'active',
    },
  ],
  pipeline: [
    { stage: 'lead', count: 3 },
    { stage: 'contacted', count: 2 },
    { stage: 'quote', count: 1 },
    { stage: 'booked', count: 2 },
    { stage: 'in_progress', count: 1 },
    { stage: 'delivered', count: 4 },
  ],
  deadlines: [
    {
      _id: 't1',
      title: 'Valider le traiteur',
      dueDate: Date.UTC(2026, 5, 20),
      daysUntil: 12,
      eventId: 'ev1',
      coupleLabel: 'Awa & Karim',
    },
  ],
  overdueTasks: 1,
  recentActivity: [
    { kind: 'client' as const, label: 'Nouveau client · Léa & Tom', daysAgo: 0 },
    { kind: 'task' as const, label: 'Tâche terminée · Réserver le lieu', daysAgo: 2 },
  ],
  rsvpTrend: [0, 1, 2, 1, 3, 0, 4, 2, 5, 1, 3, 6, 2, 4],
  userName: 'Camille',
  locale: 'fr',
};

describe('Cockpit — rendu agence (Business, abonnement actif)', () => {
  it('rend l’en-tête, les KPIs et les sections', async () => {
    render(await Cockpit(baseData));
    expect(screen.getByText('Tableau de bord')).toBeTruthy();
    expect(screen.getByText(/Cockpit · Studio Lumière/)).toBeTruthy();
    expect(screen.getByText(/Bonjour Camille/)).toBeTruthy();
    // « RSVP en attente » est un label KPI unique (« Mariages actifs » sert
    // aussi de label de jauge, d'où le doublon volontairement évité ici).
    expect(screen.getByText('RSVP en attente')).toBeTruthy();
    expect(screen.getByText('Prochains mariages')).toBeTruthy();
    expect(screen.getByText('Consommation du forfait')).toBeTruthy();
  });

  it('affiche les 4 jauges de quota', async () => {
    render(await Cockpit(baseData));
    expect(screen.getByText('Messages ce mois')).toBeTruthy();
    expect(screen.getByText('Stockage')).toBeTruthy();
    expect(screen.getByText('Sièges équipe')).toBeTruthy();
  });

  it('affiche le flux d’activité récente', async () => {
    render(await Cockpit(baseData));
    expect(screen.getByText('Activité récente')).toBeTruthy();
    expect(screen.getByText('Nouveau client · Léa & Tom')).toBeTruthy();
    expect(screen.getByText("aujourd'hui")).toBeTruthy();
    expect(screen.getByText('il y a 2 j')).toBeTruthy();
  });

  it('affiche les 4 KPIs du design (échéances 7 j + CA encaissé)', async () => {
    render(await Cockpit(baseData));
    // « Mariages actifs » sert de label KPI ET de jauge → on cible les KPI uniques.
    expect(screen.getByText('Échéances · 7 j')).toBeTruthy();
    expect(screen.getByText('CA encaissé')).toBeTruthy();
    // delta réel : 18 réponses sur 7 j
    expect(screen.getByText(/réponses · 7 j/)).toBeTruthy();
  });

  it('liste le prochain mariage avec sa progression RSVP', async () => {
    render(await Cockpit(baseData));
    // « Awa » apparaît dans la carte mariage ET dans la tâche (couple) → getAllByText.
    expect(screen.getAllByText(/Awa/).length).toBeGreaterThan(0);
    expect(screen.getByText(/RSVP 186\/240/)).toBeTruthy(); // unique à la carte mariage
  });

  it('Business : le bouton « Nouveau client » est présent (CRM inclus)', async () => {
    render(await Cockpit(baseData));
    expect(screen.getByText('Nouveau client')).toBeTruthy();
    // Deadlines & tâches : la tâche seedée est listée avec son couple.
    expect(screen.getByText('Valider le traiteur')).toBeTruthy();
  });

  it('abonnement actif → pas de bandeau d’alerte', async () => {
    render(await Cockpit(baseData));
    expect(screen.queryByText('Choisir un forfait')).toBeNull();
  });
});

describe('Cockpit — sans abonnement', () => {
  // Une agence qui n'a rien choisi n'a pas non plus de crédit PAYG : le
  // `paygCredits: 2` de `baseData` (agence Business) débloquerait le
  // back-office et rendrait le bandeau mensonger.
  const noSub: CockpitData = {
    ...baseData,
    org: {
      ...baseData.org,
      subscriptionTier: null,
      subscriptionStatus: null,
      paygCredits: 0,
    },
  };

  it('affiche le bandeau « Choisir un forfait » et l’état quotas vide', async () => {
    render(await Cockpit(noSub));
    expect(screen.getByText('Choisir un forfait')).toBeTruthy();
    expect(screen.getByText(/vos quotas s['’]afficheront/)).toBeTruthy();
  });

  it('sans CRM : pas de bouton « Nouveau client »', async () => {
    render(await Cockpit(noSub));
    expect(screen.queryByText('Nouveau client')).toBeNull();
  });

  it('un crédit Pay-as-you-go suffit à faire taire le bandeau', async () => {
    // Le back-office lui est ouvert (`orgHasActiveAccess`) : lui dire de
    // choisir un forfait « pour le débloquer » serait faux.
    render(await Cockpit({ ...noSub, org: { ...noSub.org, paygCredits: 1 } }));
    expect(screen.queryByText('Choisir un forfait')).toBeNull();
  });
});

/**
 * Compte offert (lien partenaire) : le tier est écrit sur l'organisation mais
 * il n'y a AUCUN objet Stripe derrière, donc aucun `subscriptionStatus`. Le
 * bandeau se lisait sur ce seul statut — une partenaire à qui l'on venait
 * d'ouvrir six mois lisait « Aucun abonnement actif » juste sous le décompte
 * de son cadeau.
 */
describe('Cockpit — compte offert', () => {
  const comped = (expiresAt: number): CockpitData => ({
    ...baseData,
    org: {
      ...baseData.org,
      subscriptionTier: 'starter',
      subscriptionStatus: null,
      paygCredits: 0,
      compedSubscription: { expiresAt },
    },
  });

  it('cadeau en cours → aucun bandeau « choisissez un forfait »', async () => {
    render(await Cockpit(comped(Date.now() + 181 * 24 * 60 * 60 * 1000)));
    expect(screen.queryByText('Choisir un forfait')).toBeNull();
    expect(screen.queryByText(/Aucun abonnement actif/)).toBeNull();
    // Les quotas du tier offert, eux, restent affichés.
    expect(screen.getByText('Consommation du forfait')).toBeTruthy();
  });

  it('cadeau expiré → le bandeau revient', async () => {
    render(await Cockpit(comped(Date.now() - 1)));
    expect(screen.getByText('Choisir un forfait')).toBeTruthy();
  });
});

describe('Cockpit — Starter (CRM verrouillé)', () => {
  const starter: CockpitData = {
    ...baseData,
    org: { ...baseData.org, subscriptionTier: 'starter' },
  };

  it('sans CRM (Starter) : pas de bouton « Nouveau client »', async () => {
    render(await Cockpit(starter));
    expect(screen.queryByText('Nouveau client')).toBeNull();
    // Le tableau de bord reste rendu (mariages, quotas).
    expect(screen.getByText('Prochains mariages')).toBeTruthy();
  });
});

describe('Cockpit — past_due', () => {
  it('affiche un bandeau de paiement échoué', async () => {
    const pastDue: CockpitData = {
      ...baseData,
      org: { ...baseData.org, subscriptionStatus: 'past_due' },
    };
    render(await Cockpit(pastDue));
    expect(screen.getByText(/Paiement échoué/)).toBeTruthy();
  });
});
