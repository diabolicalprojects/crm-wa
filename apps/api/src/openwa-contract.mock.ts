/**
 * Mock contractual de OpenWA (spec §22.2).
 *
 * Fija la forma real de la pasarela documentada en `docs/openwa-contract.md`.
 * Existe porque el código original asumía un contrato inventado —`event.type`,
 * `event.session_id`, `event.from`, una bandera `fromMe`— y nada lo detectaba:
 * las pruebas usaban esa misma forma imaginaria, así que pasaban mientras
 * producción no recibía un solo mensaje.
 *
 * **Regla:** estos constructores son la única fuente de payloads en las pruebas
 * de ingesta. Si el proveedor cambia, se corrige aquí y las pruebas que
 * dependían de lo viejo fallan, que es justo lo que debe pasar.
 */

import { createHmac } from 'crypto';

export interface DeliveryEnvelope {
  event: string;
  timestamp: string;
  sessionId: string;
  idempotencyKey: string;
  deliveryId: string;
  data: Record<string, unknown>;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1)}`;

function envelope(event: string, sessionId: string, data: Record<string, unknown>): DeliveryEnvelope {
  return {
    event,
    timestamp: '2026-08-31T12:00:00.000Z',
    sessionId,
    // Estable entre reintentos: es la llave de deduplicación del contrato.
    idempotencyKey: `msg_${sessionId}_${data.id ?? nextId('evt')}`,
    // Cambia en cada entrega; NO sirve para deduplicar.
    deliveryId: nextId('dlv'),
    data,
  };
}

/**
 * Mensaje entrante. Nótese que **no lleva `fromMe`**: el contrato real no lo
 * incluye, y asumirlo fue lo que dejó invisible al asesor que responde desde
 * su teléfono.
 */
export function messageReceived(options: {
  sessionId?: string;
  id?: string;
  from?: string;
  body?: string;
  type?: string;
  kind?: string;
  isGroup?: boolean;
  contact?: Record<string, unknown>;
} = {}): DeliveryEnvelope {
  return envelope('message.received', options.sessionId ?? 'wa-1', {
    id: options.id ?? nextId('wamid'),
    from: options.from ?? '5214490000000@c.us',
    to: '5218138703134@c.us',
    body: options.body ?? 'Hola, busco casa',
    type: options.type ?? 'text',
    // Epoch en SEGUNDOS, no milisegundos.
    timestamp: 1772280000,
    isGroup: options.isGroup ?? false,
    kind: options.kind ?? 'individual',
    hasMedia: false,
    contact: options.contact ?? { pushName: 'Humberto' },
  });
}

/**
 * Mensaje saliente. Cubre dos casos que el CRM debe distinguir: el eco de su
 * propio envío y el asesor respondiendo desde el teléfono.
 */
export function messageSent(options: {
  sessionId?: string;
  id?: string;
  to?: string;
  body?: string;
} = {}): DeliveryEnvelope {
  return envelope('message.sent', options.sessionId ?? 'wa-1', {
    id: options.id ?? nextId('wamid'),
    from: '5218138703134@c.us',
    to: options.to ?? '5214490000000@c.us',
    body: options.body ?? 'Con gusto te ayudo',
    type: 'text',
    timestamp: 1772280060,
    isGroup: false,
    kind: 'individual',
    hasMedia: false,
  });
}

/** Acuse de entrega. `status` es el canónico; `ack` es el entero heredado. */
export function messageAck(options: {
  sessionId?: string;
  messageId: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
}): DeliveryEnvelope {
  return envelope('message.ack', options.sessionId ?? 'wa-1', {
    id: options.messageId,
    messageId: options.messageId,
    status: options.status,
    ack: { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }[options.status],
  });
}

export function sessionStatus(status: string, sessionId = 'wa-1'): DeliveryEnvelope {
  return envelope('session.status', sessionId, { sessionId, status });
}

export function sessionAuthenticated(sessionId = 'wa-1'): DeliveryEnvelope {
  return envelope('session.authenticated', sessionId, {
    sessionId,
    phone: '5218138703134',
    pushName: 'Ventas Horizonte',
  });
}

export function sessionDisconnected(reason = 'conflict', sessionId = 'wa-1'): DeliveryEnvelope {
  return envelope('session.disconnected', sessionId, { sessionId, reason });
}

export function sessionRestriction(active = true, sessionId = 'wa-1'): DeliveryEnvelope {
  return envelope('session.restriction', sessionId, {
    sessionId,
    active,
    kind: 'SPAM',
    code: 'X1',
    expiresAt: null,
  });
}

/**
 * Firma tal como la calcula el proveedor: HMAC-SHA256 sobre los **bytes crudos**
 * del cuerpo, con prefijo `sha256=`.
 */
export function sign(envelope: DeliveryEnvelope, secret: string) {
  const raw = Buffer.from(JSON.stringify(envelope));
  return {
    raw,
    body: envelope,
    signature: 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    headers: {
      'x-openwa-event': envelope.event,
      'x-openwa-idempotency-key': envelope.idempotencyKey,
      'x-openwa-delivery-id': envelope.deliveryId,
      'x-openwa-retry-count': '0',
    },
  };
}
