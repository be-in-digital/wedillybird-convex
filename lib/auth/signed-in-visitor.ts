/**
 * Que faire quand quelqu'un ouvre `/sign-in` ou `/sign-up` alors qu'il a déjà
 * une session valide ?
 *
 * Le besoin vient d'un retour utilisateur : le header n'exposait que « Créer un
 * compte », personne ne trouvait par où se reconnecter, et on cliquait ce
 * bouton faute de mieux. Le flow OTP ouvrant indifféremment un compte neuf ou
 * un compte existant, on se retrouvait **connecté sans avoir compris comment**.
 * Un lien « Se connecter » explicite corrige la moitié du problème ; l'autre
 * moitié est ici : une fois ce lien visible, il sera cliqué par des gens déjà
 * connectés, et leur redemander un code à usage unique pour aboutir exactement
 * là où ils étaient déjà serait la même confusion dans l'autre sens.
 *
 * Deux garde-fous dans la décision :
 *
 *  - `next` prime sur la destination par défaut. C'est lui qui porte le lien
 *    d'invitation d'une partenaire (`/rejoindre/<token>`, `/pro/invite/<token>`)
 *    — l'ignorer lui ferait perdre son organisation offerte. Il est validé en
 *    amont par `safeNextPath` : ce module ne fait que le préférer, jamais le
 *    nettoyer.
 *  - `error` gagne sur tout le reste. `/sign-in?error=expired` est la page
 *    d'atterrissage d'un lien magique mort : rediriger là-dessus effacerait la
 *    seule explication de l'échec.
 *
 * On renvoie `/dashboard` plutôt que le « bon » dashboard calculé : c'est déjà
 * le rôle de la page `/dashboard` (cf. `post-auth-destination.ts`), et s'en
 * remettre à elle garde les pages d'authentification **sans dépendance au
 * backend** — une panne Convex ne doit pas empêcher de se connecter.
 *
 * Fonction pure : la lecture du cookie reste à l'appelant.
 */
export interface SignedInVisitorParams {
  /** Un cookie de session valide accompagne-t-il la requête ? */
  hasSession: boolean;
  /** `?next=` déjà passé par `safeNextPath` (chemin relatif, ou `null`). */
  next?: string | null;
  /** `?error=` brut de la query. */
  error?: string | null;
}

/**
 * Destination vers laquelle rediriger, ou `null` pour rendre le formulaire.
 */
export function redirectForSignedInVisitor({
  hasSession,
  next = null,
  error = null,
}: SignedInVisitorParams): string | null {
  if (!hasSession) return null;
  if (error) return null;
  return next ?? '/dashboard';
}
