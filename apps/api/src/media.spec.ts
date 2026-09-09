import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaStorageService } from './media-storage.service';
import { MediaFetchService } from './media-fetch.service';
import { describeForPrompt } from './automation.service';

/** Un doble de Prisma con lo justo para estas pruebas. */
function fakeDb() {
  const assets = new Map<string, any>();
  let seq = 0;
  return {
    assets,
    mediaAsset: {
      create: vi.fn(async ({ data }: any) => {
        const id = `asset-${++seq}`;
        const row = { ...data, id, attempts: data.attempts ?? 0, blob: data.blob?.create ?? null };
        assets.set(id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = assets.get(where.id);
        Object.assign(row, data, data.attempts?.increment ? { attempts: row.attempts + 1 } : {});
        if (data.blob?.upsert) row.blob = { bytes: data.blob.upsert.create.bytes };
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        [...assets.values()].find(
          (a) =>
            (!where.sha256 || a.sha256 === where.sha256) &&
            (!where.id || a.id === where.id) &&
            a.organizationId === where.organizationId &&
            (!where.status || a.status === where.status),
        ) ?? null,
      ),
      findMany: vi.fn(async () => []),
      delete: vi.fn(),
    },
    message: { count: vi.fn(async () => 0), findUnique: vi.fn() },
  } as any;
}

describe('almacén de multimedia', () => {
  let db: any;
  let media: MediaStorageService;

  beforeEach(() => {
    db = fakeDb();
    media = new MediaStorageService(db);
  });

  it('guarda los bytes y deja la clave apuntando al backend', async () => {
    const asset = await media.store({
      organizationId: 'org-1',
      bytes: Buffer.from('una foto'),
      mimeType: 'image/jpeg',
      filename: 'terreno.jpg',
    });
    expect(asset.status).toBe('STORED');
    expect(asset.storageKey).toBe(`db:${asset.id}`);
    expect(asset.sizeBytes).toBe(8);
  });

  /**
   * El mismo archivo reenviado no debe multiplicarse: la deduplicación es lo
   * que hace viable guardar los bytes en la base.
   */
  it('deduplica por contenido dentro de la agencia', async () => {
    const uno = await media.store({ organizationId: 'org-1', bytes: Buffer.from('x'), mimeType: 'image/png' });
    const dos = await media.store({ organizationId: 'org-1', bytes: Buffer.from('x'), mimeType: 'image/png' });
    expect(dos.id).toBe(uno.id);
    expect(db.assets.size).toBe(1);
  });

  it('no deduplica entre agencias distintas aunque el archivo sea idéntico', async () => {
    const uno = await media.store({ organizationId: 'org-1', bytes: Buffer.from('x'), mimeType: 'image/png' });
    const dos = await media.store({ organizationId: 'org-2', bytes: Buffer.from('x'), mimeType: 'image/png' });
    expect(dos.id).not.toBe(uno.id);
  });

  it('rechaza un archivo vacío y uno por encima del tope', async () => {
    await expect(
      media.store({ organizationId: 'org-1', bytes: Buffer.alloc(0), mimeType: 'image/png' }),
    ).rejects.toThrow(/vacío/);
    await expect(
      media.store({
        organizationId: 'org-1',
        bytes: Buffer.alloc(17 * 1024 * 1024),
        mimeType: 'video/mp4',
      }),
    ).rejects.toThrow(/máximo/);
  });

  /**
   * Servir un SVG con su tipo real lo convierte en script ejecutándose en el
   * origen de la API, que es donde vive la sesión del usuario.
   */
  it('solo sirve con su tipo real lo que es inerte', () => {
    expect(MediaStorageService.safeMimeType('image/jpeg')).toBe('image/jpeg');
    expect(MediaStorageService.safeMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg; codecs=opus');
    expect(MediaStorageService.safeMimeType('image/svg+xml')).toBe('application/octet-stream');
    expect(MediaStorageService.safeMimeType('text/html')).toBe('application/octet-stream');
    expect(MediaStorageService.safeMimeType('application/pdf')).toBe('application/octet-stream');
  });

  it('un archivo de otra agencia no se puede leer', async () => {
    const asset = await media.store({ organizationId: 'org-1', bytes: Buffer.from('x'), mimeType: 'image/png' });
    await expect(media.read('org-2', asset.id)).rejects.toThrow(/no encontrado/i);
  });
});

describe('recuperación de la multimedia omitida', () => {
  let db: any;
  let media: any;
  let openwa: any;
  let events: any;
  let fetch: MediaFetchService;

  beforeEach(() => {
    db = fakeDb();
    media = {
      pending: vi.fn(async () => []),
      countAttempt: vi.fn(),
      fulfill: vi.fn(),
      fail: vi.fn(),
    };
    openwa = { fetchMedia: vi.fn() };
    events = { publish: vi.fn() };
    fetch = new MediaFetchService(db, media, openwa, events);
  });

  const pendiente = (extra: any = {}) => ({
    id: 'asset-1',
    mimeType: 'image/jpeg',
    attempts: 0,
    messages: [{ id: 'msg-1' }],
    ...extra,
  });

  const contexto = {
    providerMessageId: 'wa-1',
    conversationId: 'conv-1',
    organizationId: 'org-1',
    session: { providerSessionId: 'sess-1' },
    conversation: { lead: { whatsappChatId: '52449@c.us', phone: '52449' } },
  };

  it('pide el blob con chatId y messageId, y guarda los bytes', async () => {
    media.pending.mockResolvedValue([pendiente()]);
    db.message.findUnique.mockResolvedValue(contexto);
    openwa.fetchMedia.mockResolvedValue({
      bytes: Buffer.from('bytes'),
      mimeType: 'application/octet-stream',
    });

    const resultado = await fetch.sweep();

    expect(openwa.fetchMedia).toHaveBeenCalledWith({
      providerSessionId: 'sess-1',
      chatId: '52449@c.us',
      providerMessageId: 'wa-1',
    });
    // El tipo declarado por el webhook gana sobre el genérico de la descarga.
    expect(media.fulfill).toHaveBeenCalledWith('asset-1', Buffer.from('bytes'), 'image/jpeg');
    expect(resultado.procesados).toBe(1);
    expect(events.publish).toHaveBeenCalledWith('org-1', {
      type: 'message.updated',
      conversationId: 'conv-1',
    });
  });

  it('un fallo pasajero no abandona el archivo: se reintenta', async () => {
    media.pending.mockResolvedValue([pendiente({ attempts: 0 })]);
    db.message.findUnique.mockResolvedValue(contexto);
    openwa.fetchMedia.mockRejectedValue(new Error('503 de la pasarela'));

    await fetch.sweep();

    expect(media.fail).not.toHaveBeenCalled();
  });

  it('agotados los intentos se abandona con el motivo escrito', async () => {
    media.pending.mockResolvedValue([pendiente({ attempts: 3 })]);
    db.message.findUnique.mockResolvedValue(contexto);
    openwa.fetchMedia.mockRejectedValue(new Error('404 No media stored'));

    await fetch.sweep();

    expect(media.fail).toHaveBeenCalledWith('asset-1', '404 No media stored');
  });

  it('sin canal o sin chat no se reintenta: no hay con qué pedirlo', async () => {
    media.pending.mockResolvedValue([pendiente()]);
    db.message.findUnique.mockResolvedValue({ ...contexto, session: null });

    await fetch.sweep();

    expect(openwa.fetchMedia).not.toHaveBeenCalled();
    expect(media.fail).toHaveBeenCalledWith('asset-1', expect.stringMatching(/canal|chat|id/i));
  });

  /**
   * El mismo fallo que la prueba de concurrencia encontró en el sincronizador
   * de calendario: dos barridos simultáneos gastarían el presupuesto de
   * intentos por duplicado sobre los mismos archivos.
   */
  it('no corren dos barridos a la vez', async () => {
    let resolver: (v: any) => void = () => {};
    media.pending.mockReturnValue(new Promise((r) => { resolver = r; }));

    const primero = fetch.sweep();
    const segundo = await fetch.sweep();

    expect(segundo.omitido).toBe(true);
    resolver([]);
    await primero;
  });
});

describe('qué ve el modelo de un archivo', () => {
  /**
   * Antes se filtraban los mensajes sin texto, así que mandar una foto sin pie
   * equivalía a no escribir: la IA no respondía nada.
   */
  it('un mensaje solo con archivo se convierte en un aviso, no se pierde', () => {
    expect(describeForPrompt({ type: 'IMAGE', direction: 'INBOUND' }))
      .toBe('[El prospecto envió una imagen]');
    expect(describeForPrompt({ type: 'VOICE', direction: 'INBOUND' }))
      .toBe('[El prospecto envió una nota de voz]');
  });

  it('con pie de foto conserva el texto y añade el aviso', () => {
    expect(describeForPrompt({ type: 'IMAGE', direction: 'INBOUND', text: '¿Como esta?' }))
      .toBe('¿Como esta?\n[El prospecto adjuntó una imagen]');
  });

  it('un mensaje de texto no se toca', () => {
    expect(describeForPrompt({ type: 'TEXT', direction: 'INBOUND', text: 'Hola' })).toBe('Hola');
  });

  it('el aviso nunca describe el contenido del archivo', () => {
    const aviso = describeForPrompt({ type: 'DOCUMENT', direction: 'INBOUND' });
    expect(aviso).toBe('[El prospecto envió un documento]');
  });
});
