'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  checkInByTokenAction,
  undoCheckInAction,
  type CheckInResult,
} from '@/app/[locale]/(app)/events/[eventId]/check-in/actions';
import {
  cacheGuestsForEvent,
  findGuestByToken,
  getCacheMeta,
  markCachedCheckedIn,
} from '@/lib/offline/guests-db';
import { countPendingCheckIns, drainPendingCheckIns, enqueueCheckIn } from '@/lib/checkin/queue';

const QrScanner = dynamic(() => import('./qr-scanner').then((m) => m.QrScanner), {
  ssr: false,
});

type ToastStatus = 'success' | 'already' | 'error' | 'offline';

interface Toast {
  id: string;
  status: ToastStatus;
  guestName: string;
  guestId?: string;
  plusOnesAllowed: number;
  timestamp: number;
  /** Placement affiché sous le nom : « Table des Pivoines · place 4 ». */
  tableName?: string | null;
  seatNumber?: number | null;
}

interface GuestForCheckIn {
  _id: string;
  fullName: string;
  category?: string;
  plusOnesAllowed: number;
  rsvpStatus: 'pending' | 'attending' | 'declined' | 'maybe';
  qrCodeToken: string;
  checkedInAt?: number;
  tableName?: string | null;
  seatNumber?: number | null;
}

interface Props {
  eventId: string;
  initialGuests: GuestForCheckIn[];
}

const UNDO_WINDOW_MS = 30_000;
const COOLDOWN_MS = 2_000;

