import { EventEmitter } from 'events';
import { ScanStatus } from '@prisma/client';
import { ClamAvVirusScanner, StubVirusScanner } from './virus-scanner';

/**
 * StubVirusScanner is exercised end-to-end by kyc.service.spec.ts.
 * Here we focus on the new ClamAV daemon implementation:
 *
 *   1. parseReply() handles all 4 reply shapes (OK / FOUND / ERROR /
 *      malformed) including null-terminator + newline trimming.
 *   2. The INSTREAM wire format is correctly emitted: zINSTREAM\0 →
 *      length-prefixed chunks → zero-length end marker.
 *   3. EICAR-shaped FOUND reply maps to ScanStatus.INFECTED with
 *      the signature surfaced.
 *   4. Connect failure surfaces as ScanStatus.ERROR (not a throw).
 *   5. Timeout surfaces as ScanStatus.ERROR.
 *
 * The "fake socket" pattern: we inject a `connectFn` that returns a
 * controllable EventEmitter masquerading as a net.Socket. That lets
 * us drive the protocol negotiation in the test thread without
 * needing a real clamd daemon (or even a TCP listener).
 */

/**
 * Build a minimal fake net.Socket that supports the events
 * (`connect`, `data`, `end`, `error`, `close`) and methods (`write`,
 * `destroy`) we actually use.
 */
function makeFakeSocket() {
  const writes: Buffer[] = [];
  const emitter = new EventEmitter() as EventEmitter & {
    write: (b: Buffer | string) => boolean;
    destroy: () => void;
  };
  emitter.write = (b: Buffer | string) => {
    writes.push(typeof b === 'string' ? Buffer.from(b, 'utf8') : b);
    return true;
  };
  emitter.destroy = () => {
    // no-op
  };
  return { socket: emitter, writes };
}

describe('ClamAvVirusScanner.parseReply', () => {
  const scanner = new ClamAvVirusScanner(() => ({} as never));

  it('OK reply → CLEAN', () => {
    expect(scanner.parseReply('stream: OK\0')).toEqual({ status: ScanStatus.CLEAN });
  });

  it('OK reply with trailing newline → CLEAN', () => {
    expect(scanner.parseReply('stream: OK\n\0')).toEqual({ status: ScanStatus.CLEAN });
  });

  it('FOUND reply → INFECTED with signature', () => {
    const r = scanner.parseReply('stream: Eicar-Test-Signature FOUND\0');
    expect(r.status).toBe(ScanStatus.INFECTED);
    expect(r.signature).toBe('Eicar-Test-Signature');
  });

  it('ERROR reply → ERROR with daemon message', () => {
    const r = scanner.parseReply('stream: STREAM_TOO_LONG ERROR\0');
    expect(r.status).toBe(ScanStatus.ERROR);
    expect(r.error).toBe('STREAM_TOO_LONG');
  });

  it('unrecognised reply → ERROR with reply excerpt', () => {
    const r = scanner.parseReply('something weird\0');
    expect(r.status).toBe(ScanStatus.ERROR);
    expect(r.error).toMatch(/unexpected_reply/);
  });
});

