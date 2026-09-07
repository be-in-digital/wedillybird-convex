import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { qrMatrix, qrSvgData, qrSvgPath } from '../../../lib/qr/matrix';

/**
 * Le QR du pass placement est scanné à l'entrée d'un mariage : un rendu faux
 * ne se voit qu'au moment où il est trop tard. Ces tests ferment la boucle
 * la plus risquée — non pas l'encodage (délégué à `qrcode-generator`, éprouvé)
 * mais **notre** conversion matrice → chemin SVG, où se logeraient une
 * inversion x/y, un décalage d'un module ou une marge de silence absente.
 *
 * Méthode : on re-parse le chemin produit pour reconstruire une grille, et on
 * la compare module à module à la matrice de référence.
 */

const TOKEN = 'HJ7KMPQ34XZB'; // alphabet de `convex/lib/qrToken.ts`

/** Reconstruit une grille booléenne à partir du chemin `M{x} {y}h{n}v1h-{n}z`. */
function parsePath(path: string, size: number, offset: number): boolean[][] {
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const re = /M(-?\d+) (-?\d+)h(\d+)v1h-\d+z/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const x = Number(m[1]) - offset;
    const y = Number(m[2]) - offset;
    const run = Number(m[3]);
    for (let i = 0; i < run; i += 1) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(size);
      expect(x + i).toBeGreaterThanOrEqual(0);
      expect(x + i).toBeLessThan(size);
      grid[y]![x + i] = true;
    }
  }
  return grid;
}

/**
 * Un motif de repérage est un carré 7×7 : bord plein, anneau clair, cœur 3×3
 * plein. On le vérifie sur ces trois anneaux plutôt que sur le seul module
 * d'angle, qui ne prouverait rien.
 */
function isFinder(grid: boolean[][], top: number, left: number): boolean {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const expected = onBorder || inCore;
      if (grid[top + r]?.[left + c] !== expected) return false;
    }
  }
  return true;
}

describe('qrMatrix', () => {
  it('encode un token en version 1 (21×21) grâce au mode alphanumérique', () => {
    // 12 caractères alphanumériques tiennent en version 1 : le plus petit QR
    // possible, donc le plus lisible sur un écran de téléphone.
    expect(qrMatrix(TOKEN, 'M').size).toBe(21);
  });

  it('produit la même matrice que l’encodeur de référence', () => {
    const ref = qrcode(0, 'M');
    ref.addData(TOKEN, 'Alphanumeric');
    ref.make();
    const mine = qrMatrix(TOKEN, 'M');
    expect(mine.size).toBe(ref.getModuleCount());
    for (let row = 0; row < mine.size; row += 1) {
      for (let col = 0; col < mine.size; col += 1) {
        expect(mine.dark[row]![col]).toBe(ref.isDark(row, col));
      }
    }
  });

  it('bascule en mode octet pour un texte hors charset alphanumérique', () => {
    // Le charset alphanumérique QR n'a pas de minuscules : sans repli, la lib
    // lèverait. On veut un QR valide, pas une exception.
    expect(() => qrMatrix('token-minuscule', 'M')).not.toThrow();
  });

  it('refuse une entrée vide plutôt que de rendre un QR muet', () => {
    expect(() => qrMatrix('', 'M')).toThrow('QR_EMPTY_INPUT');
  });
});

describe('qrSvgPath — fidélité du rendu', () => {
  it('le chemin re-parsé reproduit exactement la matrice', () => {
    const matrix = qrMatrix(TOKEN, 'M');
    const grid = parsePath(qrSvgPath(matrix, 0), matrix.size, 0);
    expect(grid).toEqual(matrix.dark);
  });

  it('conserve l’orientation : finders aux 3 coins, aucun au 4e', () => {
    // Les 3 motifs de repérage sont la structure qui donne son orientation au
    // code. Le coin bas-droit n'en porte pas (c'est de la donnée) : un rendu
    // qui en fabriquerait un serait illisible.
    const matrix = qrMatrix(TOKEN, 'M');
    const grid = parsePath(qrSvgPath(matrix, 0), matrix.size, 0);
    const last = matrix.size - 7;
    expect(isFinder(grid, 0, 0)).toBe(true);
    expect(isFinder(grid, 0, last)).toBe(true);
    expect(isFinder(grid, last, 0)).toBe(true);
    expect(isFinder(grid, last, last)).toBe(false);
  });

  it('place le module sombre obligatoire, repère asymétrique du rendu', () => {
    // Le « dark module » est toujours noir, en (4×version+9, 8) — soit (13, 8)
    // en version 1. Son symétrique (8, 13) n'a pas cette garantie : c'est donc
    // le point qui trahit une transposition x/y du rendu.
    const matrix = qrMatrix(TOKEN, 'M');
    const grid = parsePath(qrSvgPath(matrix, 0), matrix.size, 0);
    expect(grid[13]![8]).toBe(true);
  });

  it('applique le décalage de marge à chaque module', () => {
    const matrix = qrMatrix(TOKEN, 'M');
    const grid = parsePath(qrSvgPath(matrix, 4), matrix.size, 4);
    expect(grid).toEqual(matrix.dark);
  });

  it('fusionne les modules noirs consécutifs en un seul segment', () => {
    // Compactage : moins de segments que de modules noirs, sinon la fusion
    // horizontale ne fait rien et le chemin explose en taille.
    const matrix = qrMatrix(TOKEN, 'M');
    const darkModules = matrix.dark.flat().filter(Boolean).length;
    const segments = qrSvgPath(matrix, 0).match(/M/g)?.length ?? 0;
    expect(segments).toBeLessThan(darkModules);
  });
});

describe('qrSvgData', () => {
  it('inclut la marge de silence de 4 modules dans le viewBox', () => {
    // Sans zone de silence, un scanner peut refuser un code posé au bord.
    const data = qrSvgData(TOKEN, 'M', 4);
    const total = data.size + 8;
    expect(data.viewBox).toBe(`0 0 ${total} ${total}`);
  });

  it('ne dessine aucun module dans la marge', () => {
    const data = qrSvgData(TOKEN, 'M', 4);
    const total = data.size + 8;
    const coords = [...data.path.matchAll(/M(-?\d+) (-?\d+)h(\d+)/g)];
    expect(coords.length).toBeGreaterThan(0);
    for (const [, x, y, run] of coords) {
      expect(Number(y)).toBeGreaterThanOrEqual(4);
      expect(Number(y)).toBeLessThan(total - 4);
      expect(Number(x)).toBeGreaterThanOrEqual(4);
      expect(Number(x) + Number(run)).toBeLessThanOrEqual(total - 4);
    }
  });
});
