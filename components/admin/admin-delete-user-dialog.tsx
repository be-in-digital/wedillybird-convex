'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  adminDeleteUserAction,
  adminUserDeletionPreviewAction,
  type UserDeletionPreview,
} from '@/app/[locale]/(app)/admin/actions';

/**
 * Suppression définitive d'un compte, depuis /admin/users.
 *
 * Une modale et non la confirmation générique, pour deux raisons :
 *
 *  1. **L'inventaire d'abord.** La cascade descend jusqu'aux invités et aux
 *     photos ; un bouton qui ne dit pas ce qu'il emporte ne se clique jamais.
 *     L'aperçu est lu côté serveur à l'ouverture, et affiché tel quel.
 *  2. **Le libellé retapé.** Le tableau est dense et la suppression n'a pas de
 *     retour arrière : on demande le nom (ou l'e-mail) du compte, comme la zone
 *     de danger d'une agence demande le sien. Convex revérifie.
 *
 * Les blocages (abonnement Stripe encore actif, agence avec une équipe) sont
 * rendus AVANT toute saisie, avec ce qu'il faut faire pour les lever : ils sont
 * réparables par l'admin, ce ne sont pas des culs-de-sac.
 */
export function AdminDeleteUserDialog({
  userId,
  displayName,
  open,
  onOpenChange,
}: {
  userId: string;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {/* Le contenu est monté par le portail à l'ouverture seulement : c'est
            ce montage qui remet l'aperçu et la saisie à zéro, sans avoir à les
            réinitialiser à la main d'une ouverture à l'autre. */}
        <DeleteUserBody userId={userId} displayName={displayName} onDone={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserBody({
  userId,
  displayName,
  onDone,
}: {
  userId: string;
  displayName: string;
  onDone: (open: boolean) => void;
}) {
  const t = useTranslations('Admin');
  const router = useRouter();
  const [preview, setPreview] = useState<UserDeletionPreview | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void adminUserDeletionPreviewAction(userId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const blocked =
    preview != null &&
    (preview.blockers.isAdmin ||
      preview.blockers.billedOrgs.length > 0 ||
      preview.blockers.teamOrgs.length > 0);
  const matches = preview != null && value.trim() === preview.label;

  function submit() {
    if (!preview || blocked || !matches) return;
    setError(null);
    startTransition(async () => {
      const res = await adminDeleteUserAction(userId, preview.label);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone(false);
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('users.deleteTitle', { name: displayName })}</DialogTitle>
        <DialogDescription>{t('users.deleteBody')}</DialogDescription>
      </DialogHeader>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('users.deleteLoading')}
        </p>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-[color:var(--color-border)] p-3 text-sm">
            <Row label={t('users.deleteOrganizations')} value={preview.counts.organizations} />
            <Row label={t('users.deleteEvents')} value={preview.counts.events} />
            <Row label={t('users.deleteGuests')} value={preview.counts.guests} />
            <Row label={t('users.deletePhotos')} value={preview.counts.photos} />
            <Row label={t('users.deletePayments')} value={preview.counts.payments} />
          </dl>

          {preview.counts.reassignedEvents > 0 ? (
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              {t('users.deleteReassigned', { count: preview.counts.reassignedEvents })}
            </p>
          ) : null}
          {preview.detachedAffiliateCodes.length > 0 ? (
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              {t('users.deleteDetached', { codes: preview.detachedAffiliateCodes.join(', ') })}
            </p>
          ) : null}

          {blocked ? (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 p-3 text-sm text-[color:var(--color-danger)]"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>
                {preview.blockers.isAdmin
                  ? t('users.deleteBlockedAdmin')
                  : preview.blockers.billedOrgs.length > 0
                    ? t('users.deleteBlockedBilled', {
                        orgs: preview.blockers.billedOrgs.join(', '),
                      })
                    : t('users.deleteBlockedTeam', { orgs: preview.blockers.teamOrgs.join(', ') })}
              </span>
            </div>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[color:var(--color-muted-foreground)]">
                {t('users.deleteConfirmLabel', { label: preview.label })}
              </span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={preview.label}
                autoComplete="off"
                data-testid="admin-delete-user-confirm"
                className="h-10 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 font-mono text-sm text-[color:var(--color-foreground)] focus:ring-1 focus:ring-[color:var(--color-danger)] focus:outline-none"
              />
            </label>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[color:var(--color-danger)]">
          {t('users.deleteError', { code: error })}
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" size="md" type="button" onClick={() => onDone(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="destructive"
          size="md"
          type="button"
          onClick={submit}
          disabled={pending || blocked || !matches}
        >
          {pending ? t('users.deleteDeleting') : t('users.deleteCta')}
        </Button>
      </DialogFooter>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-[color:var(--color-muted-foreground)]">{label}</dt>
      <dd className="text-right font-mono text-[color:var(--color-foreground)]">{value}</dd>
    </>
  );
}
