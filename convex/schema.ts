import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { BUDGET_CURRENCY } from './lib/currency';

export default defineSchema({
  users: defineTable({
    // Optional depuis l'ajout du Magic Link (avril 2026) : un user peut être
    // créé via email-only si pas de WhatsApp. Au moins un de phone/email.
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    locale: v.union(
      v.literal('fr'),
      v.literal('en'),
      v.literal('es'),
      v.literal('it'),
      v.literal('pt'),
      v.literal('de'),
      v.literal('ar'),
    ),
    role: v.union(v.literal('couple'), v.literal('pro'), v.literal('guest'), v.literal('admin')),
    // For couples: 'essential' | 'premium' (per-event, set on payment).
    // For pros: 'starter' | 'business' | 'agency' (subscription).
    // Note: 'free' was removed in the pricing alignment v2 (avril 2026).
    planTier: v.optional(
      v.union(
        v.literal('essential'),
        v.literal('premium'),
        v.literal('starter'),
        v.literal('business'),
        v.literal('agency'),
      ),
    ),
    stripeCustomerId: v.optional(v.string()),
    /** Devise de budget préférée, choisie à l'onboarding. Défaut applicatif: EUR. */
    preferredCurrency: v.optional(BUDGET_CURRENCY),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index('by_phone', ['phone'])
    .index('by_email', ['email']),

  organizations: defineTable({
    ownerId: v.id('users'),
    name: v.string(),
    slug: v.string(),
    logoStorageId: v.optional(v.id('_storage')),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    /** Devise des budgets de l'agence (budget interne, prestataires). Défaut: EUR. */
    currency: v.optional(BUDGET_CURRENCY),
    /** Marque blanche (Agency) : domaine sur mesure + e-mail expéditeur + retrait du badge. */
    customDomain: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    whiteLabelFull: v.optional(v.boolean()),
    /** Préférences de notification par type (e-mail / in-app). */
    notificationPrefs: v.optional(
      v.object({
        rsvp: v.optional(v.object({ email: v.boolean(), app: v.boolean() })),
        payment: v.optional(v.object({ email: v.boolean(), app: v.boolean() })),
        newLead: v.optional(v.object({ email: v.boolean(), app: v.boolean() })),
        taskDue: v.optional(v.object({ email: v.boolean(), app: v.boolean() })),
        weeklyDigest: v.optional(v.object({ email: v.boolean(), app: v.boolean() })),
      }),
    ),
    /** Réglages messagerie par défaut (canal, expéditeur, template, relances). */
    messagingDefaults: v.optional(
      v.object({
        channel: v.union(v.literal('whatsapp'), v.literal('sms'), v.literal('auto')),
        senderName: v.string(),
        defaultTemplate: v.union(
          v.literal('editorial'),
          v.literal('classic'),
          v.literal('modern'),
          v.literal('festive'),
          v.literal('sober'),
        ),
        reminderJ7: v.boolean(),
        reminderJ1: v.boolean(),
      }),
    ),
    /**
     * Mode d'encaissement des paiements couples :
     * - `byop`   : compte Stripe perso de l'agence, connecté via OAuth Standard
     *              (charges directes). Mode actif.
     * - `manual` : suivi manuel, aucun encaissement en ligne (défaut)
     * - `managed`: LEGACY (ancien Stripe Connect managé). Plus jamais positionné
     *              par le code ; conservé dans l'union pour les données existantes.
     */
    paymentsMode: v.optional(v.union(v.literal('managed'), v.literal('byop'), v.literal('manual'))),
    /** LEGACY (mode managed) — versements gérés côté Stripe de l'agence en BYOP. */
    payoutSchedule: v.optional(
      v.union(v.literal('daily'), v.literal('weekly'), v.literal('manual')),
    ),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    /**
     * Stripe Connect (BYOP) : compte Stripe **de l'agence** connecté via OAuth
     * Standard. Les encaissements (budget, factures…) sont des *charges directes*
     * sur SON compte (en-tête `Stripe-Account`) — fonds direct chez l'agence,
     * aucun transfert plateforme. `…ChargesEnabled` est mis à true
     * à la connexion. `…PayoutsEnabled` / `…DetailsSubmitted` sont LEGACY (Express).
     */
    stripeConnectAccountId: v.optional(v.string()),
    stripeConnectChargesEnabled: v.optional(v.boolean()),
    stripeConnectPayoutsEnabled: v.optional(v.boolean()),
    stripeConnectDetailsSubmitted: v.optional(v.boolean()),
    subscriptionTier: v.optional(
      v.union(v.literal('starter'), v.literal('business'), v.literal('agency')),
    ),
    subscriptionStatus: v.optional(
      v.union(
        v.literal('trialing'),
        v.literal('active'),
        v.literal('past_due'),
        v.literal('canceled'),
        v.literal('unpaid'),
      ),
    ),
    subscriptionPeriodEnd: v.optional(v.number()),
    /**
     * Crédits Pay-as-you-go non-consommés. Chaque achat PAYG (one-shot 69 €)
     * crédite +1 ; chaque event créé sous mode PAYG décrémentera de 1 (gating
     * à programmer dans un sprint dédié, cf. BACKLOG).
     */
    paygCredits: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_slug', ['slug'])
    .index('by_stripe_customer', ['stripeCustomerId'])
    .index('by_stripe_subscription', ['stripeSubscriptionId'])
    .index('by_stripe_connect_account', ['stripeConnectAccountId']),

  /**
   * Achats Pay-as-you-go pro. Une row par checkout Stripe completed. La
   * mutation `paygPurchases:markPurchase` est idempotente via l'index
   * `by_session` (un même `stripeSessionId` ne crédite qu'une fois, même si
   * le webhook arrive plusieurs fois).
   */
  paygPurchases: defineTable({
    organizationId: v.id('organizations'),
    requesterId: v.id('users'),
    stripeSessionId: v.string(),
    amountMinor: v.number(),
    currency: v.union(
      v.literal('EUR'),
      v.literal('USD'),
      v.literal('XOF'),
      v.literal('MAD'),
      v.literal('TND'),
    ),
    createdAt: v.number(),
  })
    .index('by_session', ['stripeSessionId'])
    .index('by_organization', ['organizationId']),

  organizationMemberships: defineTable({
    organizationId: v.id('organizations'),
    userId: v.optional(v.id('users')),
    invitedPhone: v.optional(v.string()),
    invitedEmail: v.optional(v.string()),
    role: v.union(
      v.literal('owner'),
      v.literal('admin'),
      v.literal('planner'),
      v.literal('viewer'),
    ),
    status: v.union(v.literal('pending'), v.literal('active'), v.literal('revoked')),
    inviteToken: v.optional(v.string()),
    invitedBy: v.id('users'),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index('by_organization', ['organizationId'])
    .index('by_user', ['userId'])
    .index('by_invite_token', ['inviteToken'])
    .index('by_org_user', ['organizationId', 'userId']),

  events: defineTable({
    ownerId: v.id('users'),
    organizationId: v.optional(v.id('organizations')),
    slug: v.string(),
    title: v.string(),
    coupleNames: v.object({
      partnerA: v.string(),
      partnerB: v.string(),
    }),
    eventDate: v.number(),
    timezone: v.string(),
    /** Devise du budget de ce mariage. Héritée de l'org / du couple à la création. Défaut: EUR. */
    currency: v.optional(BUDGET_CURRENCY),
    /** Enveloppe budgétaire — cible totale fixée avec le couple (centimes). */
    budgetEnvelopeMinor: v.optional(v.number()),
    venue: v.optional(
      v.object({
        name: v.string(),
        address: v.string(),
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
      }),
    ),
    coverImageKey: v.optional(v.string()),
    /**
     * Identifiant de la Rekognition Face Collection AWS associée à l'event,
     * de la forme `wb-event-{eventId}`. Set par le Lambda de modération à la
     * première photo `approved` (premier IndexFaces réussi).
     *
     * Quand undefined : aucune photo n'a encore été indexée — le bouton
     * "rechercher mes photos" doit afficher un état vide explicatif.
     *
     * Cleanup : à supprimer via Rekognition `DeleteCollection` quand
     * l'event est définitivement archivé / supprimé (cf. BACKLOG).
     */
    faceCollectionId: v.optional(v.string()),
    /**
     * Reco-faciale (Lane T3, F7) — OFF par défaut (`undefined`/`false`). Le
     * couple/l'agence opt-in explicitement via `events:setFaceSearchEnabled`,
     * qui REFUSE l'activation si `weddingState` ∈ `BIOMETRIC_BANNED_STATES`
     * (`convex/lib/biometricConsent.ts` — IL/TX/WA) et persiste
     * `faceSearchConsent` au moment de l'opt-in. C'est le seul flag qui
     * autorise le Lambda de modération (`infra/lambdas/moderation.ts`) à
     * appeler `IndexFacesCommand` (vérifié via l'endpoint HTTP signé
     * `/lambda/face-search-enabled`) — AVANT ce Lane, aucun gate n'existait.
     */
    faceSearchEnabled: v.optional(v.boolean()),
    /**
     * Preuve de consentement à l'opt-in reco-faciale — seule trace en base
     * qu'un humain a explicitement accepté (avant ce Lane, l'écran de
     * consentement du *chercheur* dans `face-search-modal.tsx` ne
     * sauvegardait jamais rien). Réécrit à chaque nouvelle activation ;
     * conservé tel quel si l'event désactive ensuite la feature (preuve
     * historique qu'un consentement a bien eu lieu).
     */
    faceSearchConsent: v.optional(
      v.object({
        enabledAt: v.number(),
        /** Version de la notice de consentement affichée (cf. FACE_SEARCH_NOTICE_VERSION). */
        noticeVersion: v.string(),
        byUserId: v.id('users'),
      }),
    ),
    /**
     * État/province US ou Canada où le mariage a lieu, déclaré par le couple
     * (ex. `"IL"`, `"TX"`, `"CA-QC"`) — codes bruts USPS pour les États US,
     * préfixés `CA-` pour les provinces canadiennes (cf. `lib/geo/regions.ts`
     * côté app). `undefined` = hors US/Canada ou non renseigné : le geofence
     * biométrique ne s'applique qu'aux codes listés dans
     * `BIOMETRIC_BANNED_STATES`. Ne PAS inférer depuis l'indicatif `+1`
     * (couvre US ET Canada) — champ déclaratif volontairement structuré.
     */
    weddingState: v.optional(v.string()),
    theme: v.optional(
      v.object({
        primaryColor: v.string(),
        accentColor: v.string(),
        fontFamily: v.string(),
      }),
    ),
    /**
     * Cinématique d'ouverture de l'invitation publique — id du registre
     * front (`components/invitation/cinematics/registry.ts`) : seal ·
     * floral · cake · voyage · theatre. Absent = sceau (défaut historique).
     * Choisir un thème non-sceau est gaté `cinematicInvitation` (Premium/Pro).
     */
    invitationCinematic: v.optional(v.string()),
    /**
     * Musique de l'invitation publique. Absent = silence (défaut).
     * `library` → `trackId` d'une piste maison (`lib/invitation/music.ts`) ;
     * `custom` → `s3Key` sous `audio/{eventId}/…` (upload du couple, servi
     * CloudFront, hors préfixe `incoming/` donc hors modération Lambda).
     * Gaté `cinematicInvitation` (Premium/Pro).
     */
    invitationMusic: v.optional(
      v.object({
        source: v.union(v.literal('library'), v.literal('custom')),
        trackId: v.optional(v.string()),
        s3Key: v.optional(v.string()),
        title: v.optional(v.string()),
      }),
    ),
    /**
     * Photo du couple affichée en tête de l'invitation publique (portrait
     * dévoilé quand la cinématique se lève). Absent = pas de photo (défaut).
     * `s3Key` sous `invitation/{eventId}/…` (upload du couple/agence, servi
     * CloudFront, hors préfixe `incoming/` donc hors modération Lambda —
     * c'est la photo du couple lui-même, pas un contenu invité).
     * `width`/`height` (post-compression) fixent le ratio → zéro CLS.
     * Gaté `cinematicInvitation` (Premium/Pro).
     */
    invitationPhoto: v.optional(
      v.object({
        s3Key: v.string(),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
      }),
    ),
    /**
     * Déroulé de la journée / planning de la cérémonie (guest-facing) — affiché
     * sur la page d'invitation. Édité depuis l'espace couple/agence. Chaque
     * étape : heure (libre, ex « 15 h 00 ») + intitulé + note optionnelle.
     */
    ceremonySchedule: v.optional(
      v.array(
        v.object({
          time: v.string(),
          title: v.string(),
          note: v.optional(v.string()),
        }),
      ),
    ),
    status: v.union(
      v.literal('draft'),
      v.literal('active'),
      v.literal('archived'),
      v.literal('cancelled'),
    ),
    // Set when the owner pays for one of the two B2C plans. Absent = unpaid draft.
    planTier: v.optional(v.union(v.literal('essential'), v.literal('premium'))),
    /**
     * Plan envisagé par le couple, devient `planTier` officiel après paiement
     * Stripe. Persisté dès la création de l'event pour pré-remplir le checkout
     * et permettre de payment-gater la publication. Reset quand le paiement
     * succeeds (`planTier` prend le relais).
     */
    pendingPlanTier: v.optional(v.union(v.literal('essential'), v.literal('premium'))),
    paidAt: v.optional(v.number()),
    /**
     * Forfait OFFERT par l'équipe (partenariat, geste commercial, compte de
     * démo) plutôt que payé. Présent ⇒ `planTier` et `paidAt` ont été posés
     * sans transaction Stripe : indispensable pour ne pas confondre un accès
     * offert avec un revenu lors d'un audit, et pour savoir qui l'a accordé.
     * Posé par `admin:grantEventPlan`, effacé par sa révocation.
     */
    compedPlan: v.optional(
      v.object({
        grantedBy: v.id('users'),
        grantedAt: v.number(),
        reason: v.optional(v.string()),
      }),
    ),
    // Hard cap kept for anti-abuse (uniform across plans). Defaults to 5000 on create.
    maxGuests: v.number(),
    // Gallery access expires after this timestamp. Computed from planTier
    // (Essential = J+30, Premium = J+180) on payment success. Post-event upsell
    // pushes this to J+5y.
    galleryExpiresAt: v.optional(v.number()),
    /**
     * Horodatage de l'achat de l'upsell HD post-event (+29 €). Présent ⇒ la
     * galerie a été prolongée à 5 ans contre paiement et l'archive HD est
     * débloquée. Absent ⇒ upsell jamais acheté (la carte d'upsell reste
     * proposée). Posé par `payments:applyPostEventUpsell` après confirmation
     * Stripe.
     */
    hdUpsellPurchasedAt: v.optional(v.number()),
    /**
     * Configuration du message d'invitation WhatsApp envoyé aux invités.
     * Le couple choisit un style préfabriqué (Wedillybird-prefab MVP — cf.
     * `lib/whatsapp/templates.ts`) et personnalise via un mot perso libre
     * (max 60 chars) + un canal préféré.
     *
     * Tier supérieur (Premium) débloquera les templates 100% custom plus
     * tard (cf. BACKLOG section "Templates WhatsApp Cloud API"). Pour
     * cette phase, customTemplateId est réservé pour W3.
     */
    messagingConfig: v.optional(
      v.object({
        templateStyle: v.union(
          v.literal('classic'),
          v.literal('warm'),
          v.literal('african'),
          v.literal('minimal'),
          v.literal('festive'),
        ),
        personalMessage: v.optional(v.string()),
        preferredChannel: v.union(v.literal('whatsapp'), v.literal('email'), v.literal('both')),
        // Référence vers un template custom soumis par le couple (cf. table
        // `whatsappTemplates`). Utilisé en priorité sur `templateStyle` quand
        // le template est `approved`. Tant que le template est `pending` ou
        // `rejected`, on retombe sur le style préfabriqué.
        customTemplateId: v.optional(v.id('whatsappTemplates')),
        // Canal sur lequel le couple veut être notifié quand Meta valide ou
        // rejette son template custom. Distinct de `preferredChannel` (qui
        // concerne l'envoi des invitations aux invités).
        templateNotifyChannel: v.optional(
          v.union(v.literal('whatsapp'), v.literal('email'), v.literal('both')),
        ),
      }),
    ),
    /**
     * Configuration du formulaire RSVP présenté à l'invité sur la page
     * d'invitation. Permet au couple / à l'agence de piloter les champs
     * demandés au lieu des 4 champs figés historiques.
     *
     * - `askDietary` / `askNotes` / `askPlusOnes` : (dé)activer les champs
     *   built-in. `undefined` = comportement historique (champ affiché).
     * - `dietaryLabel` / `notesLabel` : renommer le libellé (sinon fallback i18n).
     * - `customQuestions` : questions additionnelles typées — feature gated
     *   Premium/Pro (cf. `convex/lib/entitlements.ts:customRsvpQuestions`). Les
     *   réponses sont stockées dans `guests.customAnswers`.
     */
    rsvpConfig: v.optional(
      v.object({
        askDietary: v.optional(v.boolean()),
        dietaryLabel: v.optional(v.string()),
        askNotes: v.optional(v.boolean()),
        notesLabel: v.optional(v.string()),
        askPlusOnes: v.optional(v.boolean()),
        /**
         * Event d'agence : le couple rattaché peut-il modifier ce questionnaire ?
         * Défaut absent = `false`. Seul le propriétaire (agence) bascule ce flag.
         */
        coupleCanEdit: v.optional(v.boolean()),
        customQuestions: v.optional(
          v.array(
            v.object({
              id: v.string(),
              type: v.union(
                v.literal('short_text'),
                v.literal('long_text'),
                v.literal('single_choice'),
                v.literal('multi_choice'),
                v.literal('boolean'),
              ),
              label: v.string(),
              options: v.optional(v.array(v.string())),
              required: v.optional(v.boolean()),
              onlyIfAttending: v.optional(v.boolean()),
            }),
          ),
        ),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_slug', ['slug'])
    .index('by_status', ['status'])
    .index('by_organization', ['organizationId'])
    // Cron quotidien des rappels J-7/J-1 (`reminders.ts:listEventsInWindow`) :
    // sans cet index, le scan fait un `.filter()` sur `.collect()` intégral de
    // la table `events` chaque jour — coût O(tous les events) qui grossit sans
    // borne (F6, audit archi 2026-07-19). Permet `.withIndex('by_eventDate', …)`.
    .index('by_eventDate', ['eventDate']),

  guests: defineTable({
    eventId: v.id('events'),
    fullName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    category: v.optional(v.string()),
    plusOnesAllowed: v.number(),
    plusOnesNames: v.optional(v.array(v.string())),
    rsvpStatus: v.union(
      v.literal('pending'),
      v.literal('attending'),
      v.literal('declined'),
      v.literal('maybe'),
    ),
    rsvpRespondedAt: v.optional(v.number()),
    dietaryRestrictions: v.optional(v.string()),
    notes: v.optional(v.string()),
    /**
     * Réponses aux questions custom (`events.rsvpConfig.customQuestions`).
     * Une entrée par question répondue ; `values` porte 1 valeur (texte /
     * choix unique / booléen `'yes'|'no'`) ou N (choix multiple).
     */
    customAnswers: v.optional(
      v.array(
        v.object({
          questionId: v.string(),
          values: v.array(v.string()),
        }),
      ),
    ),
    qrCodeToken: v.string(),
    checkedInAt: v.optional(v.number()),
    checkedInBy: v.optional(v.id('users')),
    invitationSentAt: v.optional(v.number()),
    invitationChannel: v.optional(
      v.union(v.literal('whatsapp'), v.literal('email'), v.literal('sms')),
    ),
    // Reminders sent (idempotence for the daily cron). Set when SES action succeeds.
    reminderD7SentAt: v.optional(v.number()),
    reminderD1SentAt: v.optional(v.number()),
    /**
     * Timestamp du dernier rappel (tous canaux/tiers confondus) envoyé à
     * l'invité. Utilisé comme garde-fou anti-doublon court-terme : si une
     * cron est ré-exécutée (manuellement ou suite à un retry transient) on
     * skip tout invité réveillé < 12 h plus tôt, peu importe le tier (D7/D1).
     * Distinct de `reminderD{7|1}SentAt` qui assurent l'idempotence par tier
     * sur la durée de vie de l'event.
     */
    lastReminderSentAt: v.optional(v.number()),
    /**
     * Table de placement assignée (plan de table / seating, feature Premium/Pro).
     * undefined = invité non assigné. L'invité + ses plus-ones confirmés
     * occupent cette table (capacité comptée côté query getSeatingPlan).
     */
    tableId: v.optional(v.id('tables')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_event_rsvp', ['eventId', 'rsvpStatus'])
    .index('by_qr_token', ['qrCodeToken'])
    .index('by_phone', ['phone'])
    .index('by_table', ['tableId']),

  /**
   * Notifications in-app par utilisateur. Créées à la volée (réponse RSVP,
   * modification du questionnaire par le couple, tâche/rendez-vous d'agence…).
   * Stockage **structuré** (`type` + `data`) → rendu localisé côté client.
   */
  notifications: defineTable({
    userId: v.id('users'),
    type: v.union(
      v.literal('rsvp_response'),
      v.literal('rsvp_config_changed'),
      v.literal('planning_task'),
      v.literal('generic'),
    ),
    eventId: v.optional(v.id('events')),
    data: v.optional(
      v.object({
        guestName: v.optional(v.string()),
        rsvpStatus: v.optional(v.string()),
        actorName: v.optional(v.string()),
        taskTitle: v.optional(v.string()),
        coupleLabel: v.optional(v.string()),
        text: v.optional(v.string()),
      }),
    ),
    /** Lien relatif de destination (résolu selon le rôle du destinataire). */
    link: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_created', ['userId', 'createdAt']),

  /**
   * Tables du plan de placement (seating) d'un event. Une row par table
   * physique. L'assignation invité→table est portée par `guests.tableId`.
   * Feature Premium + Pro (cf. `seatingPlan` dans convex/lib/entitlements.ts) ;
   * exclue d'Essentiel.
   */
  tables: defineTable({
    eventId: v.id('events'),
    name: v.string(),
    capacity: v.number(),
    // Forme du nœud dans le plan visuel spatial (v2). Défaut traité comme 'round'.
    // Les 4 premières formes = board agence (lib/pro/seating) ; imperial /
    // sweetheart / head = éditeur couple self-serve (/mon-mariage) uniquement.
    shape: v.optional(
      v.union(
        v.literal('round'),
        v.literal('oval'),
        v.literal('rect'),
        v.literal('square'),
        v.literal('imperial'),
        v.literal('sweetheart'),
        v.literal('head'),
      ),
    ),
    // Position du nœud sur le plan. Unité selon le produit : board agence = px
    // canvas ; éditeur couple /mon-mariage = MÈTRES depuis le coin haut-gauche
    // de la salle (un event ne vit que dans un seul des deux produits).
    // undefined = pas encore positionné → l'UI applique une grille par défaut.
    posX: v.optional(v.number()),
    posY: v.optional(v.number()),
    /** Rotation en degrés (éditeur couple). Défaut 0. */
    rotation: v.optional(v.number()),
    /** Table d'honneur (ornement doré, éditeur couple). */
    honor: v.optional(v.boolean()),
    /** Note libre du couple sur la table. */
    notes: v.optional(v.string()),
    // Ordre d'affichage dans la vue liste (board drag-and-drop).
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_event', ['eventId']),

  /**
   * Placement des **accompagnants** (plus-ones) sur une table, indépendamment
   * de leur invité principal (v2.1). Convention `memberIndex` :
   *  - L'invité principal (memberIndex 0) reste porté par `guests.tableId`
   *    (rétro-compat V1/V2) — il n'a PAS de row ici.
   *  - Chaque accompagnant `plusOnesNames[k]` = memberIndex `k + 1`, et a une
   *    row ici quand il est placé (absence de row = non placé).
   * Une personne = une place (la capacité d'une table compte les personnes).
   */
  tableAssignments: defineTable({
    eventId: v.id('events'),
    guestId: v.id('guests'),
    memberIndex: v.number(), // >= 1 (les accompagnants ; le principal est sur guests.tableId)
    tableId: v.id('tables'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_table', ['tableId'])
    .index('by_guest', ['guestId'])
    .index('by_guest_member', ['guestId', 'memberIndex']),

  /* ==================== Espace couple self-serve (/mon-mariage) ====================
     Tables du produit couple one-shot (event.ownerId = le couple, PAS d'org).
     Volontairement distinctes des tables agence (vendors/budgetLines/planningTasks,
     org-scopées) : zéro couplage avec le back-office pro. Montants en CENTIMES
     dans la devise de l'event (`events.currency`). */

  /** Carnet prestataires du couple. `category`/`status` : cf. convex/lib/coupleModel.ts. */
  coupleVendors: defineTable({
    eventId: v.id('events'),
    name: v.string(),
    category: v.string(),
    status: v.union(
      v.literal('a_contacter'),
      v.literal('contacte'),
      v.literal('devis'),
      v.literal('reserve'),
      v.literal('paye'),
    ),
    /** Budget prévu pour ce prestataire (centimes). */
    amountMinor: v.number(),
    /** Déjà payé (centimes). */
    paidMinor: v.number(),
    contact: v.optional(v.string()),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
    /** Pièces jointes déclaratives (métadonnées seules — pas de binaire en phase 1). */
    attachments: v.optional(v.array(v.object({ name: v.string(), kind: v.string() }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_event', ['eventId']),

  /** Échéancier de paiements du couple (acomptes / soldes prestataires). */
  couplePayments: defineTable({
    eventId: v.id('events'),
    /** Rattachement facultatif à une fiche prestataire. */
    vendorId: v.optional(v.id('coupleVendors')),
    /** Nom affiché (dénormalisé — l'échéance survit à la suppression de la fiche). */
    vendorName: v.string(),
    category: v.string(),
    kind: v.union(v.literal('deposit'), v.literal('balance'), v.literal('other')),
    /** Date d'échéance (epoch ms). */
    dueDate: v.number(),
    /** Montant dû (centimes). */
    amountMinor: v.number(),
    /** Montant réglé (centimes, 0 ≤ paidMinor). > 0 = acompte partiel ou soldé. */
    paidMinor: v.number(),
    /** Date de règlement effectif (epoch ms) quand payé. */
    paidAt: v.optional(v.number()),
    attachments: v.optional(v.array(v.object({ name: v.string(), kind: v.string() }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_vendor', ['vendorId']),

  /** Phases du rétroplanning perso. `labelKey` (template i18n) XOR `label` (libre). */
  couplePhases: defineTable({
    eventId: v.id('events'),
    label: v.optional(v.string()),
    labelKey: v.optional(v.string()),
    sub: v.optional(v.string()),
    subKey: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_event', ['eventId']),

  /** Tâches du rétroplanning perso, rattachées à une phase. */
  coupleTasks: defineTable({
    eventId: v.id('events'),
    phaseId: v.id('couplePhases'),
    label: v.optional(v.string()),
    labelKey: v.optional(v.string()),
    status: v.union(v.literal('todo'), v.literal('doing'), v.literal('done')),
    /** Échéance (epoch ms). */
    dueDate: v.optional(v.number()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_phase', ['phaseId']),

  /**
   * Salle du plan de table couple (1 row par event) : dimensions en mètres,
   * sol, éléments de décor (piste, bar, arche…). Les tables vivent dans
   * `tables` (posX/posY en mètres pour ce produit).
   */
  coupleRooms: defineTable({
    eventId: v.id('events'),
    name: v.string(),
    widthM: v.number(),
    lengthM: v.number(),
    floor: v.union(
      v.literal('parquet'),
      v.literal('marble'),
      v.literal('carpet'),
      v.literal('grass'),
      v.literal('concrete'),
    ),
    elements: v.array(
      v.object({
        id: v.string(),
        kind: v.union(
          v.literal('dancefloor'),
          v.literal('stage'),
          v.literal('dj'),
          v.literal('bar'),
          v.literal('buffet'),
          v.literal('cake'),
          v.literal('photobooth'),
          v.literal('gifts'),
          v.literal('guestbook'),
          v.literal('entrance'),
          v.literal('arch'),
          v.literal('plant'),
        ),
        x: v.number(),
        y: v.number(),
        w: v.number(),
        h: v.number(),
        rotation: v.number(),
        label: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_event', ['eventId']),

  eventCollaborators: defineTable({
    eventId: v.id('events'),
    userId: v.id('users'),
    role: v.union(
      v.literal('couple'), // le ou les marié·e·s rattaché·e·s par l'agence (espace couple)
      v.literal('co_owner'),
      v.literal('planner'),
      v.literal('scanner'),
      v.literal('viewer'),
    ),
    invitedBy: v.id('users'),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index('by_event', ['eventId'])
    .index('by_user', ['userId'])
    .index('by_event_user', ['eventId', 'userId']),

  payments: defineTable({
    userId: v.id('users'),
    eventId: v.id('events'),
    /**
     * Nature du paiement one-shot particulier :
     *  - `plan` (défaut, absent pour rétro-compat) : achat d'un forfait
     *    Essentiel/Premium → `plan` renseigné.
     *  - `post_event_upsell` : achat de l'upsell HD post-event (+29 €) →
     *    `plan` absent (ce n'est pas un forfait), la rétention galerie passe à
     *    5 ans (cf. `applyPostEventUpsell`).
     */
    kind: v.optional(v.union(v.literal('plan'), v.literal('post_event_upsell'))),
    // Forfait acheté. Absent pour un paiement `post_event_upsell`.
    plan: v.optional(v.union(v.literal('essential'), v.literal('premium'))),
    currency: v.union(
      v.literal('EUR'),
      v.literal('USD'),
      v.literal('XOF'),
      v.literal('MAD'),
      v.literal('TND'),
    ),
    amountMinor: v.number(),
    provider: v.union(v.literal('stripe'), v.literal('mock')),
    providerSessionId: v.string(),
    providerEventId: v.optional(v.string()),
    /** Affilié/parrain attribué (posé au checkout via `?ref`). Le referral est
     *  enregistré dans le ledger à la confirmation du paiement (`markSucceeded`). */
    affiliateId: v.optional(v.id('affiliates')),
    /** Token de réservation du crédit de parrainage appliqué à ce checkout —
     *  consommé (lignes → `credited`) à la confirmation. */
    creditReservationId: v.optional(v.string()),
    status: v.union(
      v.literal('pending'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('cancelled'),
      // Remboursé depuis l'admin (total) / partiellement remboursé. Le montant
      // remboursé est dans `refundedAmountMinor` (≤ amountMinor).
      v.literal('refunded'),
      v.literal('partially_refunded'),
    ),
    failureReason: v.optional(v.string()),
    /** Montant remboursé cumulé (unités mineures). Posé par l'admin via Stripe. */
    refundedAmountMinor: v.optional(v.number()),
    /** Date du dernier remboursement (ms). */
    refundedAt: v.optional(v.number()),
    /** Id du dernier refund Stripe (`re_…`) — traçabilité. */
    stripeRefundId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .index('by_session', ['provider', 'providerSessionId'])
    // Cron de réconciliation Stripe↔Convex (`payments.ts:listStalePending`,
    // T2-2) : retrouve les paiements `pending` plus vieux que N minutes sans
    // scanner toute la table. `status` d'abord (cardinalité faible, filtre
    // fort) puis `createdAt` pour la borne d'âge.
    .index('by_status_createdAt', ['status', 'createdAt']),

  /**
   * Commandes de livre photo HD imprimé — débloquées par l'upsell HD post-event
   * (`events.hdUpsellPurchasedAt`). La fabrication/expédition est assurée
   * manuellement par l'équipe ops (pas d'intégration imprimeur automatisée) :
   * la commande est enregistrée ici, ops est notifiée par email et fait évoluer
   * le `status` à la main.
   */
  photoBookOrders: defineTable({
    eventId: v.id('events'),
    userId: v.id('users'),
    status: v.union(
      v.literal('requested'),
      v.literal('in_production'),
      v.literal('shipped'),
      v.literal('cancelled'),
    ),
    recipientName: v.string(),
    addressLine1: v.string(),
    addressLine2: v.optional(v.string()),
    city: v.string(),
    postalCode: v.string(),
    country: v.string(),
    /** Note libre du couple (ex. consignes de livraison). */
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_user', ['userId']),

  photos: defineTable({
    eventId: v.id('events'),
    // Exactly one of storageId (legacy Convex storage) or s3Key (current AWS S3) is set.
    storageId: v.optional(v.id('_storage')),
    s3Key: v.optional(v.string()),
    uploadedBy: v.optional(v.id('users')),
    uploadedByGuestToken: v.optional(v.string()),
    uploaderName: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected')),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    sizeBytes: v.number(),
    contentType: v.string(),
    /**
     * Variantes WebP générées par le Lambda Sharp à l'upload : `thumb-256`,
     * `medium-1024`, `large-2048`. Stockées sous `processed/{eventId}/{photoId}/{size}.webp`
     * et exposées via CloudFront (même distribution que `s3Key`).
     *
     * - thumb (max 256px) : grid masonry galerie owner/guest, ~12 KB / image.
     * - medium (max 1024px) : lightbox / face search hits, ~80 KB / image.
     * - large (max 2048px) : download single + ZIP (full-resolution-ish).
     *
     * Si absent (Lambda pas tourné, échec, ancienne photo) : fallback sur
     * `s3Key` original côté UI.
     */
    variants: v.optional(
      v.object({
        thumb: v.optional(v.string()),
        medium: v.optional(v.string()),
        large: v.optional(v.string()),
      }),
    ),
    moderatedAt: v.optional(v.number()),
    moderatedBy: v.optional(v.id('users')),
    moderation: v.optional(
      v.object({
        source: v.union(v.literal('rekognition'), v.literal('manual')),
        // `manual_review` = Rekognition n'a ni rejeté ni approuvé en confiance
        // (image détectée comme illustration suspecte ou OCR ambigu) — la
        // photo reste `status: 'pending'` jusqu'à intervention owner explicite.
        decision: v.union(v.literal('approved'), v.literal('rejected'), v.literal('manual_review')),
        topLabel: v.optional(v.string()),
        topConfidence: v.optional(v.number()),
        labels: v.optional(v.array(v.object({ name: v.string(), confidence: v.number() }))),
        /** Texte OCR brut extrait par Rekognition.DetectText (utile à l'audit). */
        ocrText: v.optional(v.string()),
        /** Mot-clé blacklist OCR qui a déclenché un `rejected` ou `manual_review`. */
        ocrFlaggedKeyword: v.optional(v.string()),
        /** Catégories haut-niveau détectées (Drawing, Illustration, Cartoon, etc.). */
        contentLabels: v.optional(v.array(v.string())),
        /** Raison lisible passée au owner pour expliquer un `manual_review`. */
        reviewReason: v.optional(v.string()),
        decidedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_event_status', ['eventId', 'status'])
    .index('by_guest_token', ['uploadedByGuestToken'])
    .index('by_s3_key', ['s3Key'])
    // Réconciliation média (cron de secours F4) : retrouver les photos restées
    // `pending` au-delà du délai de modération sans full-scan, pour détecter un
    // pipeline Lambda cassé (secret désaligné, erreur, quota) qui laisse la
    // galerie vide le jour J. Miroir de `smsDeliveries.by_status_updated`.
    .index('by_status_createdAt', ['status', 'createdAt']),

  /**
   * Visages extraits par Rekognition `IndexFaces` pour chaque photo
   * `approved`. Une row par visage détecté (jusqu'à 5 par image), permet la
   * recherche par selfie via `SearchFacesByImage` puis lookup `faceId →
   * photoId` ici.
   *
   * Les valeurs `faceId` proviennent du Rekognition Face ID (UUID Rekognition,
   * stable tant que la collection existe). Suppression d'une photo doit
   * supprimer les `photoFaces` associés (cleanup côté `photos:remove`,
   * non encore câblé — cf. BACKLOG section "Câblage métier").
   */
  photoFaces: defineTable({
    photoId: v.id('photos'),
    eventId: v.id('events'),
    faceId: v.string(),
    boundingBox: v.optional(
      v.object({
        width: v.number(),
        height: v.number(),
        left: v.number(),
        top: v.number(),
      }),
    ),
    confidence: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_photo', ['photoId'])
    .index('by_event', ['eventId'])
    .index('by_face', ['faceId']),

  otpSessions: defineTable({
    phone: v.string(),
    codeHash: v.string(),
    channel: v.union(v.literal('whatsapp'), v.literal('sms')),
    attempts: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
    ipAddress: v.optional(v.string()),
  })
    .index('by_phone', ['phone'])
    .index('by_phone_expires', ['phone', 'expiresAt']),

  /**
   * Magic Link sessions — fallback auth par email pour les utilisateurs
   * sans WhatsApp. Pattern miroir de otpSessions :
   *  - tokenHash : SHA-256 du token (32 bytes random) avec email en salt
   *  - expiresAt : issuedAt + 15 min (court pour limiter l'exposition)
   *  - consumedAt : single-use, set quand le token est utilisé
   */
  magicLinkSessions: defineTable({
    email: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
    ipAddress: v.optional(v.string()),
  })
    .index('by_email', ['email'])
    .index('by_email_expires', ['email', 'expiresAt'])
    .index('by_token_hash', ['tokenHash']),

  /**
   * Link verifications — codes OTP 6 chiffres pour ajouter un identifiant
   * (phone OU email) à un user existant. Distinct de `otpSessions` /
   * `magicLinkSessions` qui sont pour le login. Évite les doublons : un user
   * peut activer sa 2e méthode de connexion sans créer un compte distinct.
   *
   * Pattern :
   *  1. Sender : `auth.requestLink{Phone,Email}` génère un code 6 digits,
   *     vérifie que le target n'appartient pas déjà à un autre user, envoie
   *     via WhatsApp (phone) ou SES (email)
   *  2. Verifier : `auth.verifyLink{Phone,Email}` vérifie le code, patche
   *     `users.{phone|email}` (block si pris entre-temps : race condition)
   */
  linkVerifications: defineTable({
    userId: v.id('users'),
    targetKind: v.union(v.literal('phone'), v.literal('email')),
    targetValue: v.string(),
    codeHash: v.string(),
    attempts: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
    ipAddress: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    .index('by_user_kind', ['userId', 'targetKind'])
    .index('by_user_kind_expires', ['userId', 'targetKind', 'expiresAt']),

  /**
   * Newsletter subscribers — abonnés à la newsletter publique. MVP store-first :
   * on capture l'email avant de brancher un service externe (Brevo, Mailchimp).
   *
   * Toggle status pour permettre désabonnement plus tard sans hard-delete (RGPD :
   * un soft-delete avec timestamp permet la traçabilité, hard-delete sur demande
   * explicite via `rights` privacy policy).
   *
   * Pas de double opt-in pour le moment — `confirmedAt` réservé pour quand on
   * branchera le système de campagnes (lien de confirmation dans le mail
   * de bienvenue).
   */
  /**
   * Templates WhatsApp custom soumis par les couples (Premium tier).
   *
   * Le couple écrit son corps de message + libellé du bouton CTA, on génère
   * un nom Meta unique (`couple_{eventId}_{nanoid}`) et on soumet à
   * Meta Cloud API : `POST /{WABA_ID}/message_templates`. Meta valide en
   * 24-48h via Business Manager.
   *
   * États :
   *  - `draft` : créé localement, pas encore soumis à Meta
   *  - `pending` : soumis, en attente de revue Meta (status PENDING)
   *  - `approved` : Meta a validé (status APPROVED), utilisable pour broadcast
   *  - `rejected` : Meta a refusé (status REJECTED), `rejectionReason` rempli
   *  - `paused` : Meta a suspendu pour qualité (status PAUSED)
   *  - `disabled` : Meta a définitivement désactivé (status DISABLED)
   *
   * Le webhook Meta `message_template_status_update` met à jour ces états et
   * déclenche une notification au couple via `templateNotifyChannel`.
   *
   * Variables canoniques (alignement avec les 5 styles préfabriqués) :
   *   {{1}} = prénom invité, {{2}} = noms du couple, {{3}} = date,
   *   {{4}} = mot perso, {{5}} = optionnel (libre)
   * Le bouton CTA URL utilise un placeholder dynamique pour le QR token de
   * l'invité.
   */
  whatsappTemplates: defineTable({
    ownerId: v.id('users'),
    eventId: v.id('events'),
    // Nom unique côté Meta (lowercase, alphanumérique + underscore, max 512).
    name: v.string(),
    language: v.literal('fr'),
    category: v.literal('MARKETING'),
    bodyText: v.string(),
    ctaLabel: v.string(),
    // URL pattern du bouton, ex: `https://wedillybird.com/i/{{1}}`. Le {{1}}
    // sera remplacé par le qrCodeToken de l'invité au moment de l'envoi.
    ctaUrlPattern: v.string(),
    status: v.union(
      v.literal('draft'),
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('paused'),
      v.literal('disabled'),
    ),
    // ID Meta (assigné après soumission réussie). Utilisé par le webhook pour
    // matcher les events `message_template_status_update`.
    metaTemplateId: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    submittedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    // Idempotence : si une notif a déjà été envoyée pour le passage à
    // `approved`/`rejected`/`disabled`, on ne renotifie pas.
    notifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_owner', ['ownerId'])
    .index('by_meta_id', ['metaTemplateId'])
    .index('by_status', ['status']),

  newsletterSubscribers: defineTable({
    email: v.string(),
    status: v.union(v.literal('active'), v.literal('unsubscribed')),
    source: v.optional(v.string()),
    subscribedAt: v.number(),
    unsubscribedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    ipAddress: v.optional(v.string()),
  })
    .index('by_email', ['email'])
    .index('by_status_subscribedAt', ['status', 'subscribedAt']),

  /**
   * Campagnes newsletter envoyées depuis l'admin via SES. Une row par envoi
   * « à tous ». Les envois de test (à soi-même) ne sont PAS enregistrés ici.
   */
  newsletterCampaigns: defineTable({
    subject: v.string(),
    bodyText: v.string(),
    status: v.union(v.literal('sending'), v.literal('sent'), v.literal('failed')),
    totalRecipients: v.number(),
    sentCount: v.number(),
    failedCount: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  }).index('by_createdAt', ['createdAt']),

  /**
   * Buckets de rate-limit générique. Une row par couple (scope, key) — par ex.
   * (`face_search`, `<userId>`) ou (`face_search`, `<guestToken>`). Le compteur
   * se reset quand `windowStartedAt` est plus vieux que la fenêtre configurée
   * côté caller (cf. `convex/lib/rateLimit.ts`).
   *
   * On utilise un bucket DB plutôt qu'un cache mémoire car les actions Convex
   * sont stateless et peuvent tourner sur des workers différents — il faut un
   * état partagé pour que le rate-limit soit fiable.
   */
  rateLimitBuckets: defineTable({
    scope: v.string(),
    key: v.string(),
    count: v.number(),
    windowStartedAt: v.number(),
    updatedAt: v.number(),
  }).index('by_scope_key', ['scope', 'key']),

  adminAuditLog: defineTable({
    adminId: v.id('users'),
    action: v.string(),
    targetType: v.union(
      v.literal('user'),
      v.literal('event'),
      v.literal('payment'),
      v.literal('organization'),
      v.literal('subscription'),
      v.literal('coupon'),
      v.literal('discount'),
      v.literal('photo'),
      v.literal('photo_book'),
      v.literal('template'),
      v.literal('newsletter'),
      v.literal('affiliate'),
    ),
    targetId: v.string(),
    details: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_admin', ['adminId'])
    .index('by_target', ['targetType', 'targetId'])
    .index('by_created', ['createdAt']),

  /**
   * CRM clients (back-office agence, feature Business+). Un client = un couple
   * suivi dans le pipeline commercial, du lead à la livraison. Peut être
   * converti en `events` (mariage) : `eventId` est alors renseigné.
   */
  clients: defineTable({
    organizationId: v.id('organizations'),
    partnerA: v.string(),
    partnerB: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    stage: v.union(
      v.literal('lead'),
      v.literal('contacted'),
      v.literal('quote'),
      v.literal('booked'),
      v.literal('in_progress'),
      v.literal('delivered'),
    ),
    /** Origine du lead (Instagram, recommandation, salon…). */
    source: v.optional(v.string()),
    weddingDate: v.optional(v.number()),
    venue: v.optional(v.string()),
    /** Budget estimé (prévu) en centimes d'euro. */
    budgetMinor: v.optional(v.number()),
    /** Budget déjà réservé/engagé en centimes d'euro. */
    budgetBookedMinor: v.optional(v.number()),
    /** Membre de l'agence assigné au dossier. */
    assigneeId: v.optional(v.id('users')),
    notes: v.optional(v.string()),
    /** Mariage créé lors de la conversion du lead. */
    eventId: v.optional(v.id('events')),
    lastContactAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organization', ['organizationId'])
    .index('by_org_stage', ['organizationId', 'stage'])
    .index('by_event', ['eventId']),

  /**
   * Timeline d'activité d'un client CRM (notes manuelles + événements
   * auto-générés : changement de statut, création de mariage…).
   */
  clientNotes: defineTable({
    clientId: v.id('clients'),
    organizationId: v.id('organizations'),
    type: v.union(
      v.literal('note'),
      v.literal('status'),
      v.literal('call'),
      v.literal('email'),
      v.literal('payment'),
    ),
    text: v.string(),
    authorId: v.optional(v.id('users')),
    authorName: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_client', ['clientId']),

  /**
   * Lignes de budget d'un mariage (back-office agence). Lecture pour tous les
   * tiers, édition réservée à Business+. `organizationId` est dénormalisé pour
   * l'autorisation et les vues consolidées.
   */
  budgetLines: defineTable({
    eventId: v.id('events'),
    organizationId: v.id('organizations'),
    category: v.string(),
    label: v.string(),
    vendorName: v.optional(v.string()),
    /** Montant prévu (centimes d'euro). */
    plannedMinor: v.number(),
    /** Montant déjà payé (centimes d'euro). */
    paidMinor: v.number(),
    dueDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_organization', ['organizationId']),

  /**
   * Registre des paiements rattachés à une ligne de budget (back-office agence,
   * Business+). Plusieurs paiements partiels par ligne ; `budgetLines.paidMinor`
   * est le cache de la somme des paiements `succeeded`. Chaque paiement peut
   * porter un justificatif (Convex `_storage`, optionnel).
   *
   * Saisie manuelle (`status: 'succeeded'` immédiat) en Phase 1. Les champs
   * `provider`/`providerSessionId`/`status: 'pending'` sont réservés au
   * paiement en ligne (Wedillybird Pay) branché en Phase 2 — `by_session`
   * garantit l'idempotence des webhooks.
   */
  budgetPayments: defineTable({
    budgetLineId: v.id('budgetLines'),
    eventId: v.id('events'),
    organizationId: v.id('organizations'),
    /** Montant du paiement (centimes d'euro), > 0. */
    amountMinor: v.number(),
    method: v.union(
      v.literal('transfer'), // virement
      v.literal('card'), // carte (saisie manuelle)
      v.literal('cash'), // espèces
      v.literal('check'), // chèque
      v.literal('online'), // via Wedillybird Pay (Phase 2)
      v.literal('other'),
    ),
    status: v.union(v.literal('succeeded'), v.literal('pending'), v.literal('failed')),
    /** Date du paiement (ms). */
    paidAt: v.number(),
    note: v.optional(v.string()),
    /** Justificatif optionnel (blob Convex storage) + nom de fichier d'origine. */
    proofStorageId: v.optional(v.id('_storage')),
    proofFileName: v.optional(v.string()),
    // ---- Paiement en ligne (Wedillybird Pay) ----
    provider: v.optional(v.union(v.literal('stripe'), v.literal('mock'))),
    /** Compte connecté de l'agence sur lequel la session a été créée — sert à vérifier
     *  l'origine du webhook (`event.account`) pour bloquer tout marquage inter-tenant. */
    stripeConnectAccountId: v.optional(v.string()),
    providerSessionId: v.optional(v.string()),
    /** Lien de paiement à partager (Stripe Checkout) tant que le paiement est `pending`. */
    checkoutUrl: v.optional(v.string()),
    /** Reçu hébergé par le prestataire (preuve auto une fois `succeeded`). */
    receiptUrl: v.optional(v.string()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_line', ['budgetLineId'])
    .index('by_event', ['eventId'])
    .index('by_organization', ['organizationId'])
    .index('by_session', ['provider', 'providerSessionId']),

  /**
   * Devis & Factures émis par une agence à ses clients (couples). Org-level,
   * réservé Business+ (`documentsEsign`/quoting). Montants en centimes.
   * Un document est soit un devis (`quote`) soit une facture (`invoice`) ; le
   * champ `status` couvre l'union des statuts des deux types.
   */
  quoteDocs: defineTable({
    organizationId: v.id('organizations'),
    type: v.union(v.literal('quote'), v.literal('invoice')),
    /** Numéro lisible : « DEV-2026-014 » / « FAC-2026-031 ». */
    number: v.string(),
    clientId: v.optional(v.id('clients')),
    /** Nom du client dénormalisé (affichage rapide même si la fiche change). */
    clientName: v.string(),
    eventId: v.optional(v.id('events')),
    status: v.union(
      v.literal('draft'),
      v.literal('sent'),
      v.literal('accepted'),
      v.literal('refused'),
      v.literal('expired'),
      v.literal('partial'),
      v.literal('paid'),
      v.literal('overdue'),
    ),
    lineItems: v.array(
      v.object({ label: v.string(), qty: v.number(), unitPriceMinor: v.number() }),
    ),
    discountMinor: v.optional(v.number()),
    discountPct: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    /** Échéancier de paiement (factures) : acompte + solde, etc. */
    schedule: v.optional(
      v.array(
        v.object({
          label: v.string(),
          amountMinor: v.number(),
          dueDate: v.optional(v.number()),
          paid: v.boolean(),
        }),
      ),
    ),
    issueDate: v.number(),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organization', ['organizationId'])
    .index('by_org_type', ['organizationId', 'type'])
    .index('by_client', ['clientId'])
    .index('by_event', ['eventId']),

  /**
   * Liens de paiement en ligne créés par l'agence sur SON compte Stripe connecté
   * (charge directe). Générique : adossé à une échéance de facture
   * (`kind: 'invoice'`) ou libre (`kind: 'free'`, montant + libellé ad hoc). Le
   * webhook réconcilie via `by_session` ; pour une facture, l'échéance liée passe
   * `paid` automatiquement à l'encaissement. Distinct de `budgetPayments` (qui est
   * adossé aux lignes de budget interne).
   */
  paymentLinks: defineTable({
    organizationId: v.id('organizations'),
    kind: v.union(v.literal('invoice'), v.literal('free')),
    /** Facture liée (kind 'invoice') + index de l'échéance dans `schedule`. */
    invoiceDocId: v.optional(v.id('quoteDocs')),
    invoiceMilestoneIndex: v.optional(v.number()),
    /** Mariage rattaché (pour l'espace couple) — dérivé de la facture (kind 'invoice'). */
    eventId: v.optional(v.id('events')),
    amountMinor: v.number(),
    currency: v.string(),
    /** Libellé affiché au couple sur Stripe Checkout. */
    description: v.string(),
    /** Nom du client (affichage agence), dénormalisé. */
    clientName: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('succeeded'), v.literal('failed')),
    provider: v.union(v.literal('stripe')),
    /** Compte connecté de l'agence sur lequel la session a été créée — sert à vérifier
     *  l'origine du webhook (`event.account`) pour bloquer tout marquage inter-tenant. */
    stripeConnectAccountId: v.optional(v.string()),
    providerSessionId: v.optional(v.string()),
    /** Lien Checkout à partager tant que `pending`. */
    checkoutUrl: v.optional(v.string()),
    /** Reçu hébergé Stripe (preuve auto une fois `succeeded`). */
    receiptUrl: v.optional(v.string()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index('by_organization', ['organizationId'])
    .index('by_session', ['providerSessionId'])
    .index('by_invoice', ['invoiceDocId'])
    .index('by_event', ['eventId']),

  /** Historique d'activité d'un document (création, envoi, paiement…). */
  quoteActivity: defineTable({
    docId: v.id('quoteDocs'),
    organizationId: v.id('organizations'),
    label: v.string(),
    /** Nom d'icône Lucide (ex. « FilePlus », « Send », « CircleCheck »). */
    icon: v.string(),
    createdAt: v.number(),
  }).index('by_doc', ['docId']),

  /**
   * Contrats agence → couple (module Finances, Business+). Cycle de vie :
   * brouillon → envoyé → signé couple → contre-signé → actif (ou annulé).
   * La signature est matérialisée par des transitions de statut (pas de
   * service e-sign externe) ; chaque étape est tracée dans `contractAudit`.
   */
  contracts: defineTable({
    organizationId: v.id('organizations'),
    number: v.string(),
    clientId: v.optional(v.id('clients')),
    clientName: v.string(),
    eventId: v.optional(v.id('events')),
    quoteId: v.optional(v.id('quoteDocs')),
    status: v.union(
      v.literal('draft'),
      v.literal('sent'),
      v.literal('signed_client'),
      v.literal('countersigned'),
      v.literal('active'),
      v.literal('cancelled'),
    ),
    sections: v.array(v.object({ title: v.string(), body: v.string() })),
    totalMinor: v.number(),
    /** Juridiction applicable (FR, BE, CH, LU, CA-QC, US…) → loi + cadre e-signature. */
    jurisdiction: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    signedAt: v.optional(v.number()),
    /** Horodatage de la contre-signature agence (signature électronique). */
    countersignedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organization', ['organizationId'])
    .index('by_client', ['clientId'])
    .index('by_event', ['eventId']),

  /** Journal d'audit d'un contrat (création, envoi, signature, etc.). */
  contractAudit: defineTable({
    contractId: v.id('contracts'),
    organizationId: v.id('organizations'),
    event: v.string(),
    by: v.optional(v.string()),
    ip: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_contract', ['contractId']),

  /**
   * Tâches de rétroplanning d'un mariage (back-office agence, tous tiers).
   * Organisées par phase relative à la date du jour J.
   */
  planningTasks: defineTable({
    eventId: v.id('events'),
    organizationId: v.id('organizations'),
    phase: v.union(
      v.literal('m12'),
      v.literal('m6'),
      v.literal('m3'),
      v.literal('m1'),
      v.literal('d7'),
      v.literal('dday'),
      v.literal('after'),
    ),
    title: v.string(),
    done: v.boolean(),
    /** Statut tri-état (vue Tableau/kanban). `done` reste synchronisé (status==='done'). */
    status: v.optional(v.union(v.literal('todo'), v.literal('doing'), v.literal('done'))),
    /** Note interne libre sur la tâche. */
    notes: v.optional(v.string()),
    /** Sous-tâches (checklist) de la tâche. */
    subtasks: v.optional(v.array(v.object({ label: v.string(), done: v.boolean() }))),
    dueDate: v.optional(v.number()),
    assigneeId: v.optional(v.id('users')),
    priority: v.optional(v.union(v.literal('low'), v.literal('normal'), v.literal('high'))),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_organization', ['organizationId']),

  /**
   * Modèles de rétroplanning personnalisés (org-level, tous tiers). Une agence
   * peut enregistrer un planning maison (liste de tâches par phase) et le
   * réappliquer à n'importe quel mariage, en plus des modèles intégrés.
   */
  planningTemplates: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    tasks: v.array(
      v.object({
        phase: v.union(
          v.literal('m12'),
          v.literal('m6'),
          v.literal('m3'),
          v.literal('m1'),
          v.literal('d7'),
          v.literal('dday'),
          v.literal('after'),
        ),
        title: v.string(),
      }),
    ),
    createdBy: v.optional(v.id('users')),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_organization', ['organizationId']),

  /**
   * Annuaire prestataires d'une agence (org-level, tous tiers ; Starter plafonné
   * à 25 fiches). Réutilisable d'un mariage à l'autre.
   */
  vendors: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    category: v.string(),
    location: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    website: v.optional(v.string()),
    /** Gamme de prix : 1 (€), 2 (€€), 3 (€€€). */
    priceRange: v.optional(v.number()),
    /** Note interne 0–5. */
    rating: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_organization', ['organizationId']),

  /**
   * Rattachement prestataire ↔ mariage (« Par mariage ») : suit l'engagement
   * d'un prestataire sur un événement (statut + budget prévu + ligne budget liée).
   */
  vendorEngagements: defineTable({
    organizationId: v.id('organizations'),
    vendorId: v.id('vendors'),
    eventId: v.id('events'),
    status: v.union(
      v.literal('contacted'),
      v.literal('quoted'),
      v.literal('booked'),
      v.literal('confirmed'),
    ),
    /** Montant prévu rattaché (centimes d'euro). */
    plannedMinor: v.optional(v.number()),
    /** Ligne budget créée pour cet engagement, si « relier au budget ». */
    budgetLineId: v.optional(v.id('budgetLines')),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organization', ['organizationId'])
    .index('by_event', ['eventId'])
    .index('by_vendor', ['vendorId'])
    .index('by_vendor_event', ['vendorId', 'eventId']),

  /**
   * Programme d'affiliation / parrainage. Décision conseil (llm-council) : le
   * LEDGER est le vrai actif — attribution + calcul + statuts vivent ici,
   * indépendamment du mécanisme de versement (crédit auto pour la boucle
   * particulier ; cash groupé puis Connect Express pour les partenaires).
   *
   * `kind` : 'referral' (client-parrain, récompense en CRÉDIT, zéro KYC) ou
   * 'partner' (créateur/planner invité, récompense en CASH, payout différé).
   * Logique pure et bornes dans `convex/lib/affiliate.ts`.
   */
  affiliates: defineTable({
    /** Code lisible partagé (?ref=CODE), unique, normalisé A-Z0-9. */
    code: v.string(),
    kind: v.union(v.literal('referral'), v.literal('partner')),
    /** Récompense : crédit in-app (100 % auto) ou cash (payout différé). */
    rewardType: v.union(v.literal('credit'), v.literal('cash')),
    /** Commission affilié en basis points (2000 = 20,00 %). */
    rateBps: v.number(),
    /** Remise offerte au filleul en basis points (0 = aucune). */
    buyerDiscountBps: v.number(),
    /** Parrain (referral) ou compte partenaire, si rattaché à un user. */
    ownerUserId: v.optional(v.id('users')),
    /** Email partenaire (anti-self-referral + contact payout). */
    ownerEmail: v.optional(v.string()),
    displayName: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('disabled')),
    /**
     * Coupon + code promo Stripe portant la MÊME chaîne que `code`, créés à
     * l'ouverture de l'affilié quand `buyerDiscountBps > 0`. C'est ce qui rend
     * le code réellement partageable : l'audience du partenaire le tape au
     * checkout et obtient la remise, et `markSucceeded` remonte du code promo
     * vers cet affilié pour créditer la commission. Absents = seul le lien
     * `?ref=` attribue (aucune remise saisissable).
     */
    stripeCouponId: v.optional(v.string()),
    stripePromotionCodeId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_owner', ['ownerUserId'])
    .index('by_kind', ['kind']),

  /**
   * Ledger d'attribution : une ligne par vente attribuée à un affilié.
   * Idempotent sur `sourceSessionId` (webhooks Stripe at-least-once).
   * `status` : pending → vested (à la date d'event) → paid|credited | reversed.
   * Montants en CENTIMES, devise native (jamais de conversion dans le ledger).
   */
  affiliateReferrals: defineTable({
    affiliateId: v.id('affiliates'),
    code: v.string(),
    /** Clé d'idempotence = Checkout Session Stripe (unique). */
    sourceSessionId: v.string(),
    paymentId: v.optional(v.id('payments')),
    eventId: v.optional(v.id('events')),
    buyerUserId: v.optional(v.id('users')),
    grossMinor: v.number(),
    /** Net réellement encaissé après remise, TTC (ce que Stripe a débité). */
    netMinor: v.number(),
    /**
     * Assiette de la commission : le net encaissé RAMENÉ HORS TAXES. La TVA
     * n'est pas un revenu (elle est reversée à l'État), la commissionner
     * reviendrait à payer le partenaire dessus.
     *
     * Stocké plutôt que recalculé : le taux de TVA peut changer, et une ligne
     * de ledger doit rester auditable des années plus tard — « encaissé 59,00 /
     * assiette 49,17 / commission 9,83 » se relit sans connaître le taux en
     * vigueur ce jour-là. Absent sur les lignes antérieures à cette règle, où
     * l'assiette valait `netMinor`.
     */
    commissionBaseMinor: v.optional(v.number()),
    currency: v.string(),
    /** Récompense calculée (commission cash OU crédit), centimes. */
    rewardMinor: v.number(),
    rewardType: v.union(v.literal('credit'), v.literal('cash')),
    status: v.union(
      v.literal('pending'),
      v.literal('vested'),
      v.literal('paid'),
      v.literal('credited'),
      v.literal('reversed'),
    ),
    /** Récompense « acquise » à cette date (= date event, plancher J+7). */
    vestsAt: v.number(),
    paidAt: v.optional(v.number()),
    reversedAt: v.optional(v.number()),
    /**
     * RÉSERVATION : token du checkout qui a réservé cette ligne de crédit (le
     * crédit n'est plus re-sélectionnable tant qu'il est réservé → anti
     * double-dépense). Effacé à la consommation OU au relâchement (échec /
     * abandon / GC). Posé atomiquement par `reserveCreditForCheckout`.
     */
    reservedForSession: v.optional(v.string()),
    /**
     * Session d'ACHAT qui a consommé ce crédit (le parrain l'a dépensé ici) —
     * permet de RESTITUER le crédit si cet achat est remboursé.
     */
    consumedBySession: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_affiliate', ['affiliateId'])
    .index('by_source_session', ['sourceSessionId'])
    .index('by_status', ['status'])
    .index('by_status_vests', ['status', 'vestsAt'])
    .index('by_affiliate_status', ['affiliateId', 'status'])
    .index('by_reserved_session', ['reservedForSession'])
    .index('by_consumed_session', ['consumedBySession']),

  /**
   * Crédit de parrainage RÉSERVÉ pour un checkout en cours (parrain qui dépense
   * son crédit). Posé AVANT le coupon Stripe (`reserveCreditForCheckout`), puis
   * consommé à la confirmation du paiement (plan `markSucceeded` OU upsell
   * `applyPostEventUpsell`). Clé = `reservationId` (token généré par la route,
   * transmis en metadata de session Stripe). GC des orphelins après 24 h.
   */
  pendingCreditApplications: defineTable({
    /** Token de réservation (uuid) — clé d'idempotence, ≠ session Stripe. */
    reservationId: v.string(),
    userId: v.id('users'),
    currency: v.string(),
    appliedMinor: v.number(),
    /** Lignes de ledger (crédit) réservées → `credited` à la confirmation. */
    referralIds: v.array(v.id('affiliateReferrals')),
    createdAt: v.number(),
  }).index('by_reservation', ['reservationId']),

  /**
   * Rapports de bug soumis depuis l'app (bouton flottant couple/agence). La
   * capture d'écran est stockée INLINE (data URL JPEG compressé, ≤ 800 Ko) —
   * volume interne faible, pas d'aller-retour S3. Sert au triage produit.
   */
  bugReports: defineTable({
    /** Auteur (session) — optionnel si soumis hors session. */
    reporterId: v.optional(v.id('users')),
    /** URL complète et chemin où le bug a été repéré. */
    url: v.string(),
    pathname: v.string(),
    /** Description saisie/vérifiée par l'utilisateur. */
    description: v.string(),
    userAgent: v.optional(v.string()),
    viewport: v.optional(v.string()),
    locale: v.optional(v.string()),
    /** Capture d'écran (data URL image compressée) ou absente. */
    screenshot: v.optional(v.string()),
    /** Dernières erreurs console captées automatiquement (aide au diagnostic). */
    consoleErrors: v.optional(v.array(v.string())),
    status: v.union(v.literal('open'), v.literal('triaged'), v.literal('resolved')),
    createdAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_created', ['createdAt']),

  /**
   * Journal de livraison SMS (Twilio). Une ligne par message envoyé, mise à jour
   * par le webhook StatusCallback (`/api/webhooks/twilio`). SOURCE DE VÉRITÉ de
   * la livraison réelle : le HTTP 200 de Twilio ne signifie que « accepté en
   * file », jamais « reçu » — les carriers A2P US peuvent filtrer en silence.
   * Sans ce journal, l'UI affichait « envoyé » pour un message jamais reçu (F4).
   */
  smsDeliveries: defineTable({
    twilioSid: v.string(),
    kind: v.union(
      v.literal('invitation'),
      v.literal('reminder'),
      v.literal('otp'),
      v.literal('unknown'),
    ),
    status: v.union(
      v.literal('queued'),
      v.literal('sent'),
      v.literal('delivered'),
      v.literal('undelivered'),
      v.literal('failed'),
      v.literal('unknown'),
    ),
    guestId: v.optional(v.id('guests')),
    eventId: v.optional(v.id('events')),
    to: v.optional(v.string()),
    /** Code d'erreur Twilio (ex. 30007/30008 = message filtré par le carrier). */
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_twilio_sid', ['twilioSid'])
    .index('by_guest', ['guestId'])
    .index('by_event', ['eventId'])
    .index('by_event_status', ['eventId', 'status'])
    // Réconciliation : retrouver les lignes non terminales (queued/sent) restées
    // sans StatusCallback, pour aller interroger Twilio (cron de secours F4).
    .index('by_status_updated', ['status', 'updatedAt']),

  /**
   * Anti-spam de l'alerte de livraison SMS : une ligne par event déjà alerté,
   * pour ne pas ré-emailer l'ops à chaque passage du cron de réconciliation.
   */
  smsDeliveryAlerts: defineTable({
    eventId: v.id('events'),
    alertedAt: v.number(),
    undeliveredRate: v.number(),
  }).index('by_event', ['eventId']),

  /**
   * Anti-spam de l'alerte « pipeline de modération photo bloqué » : une ligne par
   * event déjà alerté, pour ne pas ré-emailer l'ops à chaque passage du cron de
   * réconciliation média (miroir de `smsDeliveryAlerts`, mode d'échec F4 — la
   * galerie qui reste vide quand le callback Lambda n'arrive jamais).
   */
  photoModerationAlerts: defineTable({
    eventId: v.id('events'),
    alertedAt: v.number(),
    stalePendingCount: v.number(),
  }).index('by_event', ['eventId']),
});
