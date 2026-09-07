import 'server-only';
import { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { GenericId } from 'convex/values';
import { api } from '@/convex/_generated/api';

let cachedClient: ConvexHttpClient | null = null;

export function getConvexServerClient(): ConvexHttpClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not set');
  }
  cachedClient = new ConvexHttpClient(url);
  return cachedClient;
}

/**
 * Élargit récursivement les `Id<"table">` (branded strings Convex) en `string`
 * nu **uniquement dans le type des arguments**. Côté serveur Next, les
 * identifiants circulent en `string` (session, params de route, corps de
 * requête) : on ne suit pas le branding `Id` sur le client. À l'exécution un
 * `Id` EST un `string`, donc c'est neutre pour le runtime (le
 * `ConvexHttpClient` sérialise à l'identique) ; ça ne relâche que la contrainte
 * de branding à la frontière d'appel, pas les vrais types (union de littéraux,
 * objets, etc.), qui restent dérivés du code Convex.
 */
type DeBrandIds<T> =
  T extends GenericId<string>
    ? string
    : T extends (infer U)[]
      ? DeBrandIds<U>[]
      : T extends object
        ? { [K in keyof T]: DeBrandIds<T[K]> }
        : T;

/**
 * Applique {@link DeBrandIds} au type des arguments d'une référence de fonction
 * générée, en conservant type/visibilité/retour intacts.
 */
type WithStringIdArgs<Ref> =
  Ref extends FunctionReference<infer Type, infer Vis, infer Args, infer Ret, infer Comp>
    ? FunctionReference<Type, Vis, DeBrandIds<Args>, Ret, Comp>
    : Ref;

type FacadeOf<T> = { [K in keyof T]: WithStringIdArgs<T[K]> };

/**
 * Miroir « façade » des fonctions Convex publiques appelées côté serveur.
 *
 * Chaque nom convivial pointe désormais directement sur la référence générée
 * (`convex/_generated/api.ts`) au lieu d'un `makeFunctionReference` tapé à la
 * main : les types d'arguments et de retour sont donc dérivés du vrai code
 * Convex. Un renommage ou un changement de signature côté `convex/` casse
 * maintenant le typecheck (au lieu d'échouer silencieusement au runtime).
 *
 * Seul assouplissement : les arguments `Id<"table">` sont exposés en `string`
 * (cf. {@link DeBrandIds}), car les call-sites serveur passent des `string`
 * bruts ; c'est neutre à l'exécution.
 */
