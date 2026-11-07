import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { handleInbound, type Inbound } from './inbound.js';
import type { Ticket } from './effects.js';

type Prepare = (ticket: Ticket) => Promise<Inbound>;
type State = { tickets: Record<string, Ticket> };

const LEASE_MS = 300_000;
const MAX_ATTEMPTS = 5;

function stateFile() {
  const dir = process.env.AGENT_STATE_DIR ?? join(homedir(), '.local', 'state', 'personal-agent');
  return join(dir, 'intake.json');
}

function load(): State {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as State;
  } catch (error: any) {
    if (error.code === 'ENOENT') return { tickets: {} };
    throw error;
  }
}

let activeLock: { file: string; token: string } | undefined;

function lockOwner(lock: string) {
  try {
    return readFileSync(lock, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function lockProcessAlive(token: string) {
  const pid = Number(token.split(':', 1)[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error.code === 'EPERM';
  }
}

function assertLockOwner(file: string) {
  if (activeLock?.file === file && lockOwner(`${file}.lock`) !== activeLock.token) {
    throw new Error('intake lock ownership lost');
  }
}

function save(state: State) {
  const file = stateFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  assertLockOwner(file);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  assertLockOwner(file);
  renameSync(tmp, file);
}

/**
 * The contender is fully written before link() publishes it as the lock. This
 * avoids an ownerless mkdir/write window. Live processes are never reclaimed;
 * a paused process therefore cannot resume into a replacement lock.
 */
function withClaimLock<T>(run: () => T): T {
  const file = stateFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const token = `${process.pid}:${randomUUID()}`;
  const contender = `${file}.${process.pid}.${randomUUID()}.lock`;
  writeFileSync(contender, token, { mode: 0o600 });
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        linkSync(contender, lock);
        acquired = true;
        break;
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const observed = lockOwner(lock);
          if (observed !== undefined && Date.now() - statSync(lock).mtimeMs > 60_000
            && !lockProcessAlive(observed) && observed === lockOwner(lock)) {
            unlinkSync(lock);
            continue;
          }
        } catch (statError: any) {
          if (statError.code !== 'ENOENT') throw statError;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (!acquired) throw new Error('intake claim lock timeout');
    const previous = activeLock;
    activeLock = { file, token };
    try {
      return run();
    } finally {
      try {
        if (lockOwner(lock) === token) unlinkSync(lock);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      } finally {
        activeLock = previous;
      }
    }
  } finally {
    try { unlinkSync(contender); } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function ownershipLost() {
  const error = new Error('ticket ownership lost') as Error & { code?: string };
  error.code = 'TICKET_OWNERSHIP_LOST';
  return error;
}

function isOwnershipLost(error: unknown) {
  return (error as { code?: string })?.code === 'TICKET_OWNERSHIP_LOST';
}

function attach(ticket: Ticket): Ticket {
  Object.defineProperty(ticket, 'persist', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: () => persistTicket(ticket),
  });
  return ticket;
}

function updateTicket(ticket: Ticket, update: (current: Ticket) => void) {
  withClaimLock(() => {
    const state = load();
    const stored = state.tickets[ticket.id];
    if (!stored) throw new Error(`unknown intake ticket: ${ticket.id}`);
    if (stored.owner !== ticket.owner && (stored.owner || ticket.owner)) throw ownershipLost();
    // A stale caller must never move a completed ticket backwards.
    if (stored.status === 'done' && ticket.status !== 'done') return;
    update(ticket);
    state.tickets[ticket.id] = ticket;
    save(state);
  });
}

function persistTicket(ticket: Ticket) {
  updateTicket(ticket, () => undefined);
}

export function claim(source: Ticket['source'], data: any): Ticket | null {
  const ticket = withClaimLock(() => {
    const state = load();
    const key = `${source.kind}:${source.id}`;
    if (state.tickets[key]) return null;
    const latest = Object.values(state.tickets).reduce((max, ticket) => Math.max(max, ticket.created_at ?? 0), 0);
    const created: Ticket = { id: key, source, status: 'pending', attempts: 0, effects: [], data, created_at: Math.max(Date.now(), latest + 1) };
    state.tickets[key] = created;
    save(state);
    return created;
  });
  return ticket ? attach(ticket) : null;
}

export function saveTicket(ticket: Ticket, complete = true) {
  attach(ticket);
  updateTicket(ticket, (current) => {
    current.status = complete ? 'done' : 'pending';
    current.owner = undefined;
    current.heartbeat = Date.now();
  });
}

export function getTicket(id: string): Ticket | undefined {
  const ticket = load().tickets[id];
  return ticket ? attach(ticket) : undefined;
}

/** Acquire a new attempt, or reclaim one whose lease has expired. */
export function startTicket(ticket: Ticket): boolean {
  attach(ticket);
  let started = false;
  withClaimLock(() => {
    const state = load();
    const current = state.tickets[ticket.id];
    if (!current || current.status === 'done' || current.status === 'failed') return;
    const heartbeat = current.heartbeat ?? current.data?.heartbeat ?? 0;
    if (current.status === 'running' && Date.now() - heartbeat <= LEASE_MS) return;

    Object.assign(ticket, current);
    attach(ticket);
    ticket.status = 'running';
    ticket.owner = randomUUID();
    ticket.heartbeat = Date.now();
    ticket.attempts = current.attempts + 1;
    state.tickets[ticket.id] = ticket;
    save(state);
    started = true;
  });
  return started;
}

export async function withHeartbeat<T>(ticket: Ticket, work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    try {
      updateTicket(ticket, (current) => { current.heartbeat = Date.now(); });
    } catch {
      // The next persisted effect or completion update will detect lost ownership.
    }
  }, 30_000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

export async function handle(mastra: any, ticket: Ticket, prepare: Prepare): Promise<Ticket> {
  attach(ticket);
  if (!startTicket(ticket)) return ticket;
  try {
    await withHeartbeat(ticket, async () => {
      const input = await prepare(ticket);
      await handleInbound(mastra, input);
    });
    updateTicket(ticket, (current) => {
      current.status = 'done';
      current.owner = undefined;
      current.heartbeat = Date.now();
    });
  } catch (error) {
    if (!isOwnershipLost(error)) {
      try {
        updateTicket(ticket, (current) => {
          current.status = current.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
          current.owner = undefined;
          current.heartbeat = Date.now();
          current.last_error = error instanceof Error ? error.message : String(error);
        });
      } catch (updateError) {
        if (!isOwnershipLost(updateError)) throw updateError;
      }
    }
    throw error;
  }
  return ticket;
}

export async function recover(mastra: any, prepares: Record<string, Prepare>) {
  const state = load();
  for (const ticket of Object.values(state.tickets)) {
    if (ticket.status !== 'pending' && ticket.status !== 'running') continue;
    const prepare = prepares[ticket.source.kind];
    if (!prepare) {
      mastra.getLogger().warn('no recovery preparer for intake ticket', { id: ticket.id, kind: ticket.source.kind });
      continue;
    }
    try {
      await handle(mastra, attach(ticket), prepare);
    } catch (error) {
      mastra.getLogger().error('intake recovery failed', { id: ticket.id, err: String(error) });
    }
  }
}

export function startRecovery(mastra: any, prepares: Record<string, Prepare>) {
  let recovering = false;
  const run = async () => {
    if (recovering) return;
    recovering = true;
    try {
      await recover(mastra, prepares);
    } catch (error) {
      mastra.getLogger().error('intake recovery scan failed', { err: String(error) });
    } finally {
      recovering = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 30_000);
  timer.unref();
}
