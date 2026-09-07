/**
 * Construction du message SES — extraite pour être testable.
 *
 * `dispatch` vit dans une action `'use node'` qui instancie le client AWS :
 * impossible à exercer en test unitaire sans monter tout le SDK. La forme du
 * message, elle, est du pur assemblage d'objet — c'est là que se logent les
 * oublis (un `Reply-To` absent, un jeu de configuration vide envoyé au lieu
 * d'être omis), donc c'est là qu'il faut pouvoir vérifier.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface SesMessageInput {
  from: string;
  to: string;
  rendered: RenderedEmail;
  /** Jeu de configuration SES (suivi bounces/plaintes). Omis si vide. */
  configurationSet?: string;
  /**
   * Adresse de réponse. Les envois partent de `noreply@`, ce qui convient à
   * un code de connexion mais pas à un message où une réponse humaine est
   * attendue — une invitation partenaire, typiquement. Omis si absent :
   * un tableau vide serait refusé par SES.
   */
  replyTo?: string;
}

export function buildSesEmailInput({
  from,
  to,
  rendered,
  configurationSet,
  replyTo,
}: SesMessageInput) {
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ConfigurationSetName: configurationSet || undefined,
    ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: rendered.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: rendered.html, Charset: 'UTF-8' },
          Text: { Data: rendered.text, Charset: 'UTF-8' },
        },
      },
    },
  };
}
