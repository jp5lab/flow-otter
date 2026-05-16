import { z } from 'zod';

export const NamingContractSchema = z.object({
  schemaVersion: z.literal(1),
  forbiddenLabelChars: z.string().optional(),
  types: z
    .record(
      z.object({
        labelPattern: z.string().optional(),
        labelMaxLen: z.number().int().positive().optional(),
        requiredFields: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export type NamingContract = z.infer<typeof NamingContractSchema>;
