import { GoogleGenAI, Type } from '@google/genai';
import { ParsedMessage, ParsedMessageSchema } from '../types.js';

const schema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
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
      ]
    },
    confidence: { type: Type.NUMBER },
    amount: { type: Type.NUMBER, nullable: true },
    category: { type: Type.STRING, nullable: true },
    description: { type: Type.STRING, nullable: true },
    personName: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true },
    expenseRef: { type: Type.STRING, nullable: true },
    correction: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        amount: { type: Type.NUMBER, nullable: true },
        category: { type: Type.STRING, nullable: true },
        description: { type: Type.STRING, nullable: true }
      }
    },
    budget: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        period: { type: Type.STRING, nullable: true },
        total: { type: Type.NUMBER, nullable: true },
        categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              limit: { type: Type.NUMBER },
              kind: { type: Type.STRING, enum: ['shared', 'personal'] },
              personName: { type: Type.STRING, nullable: true }
            },
            required: ['name', 'limit', 'kind']
          }
        }
      }
    },
    missingFields: { type: Type.ARRAY, items: { type: Type.STRING } },
    needsConfirmation: { type: Type.BOOLEAN },
    naturalReplyHint: { type: Type.STRING, nullable: true }
  },
  required: ['intent', 'confidence']
};

export class GeminiParser {
  private readonly ai?: GoogleGenAI;

  constructor(apiKey: string | undefined, private readonly model: string) {
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.ai);
  }

  async parse(input: {
    text: string;
    senderName?: string;
    senderJid: string;
    image?: { buffer: Buffer; mimeType: string };
  }): Promise<ParsedMessage> {
    if (!this.ai) {
      throw new Error('Falta GEMINI_API_KEY. Configurá .env para activar el procesamiento con Gemini.');
    }

    const prompt = [
      'Sos un parser de mensajes de un grupo de WhatsApp para un presupuesto compartido.',
      'Respondé solo JSON válido según el schema.',
      'No redactes mensajes finales para usuarios: solo clasificá intención y extraé datos.',
      'Usá null para datos ausentes. Marcá missingFields para monto, categoría, total o categorías cuando correspondan.',
      'Intenciones: register_expense, cancel_expense, availability, setup_budget, list_recent, correct_expense, identify_person, help, financial_advice, bot_question, confirm, unknown.',
      'Clasificá como help pedidos de ayuda, comandos, casos de uso o preguntas como "qué podés hacer".',
      'Clasificá como financial_advice pedidos de consejos, análisis, recomendaciones o diagnóstico sobre el presupuesto.',
      'Clasificá como bot_question consultas abiertas al bot que no sean acciones deterministas y requieran explicación o razonamiento.',
      'Para comprobantes o imágenes de pago, asumí register_expense si hay monto de compra o transferencia.',
      'Los montos deben ser números en unidades de moneda, sin separadores de miles.',
      `Remitente: ${input.senderName ?? input.senderJid}`,
      `Mensaje: ${input.text || '(sin texto)'}`
    ].join('\n');

    const parts: any[] = [{ text: prompt }];
    if (input.image) {
      parts.push({
        inlineData: {
          mimeType: input.image.mimeType,
          data: input.image.buffer.toString('base64')
        }
      });
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error('Gemini no devolvió texto.');
    const parsed = ParsedMessageSchema.parse(JSON.parse(text));
    return parsed;
  }
}
