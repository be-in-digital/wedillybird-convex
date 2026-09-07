/**
 * Suspension d'un compte — une seule définition, partagée par tout le back.
 *
 * Avant : suspendre écrasait `users.role` avec `'guest'`. Trois conséquences,
 * toutes mauvaises :
 *
 *  1. le rôle d'origine était perdu (seul le journal d'audit le gardait), donc
 *     « réactiver » revenait à le redeviner ;
 *  2. un compte `guest` qui a déjà un nom est renvoyé vers `/onboarding`, où
 *     choisir « couple » ou « agence » lui **rendait ses droits** : la sanction
 *     était annulable par la personne sanctionnée ;
 *  3. rien ne distinguait un compte suspendu d'un compte en cours
 *     d'inscription, qui portent pourtant le même rôle.
 *
 * La suspension vit donc sur son propre champ, et le rôle n'est plus touché.
 */

export interface SuspendableUser {
  suspendedAt?: number | null;
}

/** Un compte est suspendu dès que la date est posée. */
export function isSuspended(user: SuspendableUser | null | undefined): boolean {
  return user?.suspendedAt != null;
}
