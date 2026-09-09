/**
 * Définition des templates d'invitation WhatsApp.
 *
 * Chaque style correspond à un template Meta validé (catégorie `marketing`),
 * avec 4 variables séquentielles dans le body :
 *   {{1}} = prénom de l'invité
 *   {{2}} = prénoms du couple ("Mamadou & Marie")
 *   {{3}} = date formatée ("30 avril 2026")
 *   {{4}} = mot perso du couple (max 60 chars — fallback poli si vide)
 *
 * Le bouton URL utilise une variable INDÉPENDANTE indexée à partir de {{1}}
 * côté bouton — c'est le qrCodeToken de l'invité, pas le mot perso. Meta
 * traite les vars body et bouton dans deux numérotations distinctes.
 *
 * Les `bodyText` ci-dessous correspondent **exactement** au texte qui sera
 * soumis à Meta Business Manager pour validation. Toute modification ici
 * doit être suivie d'une re-soumission Meta + nouvelle validation 24-48h.
 *
 * Catégorie Meta : `marketing` (les rappels J-7/J-1 utilisent des templates
 * `utility` séparés — cf. BACKLOG section "Templates WhatsApp Cloud API").
 */

export type InvitationStyleId = 'classic' | 'warm' | 'african' | 'minimal' | 'festive';

export interface InvitationStyle {
  id: InvitationStyleId;
  /** Nom de template Meta validé. Configurable via env var pour override. */
  metaTemplateName: string;
  /** Env var qui peut override le metaTemplateName pour ce style. */
  metaTemplateEnvVar: string;
  /** Body avec placeholders {{1}}…{{4}} — copie exacte du template Meta. */
  bodyText: string;
  /** Label CTA du bouton URL (max 25 chars selon Meta). */
  ctaLabel: string;
}

export const INVITATION_STYLES: Record<InvitationStyleId, InvitationStyle> = {
  classic: {
    id: 'classic',
    metaTemplateName: 'wedding_invitation_classic',
    metaTemplateEnvVar: 'WHATSAPP_INVITATION_TEMPLATE_CLASSIC',
    bodyText:
      "Bonjour {{1}},\n\n{{2}} ont l'honneur de vous convier à leur mariage le {{3}}.\n\n{{4}}\n\nNous vous remercions de bien vouloir confirmer votre présence en cliquant sur le bouton ci-dessous.",
    ctaLabel: 'Confirmer ma présence',
  },
  warm: {
    id: 'warm',
    metaTemplateName: 'wedding_invitation_warm',
    metaTemplateEnvVar: 'WHATSAPP_INVITATION_TEMPLATE_WARM',
    bodyText:
      "Coucou {{1}} !\n\n{{2}} se marient le {{3}} et nous serions ravis de vous compter parmi nous.\n\n{{4}}\n\nRéponds vite à l'invitation ci-dessous, on a hâte de te voir.",
    ctaLabel: 'Répondre',
  },
  african: {
    id: 'african',
    metaTemplateName: 'wedding_invitation_african',
    metaTemplateEnvVar: 'WHATSAPP_INVITATION_TEMPLATE_AFRICAN',
    bodyText:
      'Cher·chère {{1}},\n\nAvec joie et bénédictions, {{2}} célèbrent leur union le {{3}}. Votre présence sera notre plus belle bénédiction.\n\n{{4}}\n\nMerci de confirmer votre venue ci-dessous.',
    ctaLabel: 'Confirmer ma venue',
  },
  minimal: {
    id: 'minimal',
    metaTemplateName: 'wedding_invitation_minimal',
    metaTemplateEnvVar: 'WHATSAPP_INVITATION_TEMPLATE_MINIMAL',
    bodyText:
      'Save the date, {{1}}.\n\n{{2}}\nle {{3}}\n\n{{4}}\n\nMerci de répondre à cette invitation.',
    ctaLabel: 'Voir l’invitation',
  },
  festive: {
    id: 'festive',
    metaTemplateName: 'wedding_invitation_festive',
    metaTemplateEnvVar: 'WHATSAPP_INVITATION_TEMPLATE_FESTIVE',
    bodyText:
      '🎉 {{1}}, on a une grande nouvelle !\n\n{{2}} se disent OUI le {{3}} et on tient absolument à célébrer ce jour avec vous.\n\n{{4}}\n\nRendez-vous sur l’invitation pour confirmer votre présence.',
    ctaLabel: 'Je viens fêter ça !',
  },
};

export const DEFAULT_INVITATION_STYLE: InvitationStyleId = 'warm';

/**
 * Mot perso fallback quand le couple n'a rien saisi : Meta refuse les
 * variables vides, donc on envoie une phrase neutre par défaut.
 */
export const DEFAULT_PERSONAL_MESSAGE_FALLBACK = 'Au plaisir de vous voir.';

/**
 * Substitue les variables dans le bodyText pour générer un aperçu visuel
 * (utilisé par le composant WhatsAppMessageMockup, PAS pour l'envoi réel
 * — l'envoi passe les paramètres séparément à l'API Meta).
 */
