import type { WebSocket } from 'ws';

interface Client {
  ws: WebSocket;
  shopId: string | null;
}

interface DisplayState {
  type: string;
  payload: Record<string, unknown>;
  ts: number; // epoch ms — used to expire stale state
}

const clients = new Set<Client>();
// Last display state per shop — sent to reconnecting display clients (TTL: 2 min)
const lastDisplayState = new Map<string, DisplayState>();
const DISPLAY_STATE_TTL_MS = 120_000;

export function addClient(ws: WebSocket, shopId: string | null = null) {
  clients.add({ ws, shopId });
}

export function removeClient(ws: WebSocket) {
  for (const c of clients) {
    if (c.ws === ws) {
      clients.delete(c);
      break;
    }
  }
}

export function broadcast(shopId: string, type: string, payload: Record<string, unknown>) {
  // Persist checkout state so reconnecting display clients catch up
  if (['CHECKOUT_CASH', 'CHECKOUT_QR', 'CHECKOUT_PAID'].includes(type)) {
    lastDisplayState.set(shopId, { type, payload, ts: Date.now() });
  } else if (type === 'CHECKOUT_CLOSE') {
    lastDisplayState.delete(shopId);
  }

  const message = JSON.stringify({ type, shopId, payload });
  for (const c of clients) {
    if (c.ws.readyState === 1 && (c.shopId === null || c.shopId === shopId)) {
      c.ws.send(message);
    }
  }
}

/** Returns the last display state for a shop if still within TTL, else null */
export function getLastDisplayState(shopId: string): DisplayState | null {
  const state = lastDisplayState.get(shopId);
  if (!state) return null;
  if (Date.now() - state.ts > DISPLAY_STATE_TTL_MS) {
    lastDisplayState.delete(shopId);
    return null;
  }
  return state;
}

/** Relay a raw message from one client to all other clients in the same shop */
export function relayCast(shopId: string, sender: WebSocket, message: string) {
  for (const c of clients) {
    if (c.ws !== sender && c.ws.readyState === 1 && c.shopId === shopId) {
      c.ws.send(message);
    }
  }
}
