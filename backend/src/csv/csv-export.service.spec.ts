import { csvEscape, csvRow, CsvExportService } from './csv-export.service';

describe('csvEscape', () => {
  it('passes plain strings through', () => {
    expect(csvEscape('hello')).toBe('hello');
  });
  it('handles numbers + booleans', () => {
    expect(csvEscape(123)).toBe('123');
    expect(csvEscape(true)).toBe('true');
  });
  it('null/undefined → empty', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
  it('quote-wraps when comma present', () => {
    expect(csvEscape('hello, world')).toBe('"hello, world"');
  });
  it('quote-wraps + doubles inner quotes', () => {
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });
  it('quote-wraps when newline present', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
  it('quote-wraps CR (Windows line ending)', () => {
    expect(csvEscape('line\rmore')).toBe('"line\rmore"');
  });
});

describe('csvRow', () => {
  it('comma-joins + CRLF terminates', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c\r\n');
  });
  it('escapes per-field', () => {
    expect(csvRow(['plain', 'with,comma', 'quoted"in', null])).toBe(
      'plain,"with,comma","quoted""in",\r\n',
    );
  });
});

describe('CsvExportService.exportAuditLog', () => {
  function makeMocks(auditRows: any[] = []) {
    const prisma: any = {
      adminAuditLog: {
        findMany: jest.fn(async ({ take, cursor, skip }: any) => {
          let pool = auditRows.slice();
          if (cursor) {
            const idx = pool.findIndex((r) => r.id === cursor.id);
            if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
          }
          return pool.slice(0, take);
        }),
      },
    };
    const audit = { record: jest.fn(async () => undefined) };
    return { svc: new CsvExportService(prisma, audit as any), prisma };
  }

  async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const line of gen) out.push(line);
    return out;
  }

  it('emits header row first', async () => {
    const { svc } = makeMocks();
    const lines = await collect(svc.exportAuditLog({}));
    expect(lines[0]).toBe('id,createdAt,actorId,actorEmail,action,targetType,targetId,ipAddress,userAgent,correlationId\r\n');
  });

  it('streams rows + terminates on empty page', async () => {
    const { svc } = makeMocks([
      {
        id: 'a-1', createdAt: new Date('2026-05-22T10:00:00Z'),
        actorId: 'admin-1', actorEmail: 'admin@kalki.test',
        action: 'audit.action.test', targetType: 'Auction', targetId: 't-1',
        ipAddress: null, userAgent: null, correlationId: null,
      },
    ]);
    const lines = await collect(svc.exportAuditLog({}));
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('admin@kalki.test');
    expect(lines[1]).toContain('audit.action.test');
  });

  it('cursor-paginates correctly across batches', async () => {
    const rows = Array.from({ length: CsvExportService.BATCH + 7 }, (_, i) => ({
      id: `a-${String(i).padStart(4, '0')}`,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
      actorId: 'admin-1', actorEmail: 'a@b.c', action: 'x',
      targetType: 'T', targetId: 'x',
      ipAddress: null, userAgent: null, correlationId: null,
    }));
    const { svc } = makeMocks(rows);
    const lines = await collect(svc.exportAuditLog({}));
    expect(lines.length).toBe(rows.length + 1); // header + all data
  });

  it('escapes comma-containing fields', async () => {
    const { svc } = makeMocks([
      {
        id: 'a-1', createdAt: new Date(),
        actorId: 'u-1', actorEmail: 'admin, bot@x.com',
        action: 'x', targetType: 'T', targetId: 't',
        ipAddress: null, userAgent: 'Mozilla/5.0 (Windows; X)', correlationId: null,
      },
    ]);
    const lines = await collect(svc.exportAuditLog({}));
    expect(lines[1]).toContain('"admin, bot@x.com"');
    // The plain UA string (no comma / quote / newline) stays unquoted.
    expect(lines[1]).toContain('Mozilla/5.0 (Windows; X)');
  });
});

describe('CsvExportService.exportCoinTransactions', () => {
  function makeMocks(rows: any[]) {
    const prisma: any = {
      coinTransaction: {
        findMany: jest.fn(async ({ take, cursor, skip }: any) => {
          let pool = rows.slice();
          if (cursor) {
            const idx = pool.findIndex((r) => r.id === cursor.id);
            if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
          }
          return pool.slice(0, take);
        }),
      },
    };
    return { svc: new CsvExportService(prisma, {} as any) };
  }

  it('emits ledger rows with sign on delta', async () => {
    const { svc } = makeMocks([
      { id: 'tx-1', createdAt: new Date('2026-05-22T10:00:00Z'), userId: 'u-1', delta: -100, reason: 'bid_cost', reference: 'b-1' },
      { id: 'tx-2', createdAt: new Date('2026-05-22T10:01:00Z'), userId: 'u-1', delta: 500, reason: 'admin_grant', reference: null },
    ]);
    const out: string[] = [];
    for await (const line of svc.exportCoinTransactions({})) out.push(line);
    expect(out[1]).toContain('-100');
    expect(out[2]).toContain('500');
    expect(out[2]).toContain('admin_grant');
  });
});

describe('CsvExportService.exportOrders', () => {
  function makeMocks(rows: any[]) {
    const prisma: any = {
      order: {
        findMany: jest.fn(async ({ take, cursor, skip }: any) => {
          let pool = rows.slice();
          if (cursor) {
            const idx = pool.findIndex((r) => r.id === cursor.id);
            if (idx >= 0) pool = pool.slice(idx + (skip ?? 0));
          }
          return pool.slice(0, take);
        }),
      },
    };
    return { svc: new CsvExportService(prisma, {} as any) };
  }

  it('emits order columns including null tracking gracefully', async () => {
    const { svc } = makeMocks([
      {
        id: 'o-1', createdAt: new Date('2026-05-22'), updatedAt: new Date('2026-05-22'),
        auctionId: 'a-1', winnerId: 'u-1', status: 'PENDING_ADDRESS',
        carrierName: null, trackingNumber: null,
        shippedAt: null, deliveredAt: null, disputedAt: null,
      },
    ]);
    const out: string[] = [];
    for await (const line of svc.exportOrders({})) out.push(line);
    expect(out[1]).toContain('PENDING_ADDRESS');
    expect(out[1].split(',').filter((s) => s === '').length).toBeGreaterThan(0);
  });
});
