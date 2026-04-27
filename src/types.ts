import { z } from 'zod';

export const IntentSchema = z.enum([
  'register_expense',
  'register_credit_card_expense',
  'cancel_expense',
  'availability',
  'setup_budget',
  'update_budget',
  'setup_next_budget',
  'register_income',
  'adjust_remaining',
  'manage_goal',
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
  creditCard: z
    .object({
      name: z.string().trim().min(1).nullable().default(null)
    })
    .nullable()
    .default(null),
  income: z
    .object({
      amount: z.number().positive().nullable().default(null),
      description: z.string().trim().nullable().default(null),
      category: z.string().trim().nullable().default(null)
    })
    .nullable()
    .default(null),
  goal: z
    .object({
      action: z.enum(['create', 'update', 'delete', 'list']).default('create'),
      title: z.string().trim().nullable().default(null),
      horizon: z.enum(['short', 'medium', 'long']).nullable().default(null),
      amount: z.number().positive().nullable().default(null),
      targetDate: z.string().trim().nullable().default(null),
      notes: z.string().trim().nullable().default(null),
      status: z.enum(['active', 'done', 'cancelled']).nullable().default(null)
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
        .default([]),
      fixedExpenses: z
        .array(
          z.object({
            name: z.string().trim().min(1),
            amount: z.number().nonnegative(),
            source: z.enum(['manual', 'credit_card']).default('manual')
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
  actionTaken?: boolean;
};
