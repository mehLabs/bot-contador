import { z } from 'zod';

export const IntentSchema = z.enum([
  'register_expense',
  'cancel_expense',
  'availability',
  'setup_budget',
  'list_recent',
  'correct_expense',
  'identify_person',
  'help',
  'financial_advice',
  'bot_question',
  'confirm',
  'unknown'
]);

export const ParsedMessageSchema = z.object({
  intent: IntentSchema,
  confidence: z.number().min(0).max(1).default(0),
  amount: z.number().positive().nullable().default(null),
  category: z.string().trim().min(1).nullable().default(null),
  description: z.string().trim().nullable().default(null),
  personName: z.string().trim().nullable().default(null),
  date: z.string().trim().nullable().default(null),
  expenseRef: z.string().trim().nullable().default(null),
  correction: z
    .object({
      amount: z.number().positive().nullable().default(null),
      category: z.string().trim().nullable().default(null),
      description: z.string().trim().nullable().default(null)
    })
    .nullable()
    .default(null),
  budget: z
    .object({
      period: z.string().trim().nullable().default(null),
      total: z.number().positive().nullable().default(null),
      categories: z
        .array(
          z.object({
            name: z.string().trim().min(1),
            limit: z.number().nonnegative(),
            kind: z.enum(['shared', 'personal']).default('shared'),
            personName: z.string().trim().nullable().default(null)
          })
        )
        .default([])
    })
    .nullable()
    .default(null),
  missingFields: z.array(z.string()).default([]),
  needsConfirmation: z.boolean().default(false),
  naturalReplyHint: z.string().trim().nullable().default(null)
});

export type ParsedMessage = z.infer<typeof ParsedMessageSchema>;
export type Intent = z.infer<typeof IntentSchema>;

export type IncomingMessage = {
  id: string;
  groupJid: string;
  senderJid: string;
  senderName?: string;
  text: string;
  timestamp: Date;
  image?: {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  };
};

export type BotReply = {
  text: string;
  attachmentPath?: string;
};
