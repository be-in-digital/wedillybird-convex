import qrcode from 'qrcode-generator';

/**
 * Génération de QR codes — matrice de modules + chemin SVG.
 *
 * On ne rend jamais le SVG fourni par la lib : on récupère la matrice brute et
 * on dessine nous-mêmes, pour que le QR hérite des couleurs et du grain de la
 * papeterie Wedillybird (et reste un composant serveur, sans JS client).
 *
 * Contenu encodé : le `guests.qrCodeToken` **nu**. C'est exactement ce que le
 * scanner de check-in (`components/checkin/qr-scanner.tsx`) passe à
 * `guests.checkInByToken` — encoder une URL casserait le scan.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Nombre de modules par côté (hors marge). */
  size: number;
  /** `dark[row][col]` — `true` = module noir. */
  dark: boolean[][];
}

/**
 * Charset du mode alphanumérique QR (ISO/IEC 18004). Les tokens Wedillybird
 * (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`) en font partie : le mode
 * alphanumérique tient 12 caractères dans une version 1, soit un QR de 21×21
 * modules — nettement plus lisible sur un écran de téléphone qu'un mode octet.
 */
const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

/** Encode `text` et rend la matrice de modules. Lève si `text` est vide. */
export function qrMatrix(text: string, ecc: QrEcc = 'M'): QrMatrix {
  if (!text) throw new Error('QR_EMPTY_INPUT');
  // typeNumber 0 = version choisie automatiquement selon la longueur.
  const qr = qrcode(0, ecc);
  qr.addData(text, ALPHANUMERIC.test(text) ? 'Alphanumeric' : 'Byte');
  qr.make();

  const size = qr.getModuleCount();
  const dark: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1) line.push(qr.isDark(row, col));
    dark.push(line);
  }
  return { size, dark };
}

/**
 * Chemin SVG des modules noirs, en unités « module » (1 module = 1 unité).
 *
 * Un seul `<path>` plutôt qu'un `<rect>` par module : ~1 Ko au lieu de ~20 Ko
 * pour un QR de 21×21, et un seul nœud à peindre. Les runs horizontaux de
 * modules sont fusionnés (`h{n}` au lieu de n rectangles), ce qui réduit encore
 * le chemin sans changer le rendu.
 */
export function qrSvgPath(matrix: QrMatrix, offset = 0): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.dark[row]!;
    let col = 0;
    while (col < matrix.size) {
      if (!line[col]) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < matrix.size && line[col + run]) run += 1;
      parts.push(`M${col + offset} ${row + offset}h${run}v1h-${run}z`);
      col += run;
    }
  }
  return parts.join('');
}

export interface QrSvgData {
  /** `viewBox` prêt à poser sur le `<svg>` (marge de silence incluse). */
  viewBox: string;
  /** Chemin des modules noirs, décalé de la marge. */
  path: string;
  size: number;
}

/**
 * Prépare tout ce qu'il faut pour un `<svg>` : la marge de silence (« quiet
 * zone ») de 4 modules exigée par la norme est incluse dans le `viewBox`, sans
 * quoi un scanner peut refuser de lire le code posé au bord d'une carte.
 */
export function qrSvgData(text: string, ecc: QrEcc = 'M', margin = 4): QrSvgData {
  const matrix = qrMatrix(text, ecc);
  const total = matrix.size + margin * 2;
  return {
    viewBox: `0 0 ${total} ${total}`,
    path: qrSvgPath(matrix, margin),
    size: matrix.size,
  };
}
