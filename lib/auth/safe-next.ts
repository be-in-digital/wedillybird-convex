/**
 * Validation d'une destination post-connexion (`?next=`).
 *
 * Le besoin : une partenaire ouvre `/rejoindre/<token>`, doit se connecter, et
 * doit **revenir sur son lien**. Sans ce report, elle atterrit sur l'onboarding
 * generique, choisit « couple », et son invitation n'est jamais consommee —
 * elle se retrouve a devoir payer un forfait alors qu'on venait de lui en
 * offrir six mois.
 *
 * Le danger : un `next` recopie tel quel dans une redirection est une
 * **redirection ouverte**. `/sign-in?next=https://evil.tld` enverrait la
 * personne sur un site tiers juste apres une connexion reussie — le moment
 * exact ou elle fait le plus confiance a ce qu'elle voit.
 *
 * D'ou une liste blanche de forme, et non une liste noire de motifs : seul un
 * chemin **relatif a notre propre origine** est accepte.
 */

/** Longueur au-dela de laquelle on ne discute pas : ce n'est pas un chemin. */
const MAX_LENGTH = 512;

/** Caracteres de controle : cassent un en-tete Location ou trompent une comparaison. */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;

  // Doit etre un chemin absolu de notre site.
  if (!value.startsWith('/')) return null;

  // `//evil.tld` et `/\evil.tld` sont lus comme des URL protocol-relative par
  // les navigateurs : ils sortent du site malgre le `/` initial.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;

  if (CONTROL_CHARS.test(value)) return null;

  // Un « : » avant le premier « / » suivant signalerait un schema deguise, et
  // les formes encodees redeviennent une sortie de site apres decodage.
  if (/^\/[^/]*:/.test(value)) return null;
  if (/%2f%2f|%5c/i.test(value)) return null;

  return value;
}
