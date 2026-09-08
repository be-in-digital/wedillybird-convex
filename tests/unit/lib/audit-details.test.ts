import { describe, expect, it } from 'vitest';
import { parseAuditDetails, summarizeAuditField } from '@/lib/admin/audit-details';

/**
 * Le journal d'audit stockait ses `details` en JSON et les affichait tels quels.
 * Ce décodeur est ce qui les rend lisibles ; ce qui compte ici, c'est qu'il ne
 * mente jamais sur ce que la charge contient — et qu'il ne masque jamais une
 * charge qu'il ne comprend pas.
 */

describe('parseAuditDetails', () => {
  it('nomme les clés connues et laisse les autres visibles', () => {
    const parsed = parseAuditDetails(JSON.stringify({ role: 'admin', trucInconnu: 'valeur' }));
    expect(parsed.kind).toBe('fields');
    if (parsed.kind !== 'fields') return;
    expect(parsed.fields.map((f) => f.label)).toEqual(['Rôle', 'trucInconnu']);
  });

  it('replie « avant / après » en une seule transition', () => {
    const parsed = parseAuditDetails(JSON.stringify({ previousRole: 'couple', newRole: 'admin' }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    expect(parsed.fields).toHaveLength(1);
    expect(summarizeAuditField(parsed.fields[0]!)).toBe('Rôle couple → admin');
  });

  it('n’invente pas de transition quand l’état d’arrivée manque', () => {
    // `suspend_organization` journalise un `previousStatus` seul : une flèche
    // vers rien laisserait croire à un état d'arrivée que le journal ne dit pas.
    const parsed = parseAuditDetails(JSON.stringify({ mode: 'manual', previousStatus: 'active' }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    expect(parsed.fields.map((f) => f.kind)).toEqual(['value', 'value']);
    expect(summarizeAuditField(parsed.fields[1]!)).toBe('Statut précédent active');
  });

  it('écrit les montants dans la devise de la charge, pas en unité mineure', () => {
    const parsed = parseAuditDetails(
      JSON.stringify({ refundAmountMinor: 2900, totalRefunded: 5900, currency: 'EUR' }),
    );
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    // La devise a servi à écrire les montants : elle n'est plus une info à part.
    expect(parsed.fields.map((f) => f.label)).toEqual(['Montant remboursé', 'Total remboursé']);
    expect(summarizeAuditField(parsed.fields[0]!)).toContain('29,00');
  });

  it('respecte les devises zéro-décimale', () => {
    const parsed = parseAuditDetails(JSON.stringify({ rewardMinor: 4000, currency: 'XOF' }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    // XOF n'a pas de sous-unité : diviser par 100 afficherait 40 au lieu de 4 000.
    // `Intl` sépare les milliers par une espace fine insécable — ce qui doit
    // tenir est la valeur, pas le caractère d'espacement choisi par la locale.
    expect(summarizeAuditField(parsed.fields[0]!).replace(/\s/g, ' ')).toContain('4 000');
  });

  it('garde la devise quand aucun montant ne l’a consommée', () => {
    const parsed = parseAuditDetails(JSON.stringify({ currency: 'EUR', code: 'NORAH10' }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    expect(parsed.fields.map((f) => f.label)).toEqual(['Devise', 'Code']);
  });

  it('déplie l’inventaire d’une cascade de suppression', () => {
    const parsed = parseAuditDetails(
      JSON.stringify({ deleted: { guests: 142, events: 3, tables: 0 }, s3Objects: 87 }),
    );
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    const counts = parsed.fields[0]!;
    expect(counts.kind).toBe('counts');
    if (counts.kind !== 'counts') return;
    // Trié par volume, et une table intacte n'a rien à dire.
    expect(counts.entries.map((e) => e.label)).toEqual(['Invités', 'Événements']);
    expect(counts.total).toBe(145);
  });

  it('assume les noms de table sans libellé plutôt que d’en inventer un', () => {
    const parsed = parseAuditDetails(JSON.stringify({ deleted: { contractAudit: 4 } }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    const counts = parsed.fields[0]!;
    if (counts.kind !== 'counts') throw new Error('inventaire attendu');
    expect(counts.entries[0]).toMatchObject({ label: 'contractAudit', mono: true });
  });

  it('rend les booléens et les valeurs absentes en toutes lettres', () => {
    const parsed = parseAuditDetails(JSON.stringify({ revokedPrevious: true, reason: null }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    expect(summarizeAuditField(parsed.fields[0]!)).toBe('Lien précédent révoqué Oui');
    expect(summarizeAuditField(parsed.fields[1]!)).toBe('Motif —');
  });

  it('tronque les identifiants mais garde la valeur entière', () => {
    const full = 'coup_1TqHqABCDEFGHIJKLMNO';
    const parsed = parseAuditDetails(JSON.stringify({ stripeCouponId: full }));
    if (parsed.kind !== 'fields') throw new Error('champs attendus');
    const field = parsed.fields[0]!;
    if (field.kind !== 'value') throw new Error('valeur attendue');
    expect(field.value.title).toBe(full);
    expect(field.value.text).toHaveLength(13);
  });

  it('montre la chaîne brute quand ce n’est pas un objet JSON', () => {
    expect(parseAuditDetails('migration manuelle')).toEqual({
      kind: 'raw',
      text: 'migration manuelle',
    });
    expect(parseAuditDetails('[1,2,3]')).toEqual({ kind: 'raw', text: '[1,2,3]' });
  });

  it('traite l’absence de détails comme un vide, pas comme une erreur', () => {
    expect(parseAuditDetails(undefined).kind).toBe('empty');
    expect(parseAuditDetails('   ').kind).toBe('empty');
    expect(parseAuditDetails('{}').kind).toBe('empty');
  });
});
