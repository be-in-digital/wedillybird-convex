import { describe, expect, it } from 'vitest';
import { buildSesEmailInput } from '../../../convex/lib/sesMessage';
import { LEGAL_ENTITY } from '@/lib/legal/entity';

const RENDERED = { subject: 'Sujet', html: '<p>html</p>', text: 'texte' };
const BASE = { from: 'noreply@wedillybird.com', to: 'sarah@example.com', rendered: RENDERED };

describe('buildSesEmailInput', () => {
  it("omet ReplyToAddresses quand aucune adresse de réponse n'est donnée", () => {
    const input = buildSesEmailInput(BASE);
    // Un tableau vide serait refusé par SES : la clé doit être absente.
    expect(input).not.toHaveProperty('ReplyToAddresses');
  });

  it('pose ReplyToAddresses quand une adresse est donnée', () => {
    const input = buildSesEmailInput({ ...BASE, replyTo: 'contact@wedillybird.com' });
    expect(input.ReplyToAddresses).toEqual(['contact@wedillybird.com']);
    // L'expéditeur ne change pas : seule la réponse est redirigée.
    expect(input.FromEmailAddress).toBe('noreply@wedillybird.com');
  });

  it("omet le jeu de configuration vide plutôt que d'envoyer une chaîne vide", () => {
    expect(
      buildSesEmailInput({ ...BASE, configurationSet: '' }).ConfigurationSetName,
    ).toBeUndefined();
    expect(
      buildSesEmailInput({ ...BASE, configurationSet: 'wedillybird-default' }).ConfigurationSetName,
    ).toBe('wedillybird-default');
  });

  it('porte les deux corps, HTML et texte', () => {
    const body = buildSesEmailInput(BASE).Content.Simple.Body;
    expect(body.Html.Data).toBe('<p>html</p>');
    expect(body.Text.Data).toBe('texte');
  });
});

describe("adresse de réponse de l'invitation partenaire", () => {
  it("vient de l'entité légale, pas d'une constante recopiée", () => {
    // Si l'adresse de contact change, elle change à un seul endroit.
    expect(LEGAL_ENTITY.contactEmail).toBe('contact@wedillybird.com');
  });
});

describe("câblage réel dans l'action d'envoi", () => {
  it('sendPartnerInvite passe bien un Reply-To à dispatch', async () => {
    // Le builder peut être parfait et l'appelant ne rien lui passer : c'est
    // exactement le défaut qu'on corrige ici.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('convex/emailActions.ts', 'utf8');
    const action = src.slice(
      src.indexOf('export const sendPartnerInvite'),
      src.indexOf('export const sendMagicLinkEmail'),
    );
    expect(action).toMatch(/replyTo:\s*LEGAL_ENTITY\.contactEmail/);
  });
});
