import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvgData, qrSvgPath } from '../../../lib/qr/matrix';

/**
 * Le QR du pass placement est présenté à l'entrée d'un mariage : s'il est
 * illisible, l'invité reste bloqué à la porte. On vérifie donc la **structure
 * normative** du symbole (ISO/IEC 18004), pas seulement qu'une image sort.
 *
 * Les motifs contrôlés ici sont indépendants du masque choisi par l'encodeur,
 * donc stables : détecteurs d'angle, motifs de synchronisation, module noir
 * fixe. Un encodeur qui les respecte produit un symbole qu'un lecteur trouve
 * et oriente.
 */

/** Format des tokens Wedillybird : 12 caractères, alphabet sans ambiguïté. */
const TOKEN = 'A7KMPQRSTUVW';

/** Le motif 7×7 d'un détecteur d'angle, identique aux 3 coins. */
function readFinder(dark: boolean[][], top: number, left: number): string {
  let out = '';
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) out += dark[top + r]![left + c] ? '#' : '.';
  }
  return out;
}

const FINDER = '#######' + '#.....#' + '#.###.#' + '#.###.#' + '#.###.#' + '#.....#' + '#######';

describe('qrMatrix', () => {
  it('un token de 12 caractères tient dans une version 1 (21×21)', () => {
    const m = qrMatrix(TOKEN);
    expect(m.size).toBe(21);
    expect(m.dark).toHaveLength(21);
    expect(m.dark.every((row) => row.length === 21)).toBe(true);
  });

  it('pose les trois détecteurs d’angle conformes', () => {
    const { dark, size } = qrMatrix(TOKEN);
    expect(readFinder(dark, 0, 0)).toBe(FINDER);
    expect(readFinder(dark, 0, size - 7)).toBe(FINDER);
    expect(readFinder(dark, size - 7, 0)).toBe(FINDER);
  });

  it('laisse les séparateurs blancs autour des détecteurs', () => {
    const { dark } = qrMatrix(TOKEN);
    for (let i = 0; i < 8; i += 1) {
      expect(dark[7]![i]).toBe(false);
      expect(dark[i]![7]).toBe(false);
    }
  });

  it('pose les motifs de synchronisation alternés (ligne et colonne 6)', () => {
    const { dark, size } = qrMatrix(TOKEN);
    for (let i = 8; i < size - 8; i += 1) {
      expect(dark[6]![i]).toBe(i % 2 === 0);
      expect(dark[i]![6]).toBe(i % 2 === 0);
    }
  });

  it('pose le module noir fixe en (4×version + 9, 8)', () => {
    const { dark } = qrMatrix(TOKEN); // version 1 → ligne 13
    expect(dark[13]![8]).toBe(true);
  });

  it('encode réellement la donnée : deux tokens donnent deux symboles', () => {
    const a = qrMatrix(TOKEN);
    const b = qrMatrix('B7KMPQRSTUVW');
    expect(JSON.stringify(a.dark)).not.toBe(JSON.stringify(b.dark));
  });

  it('est déterministe : même entrée, même symbole', () => {
    expect(qrMatrix(TOKEN)).toEqual(qrMatrix(TOKEN));
  });

  it('accepte le mode octet pour une chaîne hors alphabet alphanumérique', () => {
    const m = qrMatrix('token-en-minuscules');
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect(readFinder(m.dark, 0, 0)).toBe(FINDER);
  });

  it('une correction plus forte agrandit ou conserve le symbole', () => {
    expect(qrMatrix(TOKEN, 'H').size).toBeGreaterThanOrEqual(qrMatrix(TOKEN, 'L').size);
  });

  it('refuse une entrée vide plutôt que de rendre un symbole vide', () => {
    expect(() => qrMatrix('')).toThrow('QR_EMPTY_INPUT');
  });
});

describe('qrSvgPath', () => {
  it('fusionne les modules noirs contigus en un seul segment horizontal', () => {
    const matrix = {
      size: 3,
      dark: [
        [true, true, false],
        [false, false, false],
        [true, false, true],
      ],
    };
    expect(qrSvgPath(matrix)).toBe('M0 0h2v1h-2zM0 2h1v1h-1zM2 2h1v1h-1z');
  });

  it('décale le chemin de la marge demandée', () => {
    const matrix = { size: 1, dark: [[true]] };
    expect(qrSvgPath(matrix, 4)).toBe('M4 4h1v1h-1z');
  });

  it('matrice entièrement blanche → chemin vide', () => {
    expect(
      qrSvgPath({
        size: 2,
        dark: [
          [false, false],
          [false, false],
        ],
      }),
    ).toBe('');
  });
});

describe('qrSvgData', () => {
  it('inclut la zone de silence de 4 modules dans le viewBox', () => {
    const data = qrSvgData(TOKEN);
    // 21 modules + 4 de marge de chaque côté = 29.
    expect(data.viewBox).toBe('0 0 29 29');
    expect(data.size).toBe(21);
  });

  it('respecte une marge personnalisée', () => {
    expect(qrSvgData(TOKEN, 'M', 0).viewBox).toBe('0 0 21 21');
  });

  it('rend un chemin non vide', () => {
    expect(qrSvgData(TOKEN).path.length).toBeGreaterThan(0);
  });
});
