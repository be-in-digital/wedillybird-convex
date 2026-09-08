import { cronJobs } from 'convex/server';
import { api, internal } from './_generated/api';

const crons = cronJobs();

// Daily at 10:00 UTC (= 10:00 Africa/Dakar, UTC+0): scan events and queue
// J-7 / J-1 guest reminder emails. Sandbox-safe: dispatch obeys
// EMAIL_DRIVER=mock until SES production access lands.
crons.cron(
  'dispatch daily guest reminders',
  '0 10 * * *',
  internal.reminders.dispatchDailyGuestReminders,
  {},
);

// Every 30 min: poll Meta for the status of pending custom WhatsApp templates.
// Acts as a fallback if the webhook (`/api/webhooks/whatsapp`) misses an event.
// No-op when WHATSAPP_ACCESS_TOKEN / WHATSAPP_WABA_ID are not configured.
crons.cron(
  'poll whatsapp template statuses',
  '*/30 * * * *',
  internal.whatsappTemplates.pollPendingStatuses,
  {},
);

// Every 5 min: notify owners about template status changes (approved/rejected/...).
// Idempotent — uses `whatsappTemplates.notifiedAt` to avoid duplicates. Triggered
// immediately by the webhook; this cron is the safety net.
crons.cron(
  'dispatch whatsapp template notifications',
  '*/5 * * * *',
  api.whatsappTemplateNotifications.dispatchPendingNotifications,
  {},
);

// Hourly: vest affiliate/referral rewards whose hold has elapsed (pending →
// vested once the event date / J+7 floor is passed). Idempotent; no-op when
// there's nothing due.
//
// Hourly rather than daily because the batch is capped at 200 rows per run and
// `vestsAt` is the WEDDING DATE: a seasonal Saturday can bring far more than
// 200 rewards due at once, and a daily run would have pushed the remainder
// back a full day per 200-row slice. Same cadence as the reservation GC below.
crons.cron('vest affiliate rewards', '0 * * * *', internal.affiliate.vestDueReferrals, {});

// Hourly: release orphan referral-credit reservations (checkout started but
// never confirmed, older than the coupon's 24h redeem window) so the credit
// becomes spendable again. Idempotent.
crons.cron(
  'release stale credit reservations',
  '0 * * * *',
  internal.affiliate.releaseStaleCreditReservations,
  {},
);

// Daily at 03:00 UTC: purge biometric face data (Rekognition Face Collection +
// `photoFaces` rows) for any event whose gallery retention window has expired,
// even if it was never explicitly archived. Privacy/BIPA requirement (Lane T3,
// F7) — indexed faces must not outlive the gallery. Idempotent.
crons.cron(
  'purge expired biometric face data',
  '0 3 * * *',
  internal.events.purgeExpiredBiometricData,
  {},
);

// Every 15 min: reconcile SMS deliveries stuck in a non-terminal state whose
// Twilio StatusCallback was likely lost — poll Twilio for the real status, then
// re-run the deliverability alert check for affected events. Safety net for the
// webhook (`/api/webhooks/twilio`, failure mode F4). No-op when Twilio is not
// configured (dev / not-yet-live).
crons.cron(
  'reconcile sms deliveries',
  '*/15 * * * *',
  internal.smsDeliveries.reconcileStaleDeliveries,
  {},
);

// Every 20 min: detect photos stuck in `pending` with NO moderation verdict —
// the Lambda moderation callback never landed (misaligned secret, Lambda error,
// IAM, Rekognition quota), so the gallery stays empty on the wedding day. Emails
// ops, deduped per event. Safety net for the media pipeline (failure mode F4),
// mirror of the SMS reconciliation above. No-op when the pipeline isn't wired
// (`LAMBDA_CALLBACK_SECRET` unset — dev / not-yet-live).
crons.cron(
  'reconcile stale pending photos',
  '*/20 * * * *',
  internal.photosModerationHealth.reconcileStalePendingPhotos,
  {},
);

export default crons;
