import { z } from 'zod';
import { isValidE164, normalizePhoneE164 } from '@/lib/phone';
import { emailSchema } from '@/lib/validators/email';

/**
 * Les messages Zod ci-dessous sont des **codes i18n** (chemin pointé dans
 * `messages/*.json`), pas des textes affichables. Le composant qui consomme
 * ces erreurs doit les passer à `useTranslations()` (ou helper équivalent)
 * avant l'affichage. Cf. `lib/validators/translate-zod.ts`.
 */

export const phoneSchema = z
  .string()
  .trim()
  .min(8, 'Validation.phoneTooShort')
  .transform((val) => normalizePhoneE164(val))
  .refine((val): val is string => val !== null && isValidE164(val), {
    message: 'Validation.phoneInvalid',
  });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Validation.otpFormat');

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
});

export const onboardingSchema = z.object({
  fullName: z.string().trim().min(2, 'Validation.nameTooShort').max(80, 'Validation.nameTooLong'),
  // Optionnel : le wizard masque le step « rôle » pour un compte qui en a
  // déjà un (admin, partenaire déjà pro). Le serveur ne rétrograde jamais.
  role: z.enum(['couple', 'pro']).optional(),
  email: emailSchema,
});

export { emailSchema };

export const requestMagicLinkSchema = z.object({
  email: emailSchema,
});

export const verifyMagicLinkSchema = z.object({
  email: emailSchema,
  token: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/, 'Validation.tokenInvalid'),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type RequestMagicLinkInput = z.infer<typeof requestMagicLinkSchema>;
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
