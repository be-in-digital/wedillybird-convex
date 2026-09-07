import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou CI systémique anti-récidive du secret-gate (T2-7, plan de
 * lancement, F3).
 *
 * `webhook-secret-gate.test.ts` teste 4 mutations NOMMÉES — il n'attrape pas
 * une 5e mutation money/entitlement ajoutée en rush sans la garde
 * `assertWebhookSecret`. Ce test scanne le SOURCE : il énumère TOUTES les
 * mutations PUBLIQUES de `convex/*.ts` (`export const X = mutation({…})`,
 * hors `internalMutation`/`internalQuery`), retient celles dont le corps
 * touche un champ/table sensible (paiement, abonnement, crédit, entitlement —
 * `SENSITIVE_PATTERNS` ci-dessous), et échoue si l'une d'elles n'est NI
 * gardée par le secret webhook NI présente dans l'`ALLOW_LIST` avec une
 * raison documentée.
 *
 * Pas de plugin ESLint custom (infra inexistante, effort disproportionné pour
 * ce lot) — un test vitest qui lit les fichiers sources suffit et tourne dans
 * la même CI que le reste de la suite.
 *
 * Pourquoi un filtre par mots-clés plutôt que « toute mutation publique » :
 * ~120 mutations publiques existent dans ce repo, l'immense majorité sans
 * aucun rapport avec l'argent (CRM, planning, prestataires…) — les lister
 * TOUTES rendrait l'allow-list illisible et sa revue en PR sans valeur. Le
 * filtre reste volontairement LARGE (mots-clés de champs, pas de table) pour
 * ne pas manquer une mutation qui patch un champ sensible sans re-citer le
 * nom de la table.
 */

const CONVEX_DIR = path.resolve(__dirname, '../../../convex');

