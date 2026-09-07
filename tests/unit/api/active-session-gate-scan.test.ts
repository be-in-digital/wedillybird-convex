import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Une route API qui décode le cookie avec `getSession` accorde l'accès à un
 * compte suspendu : le cookie reste valide, la suspension est postérieure à
 * son émission. `getActiveSession` vérifie en plus l'état du compte.
 *
 * Ce scan est là pour la route qu'on ajoutera dans six mois, pas pour les
 * douze d'aujourd'hui.
 */
describe('routes API — porte de session', () => {
  const files = walk(join(ROOT, 'app', 'api'));

  it('aucune route ne lit la session avec getSession', () => {
    const offenders = files.filter((f) => /\bgetSession\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('les routes authentifiées passent par getActiveSession', () => {
    const authed = files.filter((f) => /getActiveSession\s*\(/.test(readFileSync(f, 'utf8')));
    // Garde-fou de non-régression : si ce nombre tombe, une route a perdu son
    // contrôle plutôt que d'avoir été supprimée — à vérifier explicitement.
    expect(authed.length).toBeGreaterThanOrEqual(12);
  });
});

describe('back-office Convex — refus des comptes suspendus', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('les deux voies de connexion refusent un compte suspendu', () => {
    const auth = read('convex/auth.ts');
    // Une seule des deux suffirait à laisser la sanction sans effet.
    const refusals = auth.match(
      /if \(isSuspended\(existing\)\) throw new Error\('ACCOUNT_SUSPENDED'\);/g,
    );
    expect(refusals).toHaveLength(2);
  });

  it("l'onboarding refuse un compte suspendu", () => {
    expect(read('convex/users.ts')).toContain(
      "if (isSuspended(user)) throw new Error('ACCOUNT_SUSPENDED');",
    );
  });

  it("suspendre n'écrit plus le rôle", () => {
    const admin = read('convex/admin.ts');
    const suspend = admin.slice(
      admin.indexOf('export const suspendUser'),
      admin.indexOf('export const unsuspendUser'),
    );
    expect(suspend).toContain('suspendedAt: Date.now()');
    expect(suspend).not.toContain("role: 'guest'");
  });
});