export function CheckInManager({ eventId, initialGuests }: Props) {
  const t = useTranslations('Checkin');
  const locale = useLocale();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paused, setPaused] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [manualInput, setManualInput] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [queueSyncedAt, setQueueSyncedAt] = useState<number | null>(null);
  const [queueSyncedCount, setQueueSyncedCount] = useState<number | null>(null);
  const draining = useRef(false);
  const lastScannedRef = useRef<{ token: string; at: number } | null>(null);

  const refreshQueueCount = useCallback(async () => {
    try {
      const count = await countPendingCheckIns(eventId);
      setPendingQueueCount(count);
    } catch {
      // ignore (Dexie indisponible côté SSR ou storage refusé)
    }
  }, [eventId]);

  const drainQueue = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      const result = await drainPendingCheckIns(eventId);
      if (result.synced > 0) {
        setQueueSyncedAt(Date.now());
        setQueueSyncedCount(result.synced);
      }
      await refreshQueueCount();
    } catch {
      // silencieux : on retentera au prochain online ou au prochain scan online
    } finally {
      draining.current = false;
    }
  }, [eventId, refreshQueueCount]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Le cache hors-ligne est un confort, pas une dépendance : IndexedDB peut
    // être indisponible (navigation privée, quota atteint, stockage désactivé
    // par l'utilisateur) et le scan doit continuer de fonctionner en ligne.
    // Sans `catch`, cet échec remontait en rejet de promesse NON GÉRÉ ; sans
    // `cancelled`, un démontage pendant l'écriture déclenchait un setState sur
    // un composant disparu. Le `drainQueue` juste au-dessus applique déjà la
    // même règle.
    let cancelled = false;
    (async () => {
      try {
        await cacheGuestsForEvent(eventId, initialGuests);
        const meta = await getCacheMeta(eventId);
        if (!cancelled && meta) setLastSyncedAt(meta.lastSyncedAt);
      } catch {
        // pas de cache : on reste sur les données rendues par le serveur
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, initialGuests]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const next = navigator.onLine;
      setIsOnline(next);
      if (next) void drainQueue();
    };
    // Initial check + queue count différés via microtask pour éviter de
    // déclencher setState dans le body de l'effect (cascading renders).
    const init = window.setTimeout(() => {
      update();
      void refreshQueueCount();
    }, 0);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.clearTimeout(init);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [drainQueue, refreshQueueCount]);

  const pushToast = useCallback((toast: Toast) => {
    setToasts((prev) => [toast, ...prev].slice(0, 5));
  }, []);

  const handleResult = useCallback(
    (result: CheckInResult, token: string) => {
      if (result.ok) {
        const toast: Toast = {
          id: `${token}-${Date.now()}`,
          status: result.alreadyCheckedIn ? 'already' : 'success',
          guestName: result.guest.fullName,
          guestId: result.guest._id,
          plusOnesAllowed: result.guest.plusOnesAllowed,
          timestamp: result.checkedInAt,
          tableName: result.guest.tableName,
          seatNumber: result.guest.seatNumber,
        };
        pushToast(toast);
        void markCachedCheckedIn(eventId, token, result.checkedInAt);
        return;
      }
      pushToast({
        id: `${token}-err-${Date.now()}`,
        status: 'error',
        guestName: result.error === 'GUEST_NOT_FOUND' ? t('unknownGuest') : t('errorGeneric'),
        plusOnesAllowed: 0,
        timestamp: Date.now(),
      });
    },
    [eventId, pushToast, t],
  );

  const handleOfflineScan = useCallback(
    async (token: string) => {
      const cached = await findGuestByToken(eventId, token);
      if (!cached) {
        pushToast({
          id: `${token}-offline-404-${Date.now()}`,
          status: 'offline',
          guestName: t('unknownGuestOffline'),
          plusOnesAllowed: 0,
          timestamp: Date.now(),
        });
        return;
      }
      const scannedAt = Date.now();
      try {
        await enqueueCheckIn({ eventId, token, scannedAt });
        await markCachedCheckedIn(eventId, token, scannedAt);
        await refreshQueueCount();
      } catch {
        // On affiche le toast quand même : l'opérateur a la trace visuelle même
        // si la persistance Dexie échoue (storage plein, mode privé bloquant).
      }
      pushToast({
        id: `${token}-offline-${scannedAt}`,
        status: 'offline',
        guestName: cached.fullName,
        plusOnesAllowed: cached.plusOnesAllowed,
        timestamp: scannedAt,
        tableName: cached.tableName,
        seatNumber: cached.seatNumber,
      });
    },
    [eventId, pushToast, refreshQueueCount, t],
  );

  const submit = useCallback(
    (token: string) => {
      const now = Date.now();
      const last = lastScannedRef.current;
      if (last && last.token === token && now - last.at < COOLDOWN_MS) return;
      lastScannedRef.current = { token, at: now };

      setPaused(true);
      setTimeout(() => setPaused(false), COOLDOWN_MS);

      if (!navigator.onLine) {
        void handleOfflineScan(token);
        return;
      }

      startTransition(async () => {
        const result = await checkInByTokenAction(eventId, token);
        handleResult(result, token);
      });
    },
    [eventId, handleOfflineScan, handleResult],
  );

  function onManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = manualInput.trim();
    if (!token) return;
    submit(token);
    setManualInput('');
  }

  function handleUndo(toast: Toast) {
    if (!toast.guestId) return;
    startTransition(async () => {
      const result = await undoCheckInAction(eventId, toast.guestId!);
      if (result.ok) {
        setToasts((prev) => prev.filter((x) => x.id !== toast.id));
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--color-muted)]">
        <span data-testid="connection-status">
          {isOnline ? t('online') : t('offline')} ·{' '}
          {lastSyncedAt
            ? t('lastSync', {
                time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
                  new Date(lastSyncedAt),
                ),
              })
            : t('neverSynced')}
        </span>
        <span>{t('guestsCached', { count: initialGuests.length })}</span>
      </div>

      {pendingQueueCount > 0 ? (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-xs"
          data-testid="pending-queue-badge"
          data-count={pendingQueueCount}
        >
          <span>{t('pendingQueue', { count: pendingQueueCount })}</span>
          {isOnline ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void drainQueue()}
              data-testid="pending-queue-sync"
            >
              {t('pendingQueueSyncNow')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {queueSyncedCount && queueSyncedAt && now - queueSyncedAt < 6_000 ? (
        <div
          className="rounded-xl border border-[color:var(--color-accent)] bg-[color:var(--color-surface)] p-3 text-xs"
          data-testid="pending-queue-synced"
        >
          {t('pendingQueueSynced', { count: queueSyncedCount })}
        </div>
      ) : null}

      <QrScanner onScan={submit} paused={paused || pending} />

      <form onSubmit={onManualSubmit} className="flex gap-2" data-testid="manual-form">
        <Input
          placeholder={t('manualPlaceholder')}
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          data-testid="manual-token"
        />
        <Button type="submit" variant="ghost" disabled={pending} data-testid="manual-submit">
          {t('manualSubmit')}
        </Button>
      </form>

      <ul className="flex flex-col gap-2" data-testid="toast-list">
        {toasts.map((toast) => {
          const undoable =
            toast.status === 'success' && toast.guestId && now - toast.timestamp < UNDO_WINDOW_MS;
          return (
            <li
              key={toast.id}
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${
                toast.status === 'success'
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-surface)]'
                  : toast.status === 'already'
                    ? 'border-[color:var(--color-border)] bg-[color:var(--color-surface)]'
                    : toast.status === 'offline'
                      ? 'border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)]'
                      : 'border-[color:var(--color-destructive)] bg-[color:var(--color-surface)]'
              }`}
              data-testid="toast"
              data-status={toast.status}
            >
              <div className="flex flex-col">
                <span className="font-medium">{toast.guestName}</span>
                <span className="text-xs text-[color:var(--color-muted)]">
                  {toast.status === 'success' && t('toastSuccess')}
                  {toast.status === 'already' && t('toastAlready')}
                  {toast.status === 'offline' && t('toastOffline')}
                  {toast.status === 'error' && t('toastError')}
                  {toast.plusOnesAllowed > 0 ? ` · +${toast.plusOnesAllowed}` : ''}
                </span>
                {toast.status === 'success' ||
                toast.status === 'already' ||
                toast.status === 'offline' ? (
                  <span
                    className="font-mono text-xs text-[color:var(--color-ink-700)]"
                    data-testid="toast-seat"
                  >
                    {toast.tableName
                      ? toast.seatNumber != null
                        ? t('toastSeat', { table: toast.tableName, seat: toast.seatNumber })
                        : t('toastTable', { table: toast.tableName })
                      : t('toastNoSeat')}
                  </span>
                ) : null}
              </div>
              {undoable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUndo(toast)}
                  data-testid="undo-check-in"
                >
                  {t('undo')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
