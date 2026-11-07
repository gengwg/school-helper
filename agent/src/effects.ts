export type EffectKind = 'calendar.create' | 'calendar.update' | 'calendar.sync' | 'reply';

export type Effect = {
  id: number;
  key?: string;
  kind: EffectKind;
  payload: any;
  attempts: number;
  sent_at?: string;
  last_error?: string;
  result?: any;
};

export type Ticket = {
  id: string;
  source: { kind: string; id: string };
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  last_error?: string;
  effects: Effect[];
  data?: any;
  result?: any;
  created_at?: number;
  owner?: string;
  heartbeat?: number;
  /** Attached by the intake store; functions are omitted from JSON state. */
  persist?: () => void;
};

export type EffectHandlers = {
  'calendar.create': (payload: any) => Promise<any>;
  'calendar.update': (payload: any) => Promise<any>;
  'calendar.sync': (payload: any) => Promise<any>;
  reply: (payload: any) => Promise<any>;
};

export function enqueueEffect(ticket: Ticket, kind: EffectKind, payload: any, key?: string) {
  if (key) {
    const existing = ticket.effects.find((effect) => effect.key === key);
    if (existing) return existing;
  }
  const id = Math.max(0, ...ticket.effects.map((effect) => effect.id)) + 1;
  const effect: Effect = { id, key, kind, payload, attempts: 0 };
  ticket.effects.push(effect);
  ticket.persist?.();
  return effect;
}

/**
 * Run selected effects in insertion order. The intake store persists each
 * transition so a crash cannot erase an already completed earlier effect.
 * Calendar writes have readback reconciliation; external replies are
 * at-least-once when a provider accepts a send but its response is lost.
 */
export async function processEffects(ticket: Ticket, handlers: EffectHandlers, kinds?: EffectKind[]): Promise<{ complete: boolean; error?: string }> {
  for (const effect of ticket.effects) {
    if (effect.sent_at || (kinds && !kinds.includes(effect.kind))) continue;
    try {
      effect.attempts++;
      ticket.persist?.();
      effect.result = await handlers[effect.kind](effect.payload);
      effect.sent_at = new Date().toISOString();
      delete effect.last_error;
      ticket.persist?.();
    } catch (error) {
      effect.last_error = error instanceof Error ? error.message : String(error);
      try { ticket.persist?.(); } catch { /* preserve the original effect error */ }
      return { complete: false, error: effect.last_error };
    }
  }
  return { complete: true };
}
