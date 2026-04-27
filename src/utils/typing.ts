export function typingDelayMs(text: string): number {
  const random = 300 + Math.floor(Math.random() * 1501);
  return Math.min(9000, Math.max(900, text.length * 35) + random);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