// Repère les mutations déjà gardées par le secret partagé, sous ses DEUX
// formes rencontrées dans le repo : l'helper partagé `assertWebhookSecret(...)`
// (convex/lib/webhookSecret.ts, ou une copie locale comme budget.ts/paymentLinks.ts)
// OU le pattern inline historique (organizations.ts:updateSubscriptionFromWebhook)
// qui compare `CONVEX_WEBHOOK_SECRET` et throw `INVALID_WEBHOOK_SECRET` sans
// passer par l'helper nommé.
const GATED_PATTERN = /(assertWebhookSecret\(|INVALID_WEBHOOK_SECRET)/;

// Champs/tables qui signent une mutation "money/entitlement" — dérivés des
// tables `payments`, `paygPurchases`, `paymentLinks`, `budgetPayments` et des
// champs d'abonnement/entitlement de `organizations`/`events`/`users`
// (convex/schema.ts). Volontairement au niveau CHAMP (pas juste nom de
// table) : un `ctx.db.patch(id, { subscriptionStatus: … })` ne re-cite jamais
// le nom de la table.
const SENSITIVE_PATTERNS: RegExp[] = [
  /['"]payments['"]/,
  /['"]paygPurchases['"]/,
  /['"]paymentLinks['"]/,
  /['"]budgetPayments['"]/,
  /\bamountMinor\b/,
  /\brefundedAmountMinor\b/,
  /\bstripeRefundId\b/,
  /\bcheckoutUrl\b/,
  /\breceiptUrl\b/,
  /\bproviderSessionId\b/,
  /\bproviderEventId\b/,
  /\bplanTier\b/,
  /\bpendingPlanTier\b/,
  /\bgalleryExpiresAt\b/,
  /\bpaygCredits\b/,
  /\bsubscriptionTier\b/,
  /\bsubscriptionStatus\b/,
  /\bsubscriptionPeriodEnd\b/,
  /\bstripeSubscriptionId\b/,
  /\bstripeCustomerId\b/,
  /\bstripeConnectAccountId\b/,
  /\bstripeConnectChargesEnabled\b/,
  /\bstripeConnectPayoutsEnabled\b/,
  /\bstripeConnectDetailsSubmitted\b/,
  /\bpaymentsMode\b/,
];

/**
 * Allow-list explicite des mutations publiques SENSIBLES (au sens
 * `SENSITIVE_PATTERNS`) mais SANS garde webhookSecret — état vérifié le
 * 2026-07-25 par inspection manuelle de chacune. Chaque groupe documente
 * POURQUOI ces mutations n'ont pas besoin du secret webhook : elles sont
 * gardées par un autre mécanisme d'autorisation légitime (session/ownership,
 * rôle admin), ou elles ne font que de la comptabilité `pending` — jamais un
 * marquage `succeeded`/`refunded` qui débloquerait un accès ou de l'argent.
 *
 * Toute nouvelle entrée ici doit être justifiée en revue de PR — c'est le
 * point de friction volontaire de ce garde-fou.
 */
const ALLOW_LIST = new Set<string>([
  // --- Admin (gardées par assertAdmin(ctx, adminId), pas un webhook) ---
  'admin.ts:markPaymentRefunded',
  'admin.ts:markSubscriptionCanceled',
  'admin.ts:markSubscriptionReactivated',
  // Forfait OFFERT (partenariat / geste commercial / démo) : posent `planTier`
  // + `galleryExpiresAt` sans transaction Stripe. C'est délibéré — c'est la
  // raison d'être de ces mutations — et c'est justement pourquoi elles sont
  // réservées au rôle admin, tracées dans `adminAuditLog` et marquées
  // `events.compedPlan` (un accès offert ne doit jamais se confondre avec un
  // revenu). La révocation refuse en plus tout event qui porte un paiement
  // `succeeded` : on ne coupe pas la galerie d'un client qui a payé.
  'admin.ts:grantEventPlan',
  'admin.ts:revokeEventPlan',

  // --- Bookkeeping "pending" : créent/attachent une session AVANT tout
  // encaissement confirmé — jamais un marquage succeeded/failed. Gardées par
  // requesterId/ownership. Symétrique de payments.ts:recordIntent. ---
  'budget.ts:createLine',
  'budget.ts:addPayment',
  'budget.ts:createOnlinePaymentIntent',
  'budget.ts:attachOnlineSession',
  'paymentLinks.ts:createIntent',
  'paymentLinks.ts:attachSession',
  'payments.ts:recordIntent',
  'quotes.ts:recordSchedulePayment', // saisie manuelle agence (paiement offline), requesterId

  // --- Espace couple self-serve (/mon-mariage) : ledger budget PRIVÉ du couple
  // (tables coupleVendors/couplePayments), pas le money-path Stripe. `amountMinor`
  // = suivi manuel « j'ai payé mon fleuriste 500 € » — jamais un `payments.status`
  // succeeded ni un déblocage d'entitlement. Chaque handler appelle
  // `assertOwnedEvent(ctx, eventId, requesterId)` en tête (ownership). Symétrique
  // des `budget.ts:*` ci-dessus, côté couple au lieu de l'agence. ---
  'coupleSpace.ts:addVendor',
  'coupleSpace.ts:updateVendor',
  'coupleSpace.ts:addPayment',
  'coupleSpace.ts:setPaymentPaid',

  // --- Suppression, gardée par ownership (assertOrgWrite/loadLineForWrite) —
  // ne marquent jamais rien `succeeded`, juste un retrait de ligne/lien ---
  'budget.ts:removeLine',
  'budget.ts:removePayment',
  'paymentLinks.ts:remove',

  // --- Lecture/vérification d'entitlement (pas une écriture money) ---
  'events.ts:reconcileMaxGuests', // recalcule le cap invités depuis planTier existant
  'events.ts:create', // pose pendingPlanTier (intention pré-paiement), requesterId
  'events.ts:publish', // vérifie planTier/quota avant publication, ownerId
  'vendors.ts:create', // vérifie le cap "Starter ≤ 25" via org.subscriptionTier

  // --- Self-service agence sur SES PROPRES réglages (assertCanManage /
  // ownership), jamais un callback provider ---
  'organizations.ts:setPaymentsSettings',
  'organizations.ts:updateWhiteLabel', // vérifie subscriptionTier == 'agency'
  'organizations.ts:invite', // vérifie seatLimitForTier(subscriptionTier)
  'organizations.ts:reactivateMember', // idem
  'organizations.ts:setConnectAccount',
  'organizations.ts:updateConnectStatus',
  'organizations.ts:disconnectStripeAccount',
]);

/** Fichiers `convex/*.ts` de premier niveau (pas `convex/lib/`, `convex/_generated/`). */
function listConvexFiles(): string[] {
  return fs
    .readdirSync(CONVEX_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name);
}

interface FoundMutation {
  name: string;
  block: string;
}

/**
 * Extrait chaque bloc `export const X = mutation({ … });` par appariement
 * d'accolades (pas un vrai parseur AST — volontaire, cf. note ESLint
 * ci-dessus). Suffisant tant que le style `mutation({` reste sur une seule
 * ligne, la convention uniforme observée dans tout `convex/*.ts`.
 */
function extractPublicMutations(source: string): FoundMutation[] {
  const results: FoundMutation[] = [];
  const re = /export const (\w+) = mutation\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1]!;
    const start = match.index;
    const braceStart = source.indexOf('{', match.index + match[0].length - 1);
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    results.push({ name, block: source.slice(start, i + 1) });
  }
  return results;
}

describe('Garde-fou CI — mutations publiques money/entitlement sans webhookSecret (T2-7)', () => {
  const files = listConvexFiles();
  expect(files.length).toBeGreaterThan(20); // sanity : on lit bien le vrai dossier convex/

  const offenders: string[] = [];
  const staleAllowListEntries = new Set(ALLOW_LIST);
  let totalMutations = 0;
  let sensitiveCount = 0;

  for (const fileName of files) {
    const source = fs.readFileSync(path.join(CONVEX_DIR, fileName), 'utf-8');
    for (const { name, block } of extractPublicMutations(source)) {
      totalMutations += 1;
      const isSensitive = SENSITIVE_PATTERNS.some((re) => re.test(block));
      if (!isSensitive) continue;
      sensitiveCount += 1;

      const key = `${fileName}:${name}`;
      const isGated = GATED_PATTERN.test(block);
      if (isGated) continue;
      if (ALLOW_LIST.has(key)) {
        staleAllowListEntries.delete(key);
        continue;
      }
      offenders.push(key);
    }
  }

  it('a bien trouvé des mutations publiques à auditer (sanity du scanner)', () => {
    expect(totalMutations).toBeGreaterThan(50);
    expect(sensitiveCount).toBeGreaterThan(0);
  });

  it('toute mutation publique sensible est gardée par assertWebhookSecret OU allow-listée explicitement', () => {
    expect(offenders).toEqual([]);
  });

  it("l'allow-list ne contient pas d'entrée obsolète (mutation renommée/supprimée/désormais gardée/plus sensible)", () => {
    // Anti-dérive dans l'autre sens : une entrée qui ne matche plus rien doit
    // être retirée, sinon l'allow-list grossit sans jamais être nettoyée et
    // perd sa valeur de revue.
    expect([...staleAllowListEntries]).toEqual([]);
  });
});
