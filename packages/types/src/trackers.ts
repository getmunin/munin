import { z } from 'zod';

const CanonicalLocales = z.array(z.string().min(1).max(16)).max(32);

export const CreateTrackerBody = z.object({
  name: z.string().min(1).max(120),
  allowedOrigins: z.array(z.string().url()).optional(),
  requireVerifiedIdentity: z.boolean().optional(),
  canonicalLocales: CanonicalLocales.optional(),
});

export type CreateTrackerBodyT = z.infer<typeof CreateTrackerBody>;

export const UpdateTrackerBody = z.object({
  name: z.string().min(1).max(120).optional(),
  allowedOrigins: z.array(z.string().url()).optional(),
  requireVerifiedIdentity: z.boolean().optional(),
  canonicalLocales: CanonicalLocales.optional(),
});

export type UpdateTrackerBodyT = z.infer<typeof UpdateTrackerBody>;
