import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Régression : un IndexedDB indisponible ne doit pas produire de rejet de
 * promesse NON GÉRÉ.
 *
 * `CheckInManager` amorce son cache hors-ligne dans un `useEffect`. L'IIFE
 * asynchrone n'avait ni `catch` ni annulation : toute panne du cache
 * (navigation privée, quota atteint, stockage désactivé, ou simplement le
 * démontage du composant, qui fait disparaître `window`) échappait en
 * `unhandledRejection`. Chez un utilisateur c'est une erreur console qui
 * remonte au reporting ; en CI, vitest fait échouer la suite entière alors que
 * les 1332 tests passent — un échec intermittent, donc coûteux à diagnostiquer.
 *
 * Le cache hors-ligne est un CONFORT : le scan doit continuer en ligne sans lui.
 */

const cacheGuestsForEvent = vi.fn();
const getCacheMeta = vi.fn();

vi.mock('@/lib/offline/guests-db', () => ({
  cacheGuestsForEvent: (...args: unknown[]) => cacheGuestsForEvent(...args),
  getCacheMeta: (...args: unknown[]) => getCacheMeta(...args),
  markCheckedInLocally: vi.fn(),
}));

vi.mock('@/lib/checkin/queue', () => ({
  enqueueCheckIn: vi.fn(),
  pendingCount: vi.fn(async () => 0),
  drainQueue: vi.fn(async () => ({ synced: 0, failed: 0 })),
}));

vi.mock('@/app/[locale]/(app)/events/[eventId]/check-in/actions', () => ({
  checkInByTokenAction: vi.fn(),
  undoCheckInAction: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => `${namespace ?? 'T'}.${key}`,
  useLocale: () => 'fr',
}));

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="qr-scanner-stub" />,
}));

import { CheckInManager } from '@/components/checkin/checkin-manager';

const GUESTS = [
  {
    _id: 'g1',
    fullName: 'Aminata Diallo',
    plusOnesAllowed: 2,
    rsvpStatus: 'attending' as const,
    qrCodeToken: 'TK1',
  },
];

/** Laisse la boucle d'événements tourner : un rejet non géré n'est signalé
 *  qu'au tour suivant, pas dans la microtâche qui l'a produit. */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CheckInManager — panne du cache hors-ligne', () => {
  it('ne laisse échapper aucun rejet non géré quand IndexedDB est indisponible', async () => {
    cacheGuestsForEvent.mockRejectedValue(new Error('IndexedDB is only available in the browser'));
    getCacheMeta.mockRejectedValue(new Error('IndexedDB is only available in the browser'));

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      render(<CheckInManager eventId="evt_x" initialGuests={GUESTS} />);
      await flush();
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('reste utilisable en ligne malgré l’absence de cache', async () => {
    cacheGuestsForEvent.mockRejectedValue(new Error('quota exceeded'));
    getCacheMeta.mockRejectedValue(new Error('quota exceeded'));

    render(<CheckInManager eventId="evt_x" initialGuests={GUESTS} />);
    await flush();

    // Le scanner et la saisie manuelle restent montés : la panne du cache ne
    // dégrade pas le chemin en ligne.
    expect(screen.getByTestId('qr-scanner-stub')).toBeInTheDocument();
    expect(screen.getByTestId('manual-form')).toBeInTheDocument();
  });

  it('n’écrit pas dans l’état après démontage', async () => {
    // Le cache répond APRÈS le démontage : sans le drapeau `cancelled`, React
    // signalerait un setState sur un composant disparu.
    let resolveMeta: ((value: { lastSyncedAt: number }) => void) | undefined;
    cacheGuestsForEvent.mockResolvedValue(undefined);
    getCacheMeta.mockReturnValue(
      new Promise<{ lastSyncedAt: number }>((resolve) => {
        resolveMeta = resolve;
      }),
    );

    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    try {
      const { unmount } = render(<CheckInManager eventId="evt_x" initialGuests={GUESTS} />);
      unmount();
      resolveMeta?.({ lastSyncedAt: Date.now() });
      await flush();
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
