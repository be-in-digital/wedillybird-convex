import { describe, expect, it } from 'vitest';
import { renderPartnerInvite } from '@/lib/email/templates';

const BASE = {
  inviteUrl: 'https://www.wedillybird.com/rejoindre/ABCD2345EFGH6789JKLM',
  grantMonths: 6,
  affiliateCode: 'SARAH20',
  // 2026-10-07, soit 30 jours après la création — l'échéance du LIEN.
  expiresAt: Date.UTC(2026, 9, 7, 12, 0, 0),
};

describe('renderPartnerInvite', () => {
  it('porte le lien en clair, pas seulement dans le bouton', () => {
    const out = renderPartnerInvite(BASE);
    // Un client mail qui mange les boutons ne doit pas rendre l'e-mail inutile.
    expect(out.html).toContain(BASE.inviteUrl);
    expect(out.text).toContain(BASE.inviteUrl);
  });

  it('annonce la gratuité sans carte bancaire', () => {
    // C'est la question qui retient de cliquer : elle doit être dans les deux
    // versions, pas seulement dans le HTML.
    const out = renderPartnerInvite(BASE);
    expect(out.html).toMatch(/carte bancaire/i);
    expect(out.text).toMatch(/carte bancaire/i);
  });

  it("sépare l'échéance du lien de la durée du compte offert", () => {
    const out = renderPartnerInvite(BASE);
    // Les confondre ferait croire au partenaire qu'il n'a que quelques
    // semaines d'essai au lieu de six mois.
    expect(out.text).toContain('7 octobre 2026');
    expect(out.subject).toContain('6 mois');
    expect(out.text).toMatch(/démarrent le jour où vous ouvrez/);
  });

  it('mentionne le code partenaire quand il existe, et se tait sinon', () => {
    expect(renderPartnerInvite(BASE).text).toContain('SARAH20');
    const withoutCode = renderPartnerInvite({ ...BASE, affiliateCode: undefined });
    expect(withoutCode.text).not.toContain('SARAH20');
    expect(withoutCode.text).not.toMatch(/undefined/);
  });

  it('échappe le nom du destinataire', () => {
    const out = renderPartnerInvite({ ...BASE, inviteeName: '<script>alert(1)</script>' });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('salue sans nom quand il est inconnu', () => {
    const out = renderPartnerInvite(BASE);
    expect(out.html).toContain('Bonjour');
    expect(out.html).not.toMatch(/Bonjour\s*,?\s*undefined/);
  });
});

describe('variante « compte personnel »', () => {
  const COUPLE = { ...BASE, kind: 'couple' as const };

  it("ne promet pas six mois à quelqu'un qui reçoit un forfait d'événement", () => {
    // Un particulier n'a pas d'abonnement : parler de « 6 mois » serait faux,
    // et la déception arriverait juste après le clic.
    const out = renderPartnerInvite(COUPLE);
    expect(out.subject).not.toContain('6 mois');
    expect(out.text).not.toMatch(/6 premiers mois/);
    expect(out.subject).toMatch(/Premium/);
  });

  it('annonce le mariage offert en Premium', () => {
    const out = renderPartnerInvite(COUPLE);
    expect(out.text).toMatch(/mariage passe en Premium/);
    expect(out.html).toMatch(/galerie partagée/);
  });

  it("dit que le forfait s'applique au mariage, pas à une période", () => {
    const out = renderPartnerInvite(COUPLE);
    expect(out.text).toMatch(/s'applique au mariage que vous créerez/);
  });

  it('garde la promesse « sans carte bancaire » des deux côtés', () => {
    expect(renderPartnerInvite(COUPLE).text).toMatch(/carte bancaire/i);
    expect(renderPartnerInvite(BASE).text).toMatch(/carte bancaire/i);
  });

  it('le lien agence reste inchangé', () => {
    // Non-régression : la variante ne doit pas déteindre sur le cas par défaut.
    const out = renderPartnerInvite(BASE);
    expect(out.subject).toContain('6 mois');
  });
});
