'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  adminSendNewsletterAction,
  adminSendNewsletterTestAction,
  type NewsletterCampaign,
} from '@/app/[locale]/(app)/admin/actions';
import { formatDateTime } from '@/lib/admin/format';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { AdminSection } from './ui/section';
import { StatusPill, type StatusTone } from './ui/status-pill';

const STATUS_LABEL: Record<string, string> = {
  sending: 'En cours',
  sent: 'Envoyée',
  failed: 'Échouée',
};
const STATUS_TONE: Record<string, StatusTone> = {
  sending: 'progress',
  sent: 'success',
  failed: 'danger',
};

export function AdminNewsletterComposer({
  activeCount,
  campaigns,
}: {
  activeCount: number;
  campaigns: NewsletterCampaign[];
}) {
  const locale = useLocale();
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testing, startTest] = useTransition();

  const canCompose = subject.trim().length > 0 && body.trim().length > 0;

  function sendTest() {
    setFeedback(null);
    startTest(async () => {
      const res = await adminSendNewsletterTestAction(subject, body);
      setFeedback(
        res.ok
          ? { kind: 'ok', text: `Test envoyé à ${res.recipient}.` }
          : { kind: 'err', text: errorLabel(res.error) },
      );
    });
  }

  const campaignColumns: AdminColumn<NewsletterCampaign>[] = [
    {
      id: 'subject',
      header: 'Objet',
      card: 'title',
      sortValue: (c) => c.subject,
      cell: (c) => <span className="font-medium">{c.subject}</span>,
    },
    {
      id: 'status',
      header: 'Statut',
      card: 'badge',
      sortValue: (c) => c.status,
      cell: (c) => (
        <StatusPill tone={STATUS_TONE[c.status] ?? 'neutral'}>
          {STATUS_LABEL[c.status] ?? c.status}
        </StatusPill>
      ),
    },
    {
      id: 'recipients',
      header: 'Destinataires',
      align: 'right',
      sortValue: (c) => c.totalRecipients,
      cell: (c) => <span className="font-mono tabular-nums">{c.totalRecipients}</span>,
    },
    {
      id: 'sent',
      header: 'Envoyés',
      align: 'right',
      sortValue: (c) => c.sentCount,
      cell: (c) => (
        <span className="font-mono text-[color:var(--color-success)] tabular-nums">
          {c.sentCount}
        </span>
      ),
    },
    {
      id: 'failed',
      header: 'Échecs',
      align: 'right',
      sortValue: (c) => c.failedCount,
      cell: (c) =>
        c.failedCount > 0 ? (
          <span className="font-mono text-[color:var(--color-danger)] tabular-nums">
            {c.failedCount}
          </span>
        ) : (
          <span className="text-[color:var(--color-muted-foreground)]">—</span>
        ),
      hideBelow: 'lg',
    },
    {
      id: 'date',
      header: 'Date',
      sortValue: (c) => c.sentAt ?? c.createdAt,
      cell: (c) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDateTime(c.sentAt ?? c.createdAt, locale)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
        <div>
          <h2 className="font-display text-lg italic">Composer une newsletter</h2>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            Envoyée via AWS SES aux <strong>{activeCount}</strong> abonné
            {activeCount > 1 ? 's' : ''} actif{activeCount > 1 ? 's' : ''}. Un lien de
            désinscription est ajouté automatiquement.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
            Objet
          </span>
          <Input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex. Les nouveautés Wedillybird de juin"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
            Message
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder={
              'Bonjour,\n\nVoici les dernières nouvelles…\n\nLaissez une ligne vide entre les paragraphes. Les liens https://… deviennent cliquables.'
            }
            className="focus-ring w-full resize-y rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm leading-relaxed text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]"
          />
        </label>

        {feedback ? (
          <p
            className={`text-sm ${feedback.kind === 'ok' ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-danger)]'}`}
          >
            {feedback.text}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={sendTest}
            disabled={!canCompose || testing}
          >
            {testing ? 'Envoi du test…' : 'Envoyer un test (à moi-même)'}
          </Button>
          <SendAllDialog
            subject={subject}
            body={body}
            activeCount={activeCount}
            disabled={!canCompose}
            onSent={(text) => {
              setFeedback({ kind: 'ok', text });
              setSubject('');
              setBody('');
              router.refresh();
            }}
            onError={(text) => setFeedback({ kind: 'err', text })}
          />
        </div>
      </section>

      <AdminSection
        title="Campagnes envoyées"
        description="Historique des envois, du plus récent au plus ancien."
        bare
      >
        <AdminDataTable
          rows={campaigns}
          columns={campaignColumns}
          getRowId={(c) => c._id}
          searchable={(c) => c.subject}
          initialSort={{ id: 'date', dir: 'desc' }}
          emptyTitle="Aucune campagne envoyée"
          emptyDescription="Composez un message ci-dessus pour lancer votre première campagne."
          emptyIcon={Send}
        />
      </AdminSection>
    </div>
  );
}

function SendAllDialog({
  subject,
  body,
  activeCount,
  disabled,
  onSent,
  onError,
}: {
  subject: string;
  body: string;
  activeCount: number;
  disabled: boolean;
  onSent: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await adminSendNewsletterAction(subject, body);
      if (res.ok) {
        onSent(`Campagne envoyée : ${res.sentCount} envoyés, ${res.failedCount} échecs.`);
        setOpen(false);
      } else {
        onError(errorLabel(res.error));
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm" type="button" disabled={disabled || activeCount === 0}>
          Envoyer à tous ({activeCount})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Envoyer la newsletter ?</DialogTitle>
          <DialogDescription>
            La campagne « {subject} » va être envoyée à <strong>{activeCount}</strong> abonné
            {activeCount > 1 ? 's' : ''} actif{activeCount > 1 ? 's' : ''} via AWS SES. Cette action
            est irréversible. Pense à t&apos;envoyer un test avant.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button" disabled={pending}>
              Annuler
            </Button>
          </DialogClose>
          <Button variant="primary" size="sm" type="button" onClick={confirm} disabled={pending}>
            {pending ? 'Envoi en cours…' : `Confirmer l’envoi (${activeCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errorLabel(code: string): string {
  const map: Record<string, string> = {
    EMPTY_CONTENT: 'Objet et message sont requis.',
    NO_SUBSCRIBERS: 'Aucun abonné actif à qui envoyer.',
    NO_ADMIN_EMAIL: 'Ton compte admin n’a pas d’email pour recevoir le test.',
    FORBIDDEN: 'Accès refusé.',
  };
  return map[code] ?? `Erreur : ${code}`;
}