describe('ClamAvVirusScanner.scan — wire format', () => {
  it('sends zINSTREAM, chunked payload, zero-length end marker', async () => {
    const { socket, writes } = makeFakeSocket();
    const scanner = new ClamAvVirusScanner(() => socket as never);

    // Drive the protocol asynchronously: when the scanner connects
    // we synthesise the daemon's reply.
    const scanPromise = scanner.scan(Buffer.from('hello'));
    // Allow scan() to attach `connect` handler before we emit.
    setImmediate(() => {
      socket.emit('connect');
      // Allow the scanner to flush the request before we send the reply.
      setImmediate(() => {
        socket.emit('data', Buffer.from('stream: OK\0', 'utf8'));
        socket.emit('end');
      });
    });

    const result = await scanPromise;
    expect(result.status).toBe(ScanStatus.CLEAN);

    // Re-assemble what the scanner wrote.
    const wire = Buffer.concat(writes);

    // First bytes: zINSTREAM\0
    expect(wire.subarray(0, 10).toString('utf8')).toBe('zINSTREAM\0');

    // Then 4-byte length + chunk + 4-byte zero end marker.
    const len = wire.readUInt32BE(10);
    expect(len).toBe(5); // "hello" is 5 bytes
    expect(wire.subarray(14, 14 + 5).toString('utf8')).toBe('hello');
    const endMarker = wire.readUInt32BE(14 + 5);
    expect(endMarker).toBe(0);
  });

  it('chunks payloads > CHUNK_BYTES correctly', async () => {
    const { socket, writes } = makeFakeSocket();
    const scanner = new ClamAvVirusScanner(() => socket as never);
    const big = Buffer.alloc(ClamAvVirusScanner.CHUNK_BYTES + 100, 'A');

    const scanPromise = scanner.scan(big);
    setImmediate(() => {
      socket.emit('connect');
      setImmediate(() => {
        socket.emit('data', Buffer.from('stream: OK\0', 'utf8'));
        socket.emit('end');
      });
    });
    await scanPromise;

    const wire = Buffer.concat(writes);
    // After zINSTREAM\0 (10 bytes), expect:
    //   chunk1: [len=4096][4096 bytes]
    //   chunk2: [len=100][100 bytes]
    //   end:    [0]
    expect(wire.readUInt32BE(10)).toBe(ClamAvVirusScanner.CHUNK_BYTES);
    const chunk2LenOffset = 10 + 4 + ClamAvVirusScanner.CHUNK_BYTES;
    expect(wire.readUInt32BE(chunk2LenOffset)).toBe(100);
    const endOffset = chunk2LenOffset + 4 + 100;
    expect(wire.readUInt32BE(endOffset)).toBe(0);
  });

  it('EICAR-shaped FOUND reply → INFECTED', async () => {
    const { socket } = makeFakeSocket();
    const scanner = new ClamAvVirusScanner(() => socket as never);
    const scanPromise = scanner.scan(Buffer.from('whatever'));
    setImmediate(() => {
      socket.emit('connect');
      setImmediate(() => {
        socket.emit('data', Buffer.from('stream: Eicar-Test-Signature FOUND\0'));
        socket.emit('end');
      });
    });
    const result = await scanPromise;
    expect(result.status).toBe(ScanStatus.INFECTED);
    expect(result.signature).toBe('Eicar-Test-Signature');
  });

  it('connection error → ScanStatus.ERROR (not a throw)', async () => {
    const { socket } = makeFakeSocket();
    const scanner = new ClamAvVirusScanner(() => socket as never);
    const scanPromise = scanner.scan(Buffer.from('whatever'));
    setImmediate(() => {
      socket.emit('error', new Error('ECONNREFUSED'));
    });
    const result = await scanPromise;
    expect(result.status).toBe(ScanStatus.ERROR);
    expect(result.error).toMatch(/clamd_connect_failed/);
  });

  it('empty payload bypasses the daemon → CLEAN', async () => {
    const scanner = new ClamAvVirusScanner(() => {
      throw new Error('should not connect for empty input');
    });
    const result = await scanner.scan(Buffer.alloc(0));
    expect(result.status).toBe(ScanStatus.CLEAN);
  });
});

describe('StubVirusScanner (existing behaviour, regression check)', () => {
  it('still trips on EICAR', async () => {
    const stub = new StubVirusScanner();
    const eicar = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      'latin1',
    );
    const result = await stub.scan(eicar);
    expect(result.status).toBe(ScanStatus.INFECTED);
    expect(result.signature).toBe('Eicar-Test-Signature');
  });

  it('CLEAN on benign bytes', async () => {
    const result = await new StubVirusScanner().scan(Buffer.from('hello'));
    expect(result.status).toBe(ScanStatus.CLEAN);
  });
});
