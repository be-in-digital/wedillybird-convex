/**
 * Promotion super-admin depuis l'environnement.
 *
 * `ADMIN_PHONE` et `ADMIN_EMAIL` désignent l'identifiant qui, à la connexion,
 * fait passer le compte en `role: 'admin'`. C'est la seule voie d'accès à
 * `/admin` : il n'existe aucun écran pour se nommer soi-même administrateur.
 *
 * ## Pourquoi une fonction plutôt qu'une égalité en ligne
 *
 * La comparaison portait la valeur d'environnement **brute** contre un
 * identifiant **normalisé**. Un `ADMIN_PHONE=06 12 93 17 79` ou un
 * `ADMIN_EMAIL=Hello@Wedillybird.com` ne promouvait donc personne — et
 * n'émettait ni erreur ni log : on se connecte, on n'est pas admin, et rien
 * n'explique pourquoi. Les deux côtés passent maintenant par la même
 * normalisation, ce qui rend la variable tolérante à la façon dont un humain
 * écrit un numéro ou une adresse.
 *
 * Le refus reste strict sur le fond : après normalisation, l'égalité est
 * exacte. Une variable vide, absente ou non normalisable ne promeut rien.
 */

export interface AdminPromotionInput {
  /** Valeur brute de l'environnement (`process.env.ADMIN_*`). */
  configured: string | undefined | null;
  /** Identifiant normalisé du compte qui vient de s'authentifier. */
  actual: string;
  /** Même normalisation que celle appliquée à `actual`. */
  normalize: (value: string) => string | null;
}

/**
 * Ce compte doit-il être promu administrateur ?
 *
 * Ne dit rien du rôle courant : l'appelant évite l'écriture inutile quand le
 * compte est déjà admin.
 */
export function matchesConfiguredAdmin({
  configured,
  actual,
  normalize,
}: AdminPromotionInput): boolean {
  if (!configured || !actual) return false;
  const wanted = normalize(configured);
  if (!wanted) return false;
  return wanted === actual;
}
