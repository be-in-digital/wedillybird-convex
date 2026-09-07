/**
 * Wrapper unifié autour de l'API Meta Cloud (`POST /v{X}/{phoneNumberId}/messages`).
 *
 * Avant ce module, 4-6 fichiers Convex (`auth.ts`, `invitationActions.ts`,
 * `reminderActions.ts`, `whatsappTemplateNotifications.ts`, …) implémentaient
 * leur propre `fetch` quasi-identique avec leurs petites variantes (libellés
 * de log, gestion d'erreur, etc.). On centralise ici la mécanique transport
 * + mock + parsing d'erreur. Les appelants gardent leur logique métier
 * propre (decision d'erreur business, marquage idempotent, etc.).
 *
 * ⚠️ Volontairement minimal : pas d'auth, pas de retry, pas de queue. Si on
 * a besoin d'un de ces comportements à l'avenir, on l'ajoute ici (et on en
 * profite pour tous les call-sites en bénéficient).
 */

export interface WhatsAppCloudParameter {
  type: 'text';
  text: string;
}

export interface WhatsAppCloudComponent {
  type: 'body' | 'header' | 'button';
  /** WhatsApp button-specific fields. */
  sub_type?: 'url' | 'quick_reply';
  index?: string;
  parameters: WhatsAppCloudParameter[];
}

export interface WhatsAppCloudSendInput {
  /** Numéro destinataire en E.164 (avec ou sans le `+` en tête). */
  to: string;
  templateName: string;
  /** Default: 'fr'. */
  languageCode?: string;
  components: WhatsAppCloudComponent[];
  /** Default: 'v23.0' (aligné avec les call-sites historiques). */
  graphVersion?: string;
}

export interface WhatsAppCloudEnv {
  accessToken: string;
  phoneNumberId: string;
}

export interface WhatsAppCloudSendResult {
  ok: boolean;
  /** Identifiant Meta du message envoyé (présent quand `ok: true` et pas mock). */
  messageId?: string;
  /** Mode mock activé via `E2E_MODE=1` ou credentials absents. */
  mock?: boolean;
  /** Message d'erreur lisible (présent quand `ok: false`). */
  error?: string;
  /**
   * Code d'erreur **Meta** (`error.code` de la réponse Graph), quand Meta en
   * renvoie un. C'est lui qui distingue un refus définitif (131030 : numéro
   * hors liste autorisée d'un WABA non vérifié ; 131026 : destinataire sans
   * compte WhatsApp) d'un incident passager. Sans lui, tout échec se ressemble
   * et on ne peut pas dire à quelqu'un pourquoi son numéro ne reçoit rien.
   */
  errorCode?: number;
  /** Code HTTP si l'erreur vient du transport. */
  httpStatus?: number;
}

/**
 * Indique si Meta Cloud est configuré côté env Convex.
 * Si `false`, les `sendWhatsAppCloudTemplate` retournent en mode mock.
 */
export function isWhatsAppCloudConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Indique si on doit forcer le mode mock (E2E ou credentials absents).
 */
export function shouldUseWhatsAppMock(): boolean {
  if (process.env.E2E_MODE === '1') return true;
  return !isWhatsAppCloudConfigured();
}

/**
 * Construit l'URL Graph API à partir de `phoneNumberId` + `graphVersion`.
 */
export function buildWhatsAppCloudUrl(env: WhatsAppCloudEnv, graphVersion?: string): string {
  return `https://graph.facebook.com/${graphVersion ?? 'v23.0'}/${env.phoneNumberId}/messages`;
}

/**
 * Codes Meta qui signifient « ce destinataire ne recevra PAS ce message », par
 * opposition à un incident passager qu'un réessai réglerait.
 *
 *  - `131030` : le numéro n'est pas dans la liste autorisée du WABA. C'est
 *    l'état d'un compte Meta pas encore vérifié : seuls les numéros de test
 *    ajoutés à la main reçoivent quoi que ce soit. Symptôme caractéristique —
 *    le numéro du fondateur marche, tout autre numéro échoue.
 *  - `131026`, `131051` : destinataire injoignable — le plus souvent aucun
 *    compte WhatsApp actif sur ce numéro.
 *
 * Les distinguer permet de dire « ce numéro ne peut pas recevoir le code »
 * plutôt que « une erreur est survenue, réessayez » à quelqu'un qui réessaiera
 * en boucle sans succès.
 */
export const WHATSAPP_UNDELIVERABLE_CODES = [131030, 131026, 131051] as const;

/** Meta a-t-il refusé définitivement CE destinataire ? */
export function isUndeliverableRecipient(errorCode?: number): boolean {
  if (typeof errorCode !== 'number') return false;
  return (WHATSAPP_UNDELIVERABLE_CODES as readonly number[]).includes(errorCode);
}

/**
 * Envoie un template WhatsApp Cloud. Retourne un `{ ok, ... }` discriminé
 * — l'appelant choisit ce qu'il fait des erreurs (throw métier, log, etc.).
 *
 * Mode mock : si `process.env.E2E_MODE === '1'` ou si pas de credentials,
 * la fonction loggue un message et retourne `{ ok: true, mock: true,
 * messageId: 'mock-...' }`. Pas d'appel HTTP réel.
 *
 * Le mode mock est intentionnellement décidé ici (et pas dans l'appelant)
 * pour supprimer la duplication. Si un caller veut absolument forcer le
 * vrai send (peu probable), il peut passer son propre `env` avec creds en
 * dur — mais ne le fais pas en pratique.
 */
export async function sendWhatsAppCloudTemplate(
  input: WhatsAppCloudSendInput,
  env?: Partial<WhatsAppCloudEnv>,
): Promise<WhatsAppCloudSendResult> {
  const accessToken = env?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = input.graphVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0';

  if (process.env.E2E_MODE === '1') {
    const mockId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.info(`[whatsapp:mock] ${input.templateName} -> ${input.to} | id=${mockId}`);
    return { ok: true, mock: true, messageId: mockId };
  }

  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: 'WHATSAPP_NOT_CONFIGURED' };
  }

  const url = buildWhatsAppCloudUrl({ accessToken, phoneNumberId }, graphVersion);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: input.languageCode ?? 'fr' },
          components: input.components,
        },
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { ok: false, error: `network: ${message}` };
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    const reason = data.error?.message ?? `HTTP ${res.status}`;
    return {
      ok: false,
      error: reason,
      ...(typeof data.error?.code === 'number' ? { errorCode: data.error.code } : {}),
      httpStatus: res.status,
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
  };
  return { ok: true, mock: false, messageId: data.messages?.[0]?.id };
}
