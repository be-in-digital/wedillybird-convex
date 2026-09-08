'use client';

import { useState } from 'react';
import { Bug, ImageIcon, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useServerAction } from '@/components/admin/use-admin-action';
import { formatDateTime } from '@/lib/admin/format';
import {
  adminUpdateBugStatusAction,
  adminGetBugScreenshotAction,
} from '@/app/[locale]/(app)/admin/actions';
import { AdminCardList } from './ui/card-list';
import { AdminFilterOption, AdminFilterSelect } from './ui/filter-select';
import { StatusPill, type StatusTone } from './ui/status-pill';

type Status = 'open' | 'triaged' | 'resolved';

interface BugReport {
  _id: string;
  reporterId?: string;
  url: string;
  pathname: string;
  description: string;
  userAgent?: string;
  viewport?: string;
  locale?: string;
  consoleErrors?: string[];
  status: Status;
  createdAt: number;
  hasScreenshot: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  open: 'À traiter',
  triaged: 'En cours',
  resolved: 'Résolu',
};

const STATUS_TONE: Record<Status, StatusTone> = {
  open: 'danger',
  triaged: 'progress',
  resolved: 'success',
};

const STATUS_ORDER: Status[] = ['open', 'triaged', 'resolved'];

/**
 * Signalements de bug. Un signalement est un document (description libre, pile
 * d'erreurs console, capture) : il reste en carte à toutes les largeurs.
 */
export function AdminBugReportsTable({ reports }: { reports: BugReport[] }) {
  // Par défaut on masque les signalements résolus : la file de travail, c'est
  // ce qui reste à traiter, pas l'historique complet.
  const [statusFilter, setStatusFilter] = useState<string>('unresolved');

  const filtered = reports.filter((r) =>
    statusFilter === 'all'
      ? true
      : statusFilter === 'unresolved'
        ? r.status !== 'resolved'
        : r.status === statusFilter,
  );

  return (
    <AdminCardList
      rows={filtered}
      getRowId={(r) => r._id}
      searchable={(r) => `${r.description} ${r.pathname} ${r.locale ?? ''} ${r.viewport ?? ''}`}
      searchPlaceholder="Rechercher une description, une page…"
      emptyTitle={
        statusFilter === 'unresolved' ? 'Aucun signalement en attente' : 'Aucun signalement de bug'
      }
      emptyDescription={
        statusFilter === 'unresolved'
          ? 'Tout ce qui a été remonté est traité. Basculez le filtre sur « Tous » pour revoir l’historique.'
          : 'Les signalements envoyés depuis le bouton d’aide apparaîtront ici.'
      }
      emptyIcon={Bug}
      filters={
        <AdminFilterSelect label="Statut" value={statusFilter} onValueChange={setStatusFilter}>
          <AdminFilterOption value="unresolved">À traiter</AdminFilterOption>
          <AdminFilterOption value="all">Tous</AdminFilterOption>
          {STATUS_ORDER.map((s) => (
            <AdminFilterOption key={s} value={s}>
              {STATUS_LABEL[s]}
            </AdminFilterOption>
          ))}
        </AdminFilterSelect>
      }
      renderCard={(report) => <BugCard report={report} />}
    />
  );
}

function BugCard({ report }: { report: BugReport }) {
  const { execute, loading, error } = useServerAction(adminUpdateBugStatusAction);
  const [shot, setShot] = useState<string | null>(null);
  const [shotOpen, setShotOpen] = useState(false);
  const [shotLoading, setShotLoading] = useState(false);

  async function viewShot() {
    setShotOpen(true);
    if (shot) return;
    setShotLoading(true);
    const res = await adminGetBugScreenshotAction(report._id);
    setShotLoading(false);
    if (res.ok) setShot(res.screenshot);
  }

  const errorCount = report.consoleErrors?.length ?? 0;

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 sm:flex-row sm:items-start sm:justify-between"
      data-status={report.status}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</StatusPill>
          <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
            {formatDateTime(report.createdAt)}
          </span>
        </div>

        <p className="text-sm font-medium text-[color:var(--color-foreground)]">
          {report.description}
        </p>

        <p className="font-mono text-xs break-all text-[color:var(--color-muted-foreground)]">
          {report.pathname}
          {report.viewport ? ` · ${report.viewport}` : ''}
          {report.locale ? ` · ${report.locale}` : ''}
        </p>

        {errorCount > 0 ? (
          <details className="text-xs text-[color:var(--color-muted-foreground)]">
            <summary className="focus-ring cursor-pointer rounded">
              {errorCount} erreur{errorCount > 1 ? 's' : ''} console
            </summary>
            <pre className="mt-1.5 max-h-64 max-w-full overflow-auto rounded-md bg-[color:var(--color-surface-elevated)] p-2 font-mono text-[0.6875rem] whitespace-pre-wrap">
              {report.consoleErrors!.join('\n')}
            </pre>
          </details>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-[color:var(--color-destructive)]">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {report.hasScreenshot ? (
          <button
            type="button"
            onClick={() => void viewShot()}
            className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)]"
          >
            <ImageIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            Capture
          </button>
        ) : null}
        <Select
          value={report.status}
          onValueChange={(v) => execute(report._id, v as Status)}
          disabled={loading}
        >
          <SelectTrigger
            aria-label="Statut du signalement"
            className="h-10 min-w-[8.5rem] rounded-lg text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={shotOpen} onOpenChange={setShotOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Capture du signalement</DialogTitle>
          </DialogHeader>
          {shotLoading ? (
            <div className="flex items-center justify-center py-16 text-[color:var(--color-muted-foreground)]">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            </div>
          ) : shot ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL stockée en base
            <img
              src={shot}
              alt="Capture du bug"
              className="w-full rounded-lg border border-[color:var(--color-border)]"
            />
          ) : (
            <p className="py-10 text-center text-sm text-[color:var(--color-muted-foreground)]">
              Capture indisponible.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
