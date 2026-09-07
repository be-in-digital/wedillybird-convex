import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Locale } from '../../i18n/routing';
import { getServerTranslator, toIntlTag } from '../i18n/server-translator';
import type { Currency, PlanTier } from './plans';
import { formatAmount } from './plans';
import { vatBreakdownFor } from './vat';
import { formatSiren, formatSiret, LEGAL_ENTITY } from '../legal/entity';
import type { LegalEntity } from '../legal/entity';

/**
 * Génération d'une facture PDF post-paiement Stripe pour les particuliers
 * (Essentiel / Premium). Téléchargeable depuis le compte ou depuis l'email
 * post-paiement (l'envoi par mail est géré séparément côté Convex).
 *
 * Notes TVA : le taux vient de `lib/payments/vat.ts`, source unique partagée
 * avec l'assiette de commission du programme partenaire. Les prix EUR sont TTC
 * (20 % isolés en pied de facture) ; pour les devises hors zone euro, la
 * prestation n'est pas taxable en France et la facture porte la mention
 * correspondante au lieu d'une ligne de TVA.
 *
 * L'identité de l'émetteur (dénomination, SIREN, TVA intracommunautaire,
 * siège) vient de `lib/legal/entity.ts` et non des fichiers de messages : un
 * SIREN ne se traduit pas.
 */

export interface InvoicePayment {
  paymentId: string;
  invoiceNumber: string;
  /** Date d'émission en ms epoch. */
  issuedAt: number;
  /** Date de paiement (paid). */
  paidAt: number;
  /** Plan pour un paiement de forfait ; absent pour un upsell HD post-event. */
  plan?: PlanTier;
  amountMinor: number;
  currency: Currency;
  provider: 'stripe' | 'mock';
  customer: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  eventTitle?: string;
  /** Locale de rendu du PDF. Par défaut `fr`. */
  locale?: Locale | string;
}

type InvoiceTranslator = ReturnType<typeof getServerTranslator>;

/**
 * Mentions d'identification de l'émetteur, dans l'ordre où elles s'impriment.
 *
 * Les champs encore inconnus sont **omis** plutôt que remplis d'un gabarit :
 * une facture à laquelle il manque une ligne se corrige, une facture qui
 * affiche « à compléter » est déjà partie chez un client. `pendingLegalFields()`
 * dit ce qui manque encore, et doit être vide avant la première vente.
 *
 * L'entité est un paramètre pour que chaque branche (SIRET connu ou non, siège
 * renseigné ou non) soit vérifiable sans attendre l'immatriculation complète.
 */
export function buildIssuerLines(
  t: InvoiceTranslator,
  entity: LegalEntity = LEGAL_ENTITY,
): string[] {
  return [
    `${entity.tradeName} — ${entity.legalName}`,
    ...(entity.registeredAddress ?? []),
    entity.contactEmail,
    // Le SIRET identifie l'établissement, le SIREN l'entreprise : on imprime
    // le plus précis des deux dont on dispose.
    entity.siret
      ? t('Invoice.issuerSiret', { value: formatSiret(entity.siret) })
      : t('Invoice.issuerSiren', { value: formatSiren(entity.siren) }),
    t('Invoice.issuerVatNumber', { value: entity.vatNumber }),
    entity.rcsCity ? `RCS ${entity.rcsCity} ${formatSiren(entity.siren)}` : null,
  ].filter((line): line is string => Boolean(line));
}

const PROVIDER_LABEL: Record<'stripe' | 'mock', string> = {
  stripe: 'Stripe',
  mock: 'Test',
};

/**
 * Décomposition HT/TVA de la facture. Délègue à `lib/payments/vat.ts`, source
 * unique partagée avec l'assiette de commission du programme partenaire : un
 * partenaire qui recalcule sa commission depuis la facture d'un couple doit
 * tomber exactement sur notre chiffre.
 */
function vatBreakdown(payment: InvoicePayment): {
  ht: number;
  vatRate: number;
  vatAmount: number;
} {
  const { htMinor, rate, vatMinor } = vatBreakdownFor(payment.amountMinor, payment.currency);
  return { ht: htMinor, vatRate: rate, vatAmount: vatMinor };
}

function formatDate(ms: number, locale: Locale | string | undefined): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(ms));
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#d4a574',
  },
  brand: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#b85d2e',
  },
  brandTag: {
    fontSize: 9,
    color: '#666',
    marginTop: 2,
  },
  invoiceTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
  },
  invoiceMeta: {
    fontSize: 9,
    color: '#444',
    marginTop: 4,
    textAlign: 'right',
  },
  twoColumns: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 24,
  },
  column: {
    flex: 1,
  },
  blockTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  blockBody: {
    fontSize: 10,
    lineHeight: 1.4,
  },
  table: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#faf5ef',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  th: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  td: {
    fontSize: 10,
  },
  colDescription: {
    flex: 3,
  },
  colAmount: {
    flex: 1,
    textAlign: 'right',
  },
  totals: {
    marginTop: 18,
    alignSelf: 'flex-end',
    width: '50%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalRowGrand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  totalLabel: {
    fontSize: 10,
    color: '#444',
  },
  totalLabelGrand: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
  },
  totalValue: {
    fontSize: 10,
  },
  totalValueGrand: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: '#888',
    lineHeight: 1.5,
    textAlign: 'center',
  },
});