export function renderInvitationPreview(
  styleId: InvitationStyleId,
  params: {
    guestFirstName: string;
    coupleNames: string;
    eventDate: string;
    /** Conservé pour compat — l'URL n'est plus dans le body, mais reste utile
     * pour des previews qui veulent l'afficher hors du template (ex: footer). */
    invitationUrl?: string;
    personalMessage: string;
  },
): string {
  const style = INVITATION_STYLES[styleId];
  const personalMessage = params.personalMessage.trim() || DEFAULT_PERSONAL_MESSAGE_FALLBACK;
  return style.bodyText
    .replace('{{1}}', params.guestFirstName)
    .replace('{{2}}', params.coupleNames)
    .replace('{{3}}', params.eventDate)
    .replace('{{4}}', personalMessage);
}

/**
 * Récupère le nom de template Meta à utiliser pour un style donné, en
 * tenant compte d'un éventuel override par env var.
 */
export function getMetaTemplateName(
  styleId: InvitationStyleId,
  env: Record<string, string | undefined> = process.env,
): string {
  const style = INVITATION_STYLES[styleId];
  return env[style.metaTemplateEnvVar] ?? style.metaTemplateName;
}

/* -------------------------------------------------------------------------- */
/*  Templates rappels J-7 / J-1                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tier de rappel envoyé aux invités `attending` à l'approche de l'event.
 * Cron quotidien dans `convex/reminders.ts` — fenêtre ±12 h autour de J-7
 * et J-1. Idempotence via `guests.reminderD7SentAt` / `reminderD1SentAt`.
 */
export type ReminderTier = 'd7' | 'd1';

/**
 * Env vars qui pointent vers les noms de templates Meta validés pour
 * chaque tier. Tant que les templates ne sont pas créés côté Meta Business
 * Manager (cf. BACKLOG section "Templates WhatsApp Cloud API"), l'absence
 * de l'env var déclenche un fallback email-only côté cron — l'envoi
 * WhatsApp est skip avec un warning, l'email reste envoyé.
 *
 * Variables body attendues côté template Meta (cf. spec dans BACKLOG) :
 *   D7 :
 *     {{1}} = prénom de l'invité
 *     {{2}} = prénoms du couple ("Aminata & Mamadou")
 *     {{3}} = date formatée ("30 avril 2026")
 *     {{4}} = lien personnalisé d'invitation (visible dans le body)
 *   D1 :
 *     {{1}} = prénom de l'invité
 *     {{2}} = prénoms du couple
 *     {{3}} = lieu / venue
 *     {{4}} = lien personnalisé d'invitation
 *
 * Le bouton URL dynamique reçoit le `qrCodeToken` (dernier segment de
 * `${baseUrl}/i/${qrCodeToken}`) — Meta exige le segment, pas l'URL pleine.
 */
export const REMINDER_TEMPLATE_ENV_VARS: Record<ReminderTier, string> = {
  d7: 'WHATSAPP_REMINDER_D7_TEMPLATE',
  d1: 'WHATSAPP_REMINDER_D1_TEMPLATE',
};

/**
 * Résout le nom de template Meta pour un tier de rappel donné. Retourne
 * `null` si l'env var correspondante n'est pas définie — le caller doit
 * alors fallback sur l'email seul (cf. BACKLOG : templates non créés côté
 * Meta tant que la grille tarifaire n'est pas finalisée).
 */
export function getReminderTemplateName(
  tier: ReminderTier,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[REMINDER_TEMPLATE_ENV_VARS[tier]];
  return value && value.trim().length > 0 ? value : null;
}

/* -------------------------------------------------------------------------- */
/*  Template « pass placement » (plan de table publié)                          */
/* -------------------------------------------------------------------------- */

/**
 * Env var pointant vers le template Meta « votre place à table », envoyé quand
 * l'organisateur publie son plan de placement.
 *
 * Variables body attendues côté template Meta :
 *   {{1}} = prénom de l'invité
 *   {{2}} = prénoms du couple ("Aminata & Mamadou")
 *   {{3}} = placement résumé ("Table des Pivoines · place 4")
 *   {{4}} = date formatée ("30 avril 2026")
 *
 * Le bouton URL dynamique reçoit `${qrCodeToken}/place` (Meta exige le
 * suffixe de chemin, pas l'URL pleine) → `${baseUrl}/i/{token}/place`.
 *
 * Tant que le template n'est pas validé côté Meta Business Manager (cf.
 * BACKLOG), `getSeatPassTemplateName` rend `null` et l'action bascule sur
 * l'email — l'envoi WhatsApp est simplement skip, jamais en erreur.
 */
export const SEAT_PASS_TEMPLATE_ENV_VAR = 'WHATSAPP_SEAT_PASS_TEMPLATE';

/** Nom du template Meta pour le pass placement, ou `null` si non configuré. */
export function getSeatPassTemplateName(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[SEAT_PASS_TEMPLATE_ENV_VAR];
  return value && value.trim().length > 0 ? value : null;
}
