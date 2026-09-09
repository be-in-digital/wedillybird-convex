import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const checkInActionMock = vi.fn();
const undoActionMock = vi.fn();

let scanHandler: ((token: string) => void) | null = null;

vi.mock('@/app/[locale]/(app)/events/[eventId]/check-in/actions', () => ({
  checkInByTokenAction: (eventId: string, token: string) => checkInActionMock(eventId, token),
  undoCheckInAction: (eventId: string, guestId: string) => undoActionMock(eventId, guestId),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, vars?: Record<string, unknown>) => {
    if (vars && typeof vars === 'object') {
      const parts = Object.entries(vars).map(([k, v]) => `${k}=${String(v)}`);
      return `${namespace ?? 'T'}.${key}(${parts.join(',')})`;
    }
    return `${namespace ?? 'T'}.${key}`;
  },
  useLocale: () => 'fr',
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const Component = (props: { onScan: (t: string) => void }) => {
      scanHandler = props.onScan;
      return <div data-testid="qr-scanner-stub" />;
    };
    return Component;
  },
}));

import { CheckInManager } from '@/components/checkin/checkin-manager';

const EVENT_ID = 'evt_x';
const GUESTS = [
  {
    _id: 'g1',
    fullName: 'Aminata Diallo',
    plusOnesAllowed: 2,
    rsvpStatus: 'attending' as const,
    qrCodeToken: 'TK1',
  },
  {
    _id: 'g2',
    fullName: 'Mamadou',
    plusOnesAllowed: 0,
    rsvpStatus: 'pending' as const,
    qrCodeToken: 'TK2',
  },
];

beforeEach(async () => {
  checkInActionMock.mockReset();
  undoActionMock.mockReset();
  scanHandler = null;
  const { indexedDB } = await import('fake-indexeddb');
  globalThis.indexedDB = indexedDB;
  await new Promise<void>((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase('wedillybird-checkin');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('CheckInManager', () => {
  it('renders scanner stub and manual form', async () => {
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);
    expect(screen.getByTestId('qr-scanner-stub')).toBeInTheDocument();
    expect(screen.getByTestId('manual-form')).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toHaveTextContent(/online/);
  });

  it('submits a manual token and shows a success toast with undo', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      checkedInAt: Date.now(),
      guest: {
        _id: 'g1',
        fullName: 'Aminata Diallo',
        plusOnesAllowed: 2,
        rsvpStatus: 'attending',
      },
    });

    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);

    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));

    await waitFor(() => expect(checkInActionMock).toHaveBeenCalledWith(EVENT_ID, 'TK1'));
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-status', 'success');
    expect(toast).toHaveTextContent('Aminata Diallo');
    expect(screen.getByTestId('undo-check-in')).toBeInTheDocument();
  });

  it('affiche la place de l’invité au scan pour orienter l’hôtesse', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      checkedInAt: Date.now(),
      guest: {
        _id: 'g1',
        fullName: 'Aminata Diallo',
        plusOnesAllowed: 0,
        rsvpStatus: 'attending',
        tableName: 'Table des Pivoines',
        seatNumber: 4,
      },
    });

    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);
    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));

    const seat = await screen.findByTestId('toast-seat');
    expect(seat).toHaveTextContent('table=Table des Pivoines');
    expect(seat).toHaveTextContent('seat=4');
  });

  it('sans numéro de chaise, n’affiche que la table', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      checkedInAt: Date.now(),
      guest: {
        _id: 'g1',
        fullName: 'Aminata Diallo',
        plusOnesAllowed: 0,
        rsvpStatus: 'attending',
        tableName: 'Table des Pivoines',
        seatNumber: null,
      },
    });

    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);
    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));

    const seat = await screen.findByTestId('toast-seat');
    expect(seat).toHaveTextContent('Checkin.toastTable(table=Table des Pivoines)');
  });

  it('invité non placé : le scan le dit explicitement plutôt que de rester muet', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      checkedInAt: Date.now(),
      guest: {
        _id: 'g1',
        fullName: 'Aminata Diallo',
        plusOnesAllowed: 0,
        rsvpStatus: 'attending',
        tableName: null,
        seatNumber: null,
      },
    });

    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);
    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));

    expect(await screen.findByTestId('toast-seat')).toHaveTextContent('Checkin.toastNoSeat');
  });

  it('shows an "already" toast without undo when server reports alreadyCheckedIn', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: true,
      checkedInAt: 1234,
      guest: {
        _id: 'g1',
        fullName: 'Aminata Diallo',
        plusOnesAllowed: 0,
        rsvpStatus: 'attending',
      },
    });

    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);

    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-status', 'already');
    expect(screen.queryByTestId('undo-check-in')).not.toBeInTheDocument();
  });

  it('undo calls the server and removes the toast', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      checkedInAt: Date.now(),
      guest: {
        _id: 'g1',
        fullName: 'Aminata Diallo',
        plusOnesAllowed: 0,
        rsvpStatus: 'attending',
      },
    });
    undoActionMock.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);

    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));
    await screen.findByTestId('toast');

    await user.click(screen.getByTestId('undo-check-in'));

    await waitFor(() => expect(undoActionMock).toHaveBeenCalledWith(EVENT_ID, 'g1'));
    await waitFor(() => expect(screen.queryByTestId('toast')).not.toBeInTheDocument());
  });

  it('uses offline cache when navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);

    // Wait for cache population
    await waitFor(() =>
      expect(screen.getByTestId('connection-status')).toHaveTextContent(/offline/),
    );

    await user.type(screen.getByTestId('manual-token'), 'TK1');
    await user.click(screen.getByTestId('manual-submit'));

    expect(checkInActionMock).not.toHaveBeenCalled();
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-status', 'offline');
    expect(toast).toHaveTextContent('Aminata Diallo');
  });

  it('offline scan of unknown token surfaces an offline-unknown toast', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);

    await waitFor(() =>
      expect(screen.getByTestId('connection-status')).toHaveTextContent(/offline/),
    );

    await user.type(screen.getByTestId('manual-token'), 'NOPE');
    await user.click(screen.getByTestId('manual-submit'));

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-status', 'offline');
    expect(toast).toHaveTextContent(/unknownGuestOffline/);
  });

  it('scanner callback triggers submit on decoded text', async () => {
    checkInActionMock.mockResolvedValue({
      ok: true,
      alreadyCheckedIn: false,
      checkedInAt: Date.now(),
      guest: {
        _id: 'g2',
        fullName: 'Mamadou',
        plusOnesAllowed: 0,
        rsvpStatus: 'pending',
      },
    });

    render(<CheckInManager eventId={EVENT_ID} initialGuests={GUESTS} />);

    await waitFor(() => expect(scanHandler).not.toBeNull());
    scanHandler!('TK2');

    await waitFor(() => expect(checkInActionMock).toHaveBeenCalledWith(EVENT_ID, 'TK2'));
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent('Mamadou');
  });
});