export interface InvoicePDFProps {
  payment: InvoicePayment;
}

export function InvoicePDF({ payment }: InvoicePDFProps) {
  const t = getServerTranslator(payment.locale);
  const { ht, vatRate, vatAmount } = vatBreakdown(payment);
  const planLabel = payment.plan
    ? payment.plan === 'essential'
      ? t('Invoice.planEssentialFull')
      : t('Invoice.planPremiumFull')
    : t('Invoice.lineUpsellHd');
  const customerLines = [
    payment.customer.fullName,
    payment.customer.email,
    payment.customer.phone,
  ].filter((line): line is string => Boolean(line));
  const issuerLines = buildIssuerLines(t);

  return (
    <Document
      title={`${t('Invoice.title')} ${payment.invoiceNumber}`}
      author="Wedillybird"
      subject={`${t('Invoice.title')} ${payment.invoiceNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Wedillybird</Text>
            <Text style={styles.brandTag}>{t('Invoice.brandTagline')}</Text>
          </View>
          <View>
            <Text style={styles.invoiceTitle}>{t('Invoice.title')}</Text>
            <Text style={styles.invoiceMeta}>
              {t('Invoice.number', { value: payment.invoiceNumber })}
            </Text>
            <Text style={styles.invoiceMeta}>
              {t('Invoice.issuedOn', { date: formatDate(payment.issuedAt, payment.locale) })}
            </Text>
            <Text style={styles.invoiceMeta}>
              {t('Invoice.paidOn', { date: formatDate(payment.paidAt, payment.locale) })}
            </Text>
          </View>
        </View>

        <View style={styles.twoColumns}>
          <View style={styles.column}>
            <Text style={styles.blockTitle}>{t('Invoice.issuerBlockTitle')}</Text>
            <Text style={styles.blockBody}>{issuerLines.join('\n')}</Text>
          </View>
          <View style={styles.column}>
            <Text style={styles.blockTitle}>{t('Invoice.customerBlockTitle')}</Text>
            <Text style={styles.blockBody}>
              {customerLines.length > 0 ? customerLines.join('\n') : t('Invoice.customerFallback')}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colDescription]}>{t('Invoice.columnDescription')}</Text>
            <Text style={[styles.th, styles.colAmount]}>{t('Invoice.columnAmountTtc')}</Text>
          </View>
          <View style={styles.tableRow}>
            <View style={styles.colDescription}>
              <Text style={styles.td}>{planLabel}</Text>
              {payment.eventTitle ? (
                <Text style={[styles.td, { color: '#888', marginTop: 2 }]}>
                  {t('Invoice.eventReference', { title: payment.eventTitle })}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.td, styles.colAmount]}>
              {formatAmount(payment.amountMinor, payment.currency)}
            </Text>
          </View>
        </View>

        <View style={styles.totals}>
          {vatRate > 0 ? (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t('Invoice.totalHt')}</Text>
                <Text style={styles.totalValue}>{formatAmount(ht, payment.currency)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {t('Invoice.vatLabel', { rate: (vatRate * 100).toFixed(0) })}
                </Text>
                <Text style={styles.totalValue}>{formatAmount(vatAmount, payment.currency)}</Text>
              </View>
            </>
          ) : (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t('Invoice.vatNotApplicable')}</Text>
              <Text style={styles.totalValue}>—</Text>
            </View>
          )}
          <View style={styles.totalRowGrand}>
            <Text style={styles.totalLabelGrand}>{t('Invoice.totalTtc')}</Text>
            <Text style={styles.totalValueGrand}>
              {formatAmount(payment.amountMinor, payment.currency)}
            </Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {t('Invoice.footerSettledVia', {
            provider: PROVIDER_LABEL[payment.provider],
            date: formatDate(payment.paidAt, payment.locale),
          })}{' '}
          {t('Invoice.footerRetention')}
          {'\n'}
          {t('Invoice.footerSupport', { number: payment.invoiceNumber })}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Génère un numéro de facture lisible : `WB-YYYY-XXXXX` où XXXXX dérive de
 * l'identifiant Convex du paiement (8 derniers chars upcase). Stable et
 * idempotent : la même row payments produira toujours le même numéro.
 */
export function buildInvoiceNumber(paymentId: string, issuedAt: number): string {
  const year = new Date(issuedAt).getFullYear();
  const suffix = paymentId.slice(-8).toUpperCase();
  return `WB-${year}-${suffix}`;
}