const rawConvexApi = {
  requestOtp: api.auth.requestOtp,
  verifyOtp: api.auth.verifyOtp,
  requestMagicLink: api.auth.requestMagicLink,
  verifyMagicLink: api.auth.verifyMagicLink,
  currentUser: api.auth.currentUser,
  completeOnboarding: api.users.completeOnboarding,
  userByPhone: api.auth.userByPhone,
  createEvent: api.events.create,
  smsApplyStatusWebhook: api.smsDeliveries.applyStatusWebhook,
  deliveryForEvent: api.smsDeliveries.deliveryForEvent,
  publishEvent: api.events.publish,
  unpublishEvent: api.events.unpublish,
  orgPublishQuotaStatus: api.events.orgPublishQuotaStatus,

  // --- Plan de table / seating (feature Premium + Pro) ---
  createTable: api.seating.createTable,
  updateTable: api.seating.updateTable,
  deleteTable: api.seating.deleteTable,
  assignSeat: api.seating.assignSeat,
  autoAssignGuests: api.seating.autoAssignGuests,
  getSeatingPlan: api.seating.getSeatingPlan,
  listEventsByOwner: api.events.listByOwner,
  updateEventMessagingConfig: api.events.updateMessagingConfig,
  updateRsvpConfig: api.events.updateRsvpConfig,
  updateEvent: api.events.update,
  reconcileEventMaxGuests: api.events.reconcileMaxGuests,
  getEventById: api.events.getById,
  setFaceSearchEnabled: api.events.setFaceSearchEnabled,

  // ---- Espace couple (mariages d'agence) ----
  linkCouple: api.events.linkCouple,
  unlinkCouple: api.events.unlinkCouple,
  coupleLinks: api.events.coupleLinks,
  coupleOverview: api.events.coupleOverview,
  listMineAsCouple: api.events.listMineAsCouple,
  addGuest: api.guests.add,
  updateGuest: api.guests.update,
  removeGuest: api.guests.remove,
  listGuestsByEvent: api.guests.listByEvent,
  countGuestsByEvent: api.guests.countByEvent,
  getGuestByToken: api.guests.getByToken,
  submitRsvp: api.rsvps.submit,
  listGuestsForCheckIn: api.guests.listForCheckIn,
  checkInByToken: api.guests.checkInByToken,
  undoCheckIn: api.guests.undoCheckIn,
  createOwnerS3UploadUrl: api.photosActions.createOwnerS3UploadUrl,
  createGuestS3UploadUrl: api.photosActions.createGuestS3UploadUrl,
  confirmOwnerUpload: api.photos.confirmOwnerUpload,
  confirmGuestUpload: api.photos.confirmGuestUpload,
  listPhotosForOwner: api.photos.listForOwner,
  listApprovedPhotosForGuest: api.photos.listApprovedForGuest,
  moderatePhoto: api.photos.moderate,
  removePhoto: api.photos.remove,
  searchPhotosByFace: api.photos.searchPhotosByFace,
  archiveEvent: api.events.archive,
  recordPaymentIntent: api.payments.recordIntent,
  findPaymentBySession: api.payments.findBySession,
  markPaymentSucceeded: api.payments.markSucceeded,
  markPaymentFailed: api.payments.markFailed,
  listPaymentsByEvent: api.payments.listByEvent,
  // ---- Observabilité T2 (health-check, cron réconciliation, monitor entitlement) ----
  verifyWebhookSecretHealth: api.health.verifyWebhookSecret,
  listStalePendingPayments: api.payments.listStalePending,
  scanOrphanedEntitlements: api.payments.scanOrphanedEntitlements,
  getPaymentForInvoice: api.paymentsInvoice.getForInvoice,
  createOrganization: api.organizations.create,
  myOrganization: api.organizations.myOrganization,
  updateNotificationPrefs: api.organizations.updateNotificationPrefs,
  updateMessagingDefaults: api.organizations.updateMessagingDefaults,
  updateWhiteLabel: api.organizations.updateWhiteLabel,
  setPaymentsSettings: api.organizations.setPaymentsSettings,
  proCockpit: api.pro.cockpit,

  // ---- CRM clients (Business+) ----
  clientsListByOrg: api.clients.listByOrg,
  clientNotesByClient: api.clients.notesByClient,
  createClient: api.clients.create,
  updateClient: api.clients.update,
  addClientNote: api.clients.addClientNote,
  updateClientStage: api.clients.updateStage,
  removeClient: api.clients.remove,
  convertClientToWedding: api.clients.convertToWedding,

  // ---- Budget (lecture tous tiers, édition Business+) ----
  budgetListByEvent: api.budget.listByEvent,
  createBudgetLine: api.budget.createLine,
  updateBudgetLine: api.budget.updateLine,
  removeBudgetLine: api.budget.removeLine,
  setBudgetEnvelope: api.budget.setEnvelope,
  addBudgetPayment: api.budget.addPayment,
  removeBudgetPayment: api.budget.removePayment,
  generateBudgetProofUploadUrl: api.budget.generateProofUploadUrl,
  createBudgetOnlinePaymentIntent: api.budget.createOnlinePaymentIntent,
  attachBudgetOnlineSession: api.budget.attachOnlineSession,
  markBudgetOnlinePaymentSucceeded: api.budget.markOnlinePaymentSucceeded,
  markBudgetOnlinePaymentFailed: api.budget.markOnlinePaymentFailed,

  // ---- Liens de paiement génériques (facture / libre) ----
  createPaymentLinkIntent: api.paymentLinks.createIntent,
  attachPaymentLinkSession: api.paymentLinks.attachSession,
  removePaymentLink: api.paymentLinks.remove,
  markPaymentLinkSucceeded: api.paymentLinks.markSucceeded,
  markPaymentLinkFailed: api.paymentLinks.markFailed,
  listPaymentLinks: api.paymentLinks.listByOrg,
  listPaymentLinksForEvent: api.paymentLinks.listForEvent,

  // ---- Rétroplanning (tous tiers) ----
  planningListByEvent: api.planning.listByEvent,
  createPlanningTask: api.planning.createTask,
  createPlanningTasks: api.planning.createTasks,
  togglePlanningTask: api.planning.toggleTask,
  setPlanningTaskStatus: api.planning.setTaskStatus,
  setPlanningSubtasks: api.planning.setSubtasks,
  updatePlanningTask: api.planning.updateTask,
  removePlanningTask: api.planning.removeTask,
  planningListTemplates: api.planning.listTemplates,
  planningSaveTemplateFromEvent: api.planning.saveTemplateFromEvent,
  planningApplyTemplate: api.planning.applyTemplate,
  planningDeleteTemplate: api.planning.deleteTemplate,

  // ---- Prestataires (annuaire, tous tiers ; Starter ≤ 25) ----
  vendorsListByOrg: api.vendors.listByOrg,
  createVendor: api.vendors.create,
  updateVendor: api.vendors.update,
  removeVendor: api.vendors.remove,
  vendorListEngagementsByOrg: api.vendors.listEngagementsByOrg,
  vendorAttach: api.vendors.attachVendor,
  vendorSetEngagementStatus: api.vendors.setEngagementStatus,
  vendorDetach: api.vendors.detachVendor,

  // ---- Analytics consolidé (Agency) ----
  proAnalytics: api.analytics.consolidated,
  findOrgBySlug: api.organizations.findBySlug,
  findPublicEventBySlug: api.events.findPublicEventBySlug,
  updateOrgBranding: api.organizations.updateBranding,
  generateOrgLogoUploadUrl: api.organizations.generateLogoUploadUrl,
  setOrgLogo: api.organizations.setLogo,
  clearOrgLogo: api.organizations.clearLogo,
  orgConnectStatus: api.organizations.connectStatus,
  setConnectAccount: api.organizations.setConnectAccount,
  updateConnectStatus: api.organizations.updateConnectStatus,
  disconnectStripeAccount: api.organizations.disconnectStripeAccount,
  getOrganization: api.organizations.getById,
  listOrgEvents: api.organizations.listEvents,
  listOrgMembers: api.organizations.listMembers,
  transferOrgOwnership: api.organizations.transferOwnership,
  deleteOrganization: api.organizations.deleteOrganization,
  inviteOrgMember: api.organizations.invite,
  acceptOrgInvite: api.organizations.acceptInvite,
  revokeOrgMembership: api.organizations.revokeMembership,
  updateMemberRole: api.organizations.updateMemberRole,
  cancelOrgInvite: api.organizations.cancelInvite,
  resendOrgInvite: api.organizations.resendInvite,
  reactivateOrgMember: api.organizations.reactivateMember,

  // Public webhook bridge (validates `CONVEX_WEBHOOK_SECRET`). La mutation
  // sous-jacente `organizations:updateSubscription` est passée en
  // `internalMutation` pour fix F-01 (audit avril 2026) — on ne peut plus
  // l'appeler depuis le client.
  updateOrgSubscriptionFromWebhook: api.organizations.updateSubscriptionFromWebhook,
  findOrgByStripeSubscription: api.organizations.findByStripeSubscription,
  markPaygPurchase: api.paygPurchases.markPurchase,
  getPaygCreditsByOrganization: api.paygPurchases.getCreditsByOrganization,
  listPaygPurchasesByOrganization: api.paygPurchases.listByOrganization,
  getUserById: api.users.getById,
  newsletterSubscribe: api.newsletter.subscribe,
  newsletterUnsubscribe: api.newsletter.unsubscribe,
  newsletterListCampaigns: api.newsletter.listCampaigns,
  newsletterSendCampaign: api.emailActions.sendNewsletterCampaign,
  broadcastInvitations: api.invitationActions.broadcast,
  requestLinkPhone: api.auth.requestLinkPhone,
  verifyLinkPhone: api.auth.verifyLinkPhone,
  requestLinkEmail: api.auth.requestLinkEmail,
  verifyLinkEmail: api.auth.verifyLinkEmail,

  // ---- WhatsApp custom templates ----
  createWhatsappTemplate: api.whatsappTemplates.create,
  updateWhatsappTemplateDraft: api.whatsappTemplates.updateDraft,
  submitWhatsappTemplateToMeta: api.whatsappTemplates.submitToMeta,
  listWhatsappTemplatesByEvent: api.whatsappTemplates.listByEvent,
  applyWhatsappTemplateWebhook: api.whatsappTemplates.applyWebhookStatusUpdate,
  dispatchTemplateNotifications: api.whatsappTemplateNotifications.dispatchPendingNotifications,

  // ---- Admin dashboard ----
  adminDashboardKpi: api.admin.dashboardKpi,
  adminListUsers: api.admin.listUsers,
  adminListAllEvents: api.admin.listAllEvents,
  adminListAllPayments: api.admin.listAllPayments,
  adminListAllOrganizations: api.admin.listAllOrganizations,
  adminListPendingPhotos: api.admin.listPendingPhotos,
  adminListAllWhatsappTemplates: api.admin.listAllWhatsappTemplates,
  adminListNewsletterSubscribers: api.admin.listNewsletterSubscribers,
  adminListAuditLog: api.admin.listAuditLog,
  adminSuspendUser: api.admin.suspendUser,
  adminChangeUserRole: api.admin.changeUserRole,
  adminUpdateEventStatus: api.admin.updateEventStatus,
  adminGrantEventPlan: api.admin.grantEventPlan,
  adminRevokeEventPlan: api.admin.revokeEventPlan,
  adminModeratePhoto: api.admin.adminModeratePhoto,
  adminDeleteEvent: api.admin.deleteEvent,
  adminGetPaymentRefundInfo: api.admin.getPaymentRefundInfo,
  adminMarkPaymentRefunded: api.admin.markPaymentRefunded,
  adminGetOrgSubscriptionInfo: api.admin.getOrgSubscriptionInfo,
  adminMarkSubscriptionCanceled: api.admin.markSubscriptionCanceled,
  adminMarkSubscriptionReactivated: api.admin.markSubscriptionReactivated,
  adminLogAction: api.admin.logAction,
  adminPlatformAnalytics: api.admin.platformAnalytics,

  // ----- Devis & Factures (module Finances) -----
  quotesListByOrg: api.quotes.listByOrg,
  quotesGetById: api.quotes.getById,
  quotesCreate: api.quotes.create,
  quotesUpdate: api.quotes.update,
  quotesUpdateStatus: api.quotes.updateStatus,
  quotesRecordSchedulePayment: api.quotes.recordSchedulePayment,
  quotesConvertToInvoice: api.quotes.convertToInvoice,
  quotesRemove: api.quotes.remove,

  // ----- Paiements agence (module Finances) -----
  paymentsOverview: api.payments.overview,

  // ----- Contrats (module Finances) -----
  contractsListByOrg: api.contracts.listByOrg,
  contractsGetById: api.contracts.getById,
  contractsCreate: api.contracts.create,
  contractsAdvance: api.contracts.advance,
  contractsUpdate: api.contracts.update,
  contractsSetStatus: api.contracts.setStatus,
  contractsRemove: api.contracts.remove,

  // --- Features #68 (affiliate / upsell HD / couple mon-mariage / photobook / bug reports) ---
  coupleSpaceBundle: api.coupleSpace.bundle,
  coupleAddVendor: api.coupleSpace.addVendor,
  coupleUpdateVendor: api.coupleSpace.updateVendor,
  coupleRemoveVendor: api.coupleSpace.removeVendor,
  coupleAddPayment: api.coupleSpace.addPayment,
  coupleSetPaymentPaid: api.coupleSpace.setPaymentPaid,
  coupleRemovePayment: api.coupleSpace.removePayment,
  coupleSetBudgetEnvelope: api.coupleSpace.setBudgetEnvelope,
  coupleEnsureDefaultPlanning: api.coupleSpace.ensureDefaultPlanning,
  coupleAddPhase: api.coupleSpace.addPhase,
  coupleAddTask: api.coupleSpace.addTask,
  coupleSetTaskStatus: api.coupleSpace.setTaskStatus,
  coupleRemoveTask: api.coupleSpace.removeTask,
  coupleSaveRoom: api.coupleSpace.saveRoom,
  coupleUpsertTable: api.coupleSpace.upsertTable,
  coupleRemoveTable: api.coupleSpace.removeTable,
  coupleAssignGuestTable: api.coupleSpace.assignGuestTable,
  coupleSetInvitationDesign: api.coupleSpace.setInvitationDesign,
  coupleSetCeremonySchedule: api.coupleSpace.setCeremonySchedule,
  createInvitationMusicUploadUrl: api.invitationAudio.createInvitationMusicUploadUrl,
  createInvitationPhotoUploadUrl: api.invitationAudio.createInvitationPhotoUploadUrl,
  getAffiliateByCode: api.affiliate.getAffiliateByCode,
  createAffiliate: api.affiliate.createAffiliate,
  setAffiliateStatus: api.affiliate.setAffiliateStatus,
  setAffiliateStripeCoupon: api.affiliate.setAffiliateStripeCoupon,
  getAffiliateForAdmin: api.affiliate.getAffiliateForAdmin,
  listAffiliates: api.affiliate.listAffiliates,
  listReferrals: api.affiliate.listReferrals,
  reserveCreditForCheckout: api.affiliate.reserveCreditForCheckout,
  releaseCreditReservation: api.affiliate.releaseCreditReservationMutation,
  referralForUser: api.affiliate.referralForUser,
  ensureReferralCode: api.affiliate.ensureReferralCode,
  markReferralPaid: api.affiliate.markReferralPaid,
  partnerDashboard: api.affiliate.partnerDashboard,
  requestPhotoBook: api.photoBooks.request,
  getPhotoBookOrder: api.photoBooks.getForEvent,
  applyPostEventUpsell: api.payments.applyPostEventUpsell,
  adminListPhotoBookOrders: api.admin.listPhotoBookOrders,
  adminUpdatePhotoBookStatus: api.admin.updatePhotoBookStatus,
  submitBugReport: api.bugReports.submitBugReport,
  listBugReports: api.bugReports.listBugReports,
  getBugReport: api.bugReports.getBugReport,
  updateBugReportStatus: api.bugReports.updateBugReportStatus,
} as const;

/**
 * Références générées telles quelles à l'exécution ; seuls les types des
 * arguments `Id` sont élargis en `string` à la frontière d'appel. Le cast est
 * une identité runtime (mêmes objets `FunctionReference`).
 */
export const convexApi = rawConvexApi as FacadeOf<typeof rawConvexApi>;
