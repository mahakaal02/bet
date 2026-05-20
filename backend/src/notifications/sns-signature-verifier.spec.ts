import { createSign, generateKeyPairSync, X509Certificate } from 'crypto';
import {
  SnsSignatureVerifier,
  SignedSnsEnvelope,
  isValidSigningCertUrl,
  buildStringToSign,
} from './sns-signature-verifier';

/**
 * Strategy: stand up a self-signed RSA certificate in-process, use
 * its private key to produce a real SNS-shape signature, and feed
 * the verifier its public cert via an injected fetch mock. That
 * lets us prove end-to-end:
 *
 *   1. A well-formed signature for each envelope shape verifies.
 *   2. A flipped byte anywhere in the canonical fields trips
 *      `signature_mismatch`.
 *   3. An attacker-controlled `SigningCertURL` is rejected before
 *      any network call.
 *   4. The cert is fetched once per URL (cache works).
 *   5. Both SignatureVersion 1 (SHA1) + 2 (SHA256) work.
 *
 * The cert generation uses Node's built-in crypto — no fixture
 * files to maintain.
 */

/**
 * Generate a 2048-bit RSA keypair + a self-signed cert. Returns:
 *   - `pem`         — the PEM-encoded cert (what SNS hosts)
 *   - `signPayload` — fn that signs an arbitrary string-to-sign
 *                     with the matching private key, returning the
 *                     base64 signature in either RSA-SHA1 or
 *                     RSA-SHA256.
 */
function makeFakeSnsCert(): {
  pem: string;
  signPayload: (s: string, algo: 'RSA-SHA1' | 'RSA-SHA256') => string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Build a real cert PEM is awkward without `openssl` or `node-
  // forge`. Node's `crypto.createVerify().verify(pem, sig)` accepts
  // BOTH a full X.509 certificate PEM AND a bare public-key PEM —
  // they both contain the same RSA public bytes used for verifying
  // a signature. We emit the public key directly; the verifier's
  // sanity check is relaxed to accept either header form.
  const pem = publicKey.export({ format: 'pem', type: 'spki' }) as string;

  return {
    pem,
    signPayload: (s, algo) => {
      const signer = createSign(algo);
      signer.update(s, 'utf8');
      return signer.sign(privateKey).toString('base64');
    },
  };
}

/**
 * Wrap the fake cert into a fetchImpl. Returns the impl + a `calls`
 * counter so tests can assert cache behaviour.
 */
function makeFakeFetch(pem: string): {
  fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0];
  calls: number;
} {
  let calls = 0;
  const fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0] = async () => {
    calls += 1;
    return {
      ok: true, status: 200,
      async text() { return pem; },
    };
  };
  return {
    fetchImpl,
    // Live counter — wrapped in a getter so tests see the latest value.
    get calls() { return calls; },
  } as { fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0]; calls: number };
}

describe('SnsSignatureVerifier — happy paths', () => {
  let cert: ReturnType<typeof makeFakeSnsCert>;

  beforeAll(() => {
    cert = makeFakeSnsCert();
  });

  it('verifies a SignatureVersion=1 Notification envelope', async () => {
    const env: SignedSnsEnvelope = {
      Type: 'Notification',
      MessageId: 'msg-1',
      TopicArn: 'arn:aws:sns:us-east-1:1234:test',
      Message: JSON.stringify({ hello: 'world' }),
      Subject: 'Some subject',
      Timestamp: '2026-05-20T11:00:00.000Z',
      Signature: '', // filled below
      SignatureVersion: '1',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/ABCDEF.pem',
    };
    env.Signature = cert.signPayload(buildStringToSign(env), 'RSA-SHA1');

    const fake = makeFakeFetch(cert.pem);
    const verifier = new SnsSignatureVerifier(fake.fetchImpl);
    const result = await verifier.verify(env);
    expect(result).toEqual({ valid: true });
  });

  it('verifies a SignatureVersion=2 Notification envelope', async () => {
    const env: SignedSnsEnvelope = {
      Type: 'Notification',
      MessageId: 'msg-2',
      TopicArn: 'arn:aws:sns:ap-south-1:1234:bounce',
      Message: JSON.stringify({ notificationType: 'Bounce' }),
      Timestamp: '2026-05-20T11:00:00.000Z',
      Signature: '',
      SignatureVersion: '2',
      SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/ABCDEF.pem',
    };
    env.Signature = cert.signPayload(buildStringToSign(env), 'RSA-SHA256');

    const fake = makeFakeFetch(cert.pem);
    const verifier = new SnsSignatureVerifier(fake.fetchImpl);
    const result = await verifier.verify(env);
    expect(result).toEqual({ valid: true });
  });

  it('verifies a SubscriptionConfirmation envelope', async () => {
    const env: SignedSnsEnvelope = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-3',
      TopicArn: 'arn:aws:sns:ap-south-1:1234:bounce',
      Message: 'You have chosen to subscribe…',
      Timestamp: '2026-05-20T11:00:00.000Z',
      Token: 'abcdef1234',
      SubscribeURL:
        'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:ap-south-1:1234:bounce&Token=abcdef1234',
      Signature: '',
      SignatureVersion: '1',
      SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/ABCDEF.pem',
    };
    env.Signature = cert.signPayload(buildStringToSign(env), 'RSA-SHA1');

    const fake = makeFakeFetch(cert.pem);
    const verifier = new SnsSignatureVerifier(fake.fetchImpl);
    const result = await verifier.verify(env);
    expect(result).toEqual({ valid: true });
  });

  it('caches the cert (one fetch across multiple envelopes from same URL)', async () => {
    let fetchCount = 0;
    const fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0] = async () => {
      fetchCount += 1;
      return { ok: true, status: 200, async text() { return cert.pem; } };
    };
    const verifier = new SnsSignatureVerifier(fetchImpl);

    const makeEnv = (id: string): SignedSnsEnvelope => {
      const env: SignedSnsEnvelope = {
        Type: 'Notification',
        MessageId: id,
        TopicArn: 'arn:aws:sns:us-east-1:1234:test',
        Message: 'msg ' + id,
        Timestamp: '2026-05-20T11:00:00.000Z',
        Signature: '',
        SignatureVersion: '1',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/ABCDEF.pem',
      };
      env.Signature = cert.signPayload(buildStringToSign(env), 'RSA-SHA1');
      return env;
    };

    await verifier.verify(makeEnv('a'));
    await verifier.verify(makeEnv('b'));
    await verifier.verify(makeEnv('c'));
    expect(fetchCount).toBe(1);
  });
});

describe('SnsSignatureVerifier — rejection paths', () => {
  let cert: ReturnType<typeof makeFakeSnsCert>;

  beforeAll(() => {
    cert = makeFakeSnsCert();
  });

  function makeSignedEnv(): SignedSnsEnvelope {
    const env: SignedSnsEnvelope = {
      Type: 'Notification',
      MessageId: 'msg-x',
      TopicArn: 'arn:aws:sns:us-east-1:1234:test',
      Message: 'real-message',
      Timestamp: '2026-05-20T11:00:00.000Z',
      Signature: '',
      SignatureVersion: '1',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/ABCDEF.pem',
    };
    env.Signature = cert.signPayload(buildStringToSign(env), 'RSA-SHA1');
    return env;
  }

  it('rejects unsupported SignatureVersion', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = { ...makeSignedEnv(), SignatureVersion: '99' as '1' };
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'unsupported_signature_version',
    });
  });

  it('rejects http (non-https) cert URL', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = {
      ...makeSignedEnv(),
      SigningCertURL: 'http://sns.us-east-1.amazonaws.com/ABCDEF.pem',
    };
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'invalid_signing_cert_url',
    });
  });

  it('rejects non-amazonaws.com cert URL', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = {
      ...makeSignedEnv(),
      SigningCertURL: 'https://attacker.example.com/ABCDEF.pem',
    };
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'invalid_signing_cert_url',
    });
  });

  it('rejects non-.pem cert URL', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = {
      ...makeSignedEnv(),
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/ABCDEF.txt',
    };
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'invalid_signing_cert_url',
    });
  });

  it('does NOT fetch when cert URL is invalid', async () => {
    let fetchCount = 0;
    const fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0] = async () => {
      fetchCount += 1;
      return { ok: true, status: 200, async text() { return cert.pem; } };
    };
    const verifier = new SnsSignatureVerifier(fetchImpl);
    const env = {
      ...makeSignedEnv(),
      SigningCertURL: 'https://attacker.example.com/x.pem',
    };
    await verifier.verify(env);
    expect(fetchCount).toBe(0); // fast-fail before network
  });

  it('rejects when the cert URL returns 404', async () => {
    const fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0] = async () => ({
      ok: false, status: 404, async text() { return 'not found'; },
    });
    const verifier = new SnsSignatureVerifier(fetchImpl);
    expect(await verifier.verify(makeSignedEnv())).toEqual({
      valid: false, reason: 'cert_fetch_failed',
    });
  });

  it('rejects when the cert URL returns non-PEM body', async () => {
    const fetchImpl: ConstructorParameters<typeof SnsSignatureVerifier>[0] = async () => ({
      ok: true, status: 200, async text() { return 'just plain text'; },
    });
    const verifier = new SnsSignatureVerifier(fetchImpl);
    expect(await verifier.verify(makeSignedEnv())).toEqual({
      valid: false, reason: 'cert_fetch_failed',
    });
  });

  it('rejects an envelope where the Message was tampered', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = makeSignedEnv();
    env.Message = 'attacker-injected-message';
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'signature_mismatch',
    });
  });

  it('rejects an envelope where the Timestamp was tampered', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = makeSignedEnv();
    env.Timestamp = '2099-01-01T00:00:00.000Z';
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'signature_mismatch',
    });
  });

  it('rejects an envelope where the TopicArn was tampered', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = makeSignedEnv();
    env.TopicArn = 'arn:aws:sns:us-east-1:9999:attacker';
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'signature_mismatch',
    });
  });

  it('rejects an empty signature', async () => {
    const verifier = new SnsSignatureVerifier(makeFakeFetch(cert.pem).fetchImpl);
    const env = { ...makeSignedEnv(), Signature: '' };
    expect(await verifier.verify(env)).toEqual({
      valid: false, reason: 'malformed_signature',
    });
  });
});

describe('isValidSigningCertUrl', () => {
  it.each([
    ['https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem', true],
    ['https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-x.pem', true],
    // Non-https
    ['http://sns.us-east-1.amazonaws.com/x.pem', false],
    // Non-amazonaws domain
    ['https://sns.example.com/x.pem', false],
    // Non-.pem extension
    ['https://sns.us-east-1.amazonaws.com/x.crt', false],
    // Empty
    ['', false],
    // Malformed
    ['not a url', false],
    // Subdomain trick that doesn't match the suffix check
    ['https://sns.us-east-1.amazonaws.com.attacker.com/x.pem', false],
  ])('isValidSigningCertUrl(%j) → %j', (url, expected) => {
    expect(isValidSigningCertUrl(url)).toBe(expected);
  });
});

describe('buildStringToSign', () => {
  it('omits Subject when undefined', () => {
    const env: SignedSnsEnvelope = {
      Type: 'Notification',
      MessageId: 'x',
      TopicArn: 'arn:aws:sns:test',
      Message: 'hi',
      Timestamp: '2026-05-20T11:00:00.000Z',
      Signature: '', SignatureVersion: '1',
      SigningCertURL: 'https://sns.x.amazonaws.com/y.pem',
    };
    const out = buildStringToSign(env);
    expect(out).not.toContain('Subject');
    expect(out).toBe(
      'Message\nhi\nMessageId\nx\nTimestamp\n2026-05-20T11:00:00.000Z\nTopicArn\narn:aws:sns:test\nType\nNotification\n',
    );
  });

  it('includes Subject when set', () => {
    const env: SignedSnsEnvelope = {
      Type: 'Notification',
      MessageId: 'x',
      TopicArn: 'arn:aws:sns:test',
      Message: 'hi',
      Subject: 'subj',
      Timestamp: '2026-05-20T11:00:00.000Z',
      Signature: '', SignatureVersion: '1',
      SigningCertURL: 'https://sns.x.amazonaws.com/y.pem',
    };
    const out = buildStringToSign(env);
    // Alphabetical: Subject between MessageId and Timestamp
    expect(out).toBe(
      'Message\nhi\nMessageId\nx\nSubject\nsubj\nTimestamp\n2026-05-20T11:00:00.000Z\nTopicArn\narn:aws:sns:test\nType\nNotification\n',
    );
  });

  it('uses the subscription-confirmation field set', () => {
    const env: SignedSnsEnvelope = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'x',
      TopicArn: 'arn:aws:sns:test',
      Message: 'You have chosen to subscribe…',
      Timestamp: '2026-05-20T11:00:00.000Z',
      Token: 'tok',
      SubscribeURL: 'https://sns.test/confirm?token=tok',
      Signature: '', SignatureVersion: '1',
      SigningCertURL: 'https://sns.x.amazonaws.com/y.pem',
    };
    const out = buildStringToSign(env);
    expect(out).toBe(
      'Message\nYou have chosen to subscribe…\n' +
      'MessageId\nx\n' +
      'SubscribeURL\nhttps://sns.test/confirm?token=tok\n' +
      'Timestamp\n2026-05-20T11:00:00.000Z\n' +
      'Token\ntok\n' +
      'TopicArn\narn:aws:sns:test\n' +
      'Type\nSubscriptionConfirmation\n',
    );
  });

  it('throws for unsupported envelope types', () => {
    expect(() =>
      buildStringToSign({
        Type: 'UnknownThing' as 'Notification',
        MessageId: 'x',
        TopicArn: 'arn:aws:sns:test',
        Message: 'hi',
        Timestamp: '2026-05-20T11:00:00.000Z',
        Signature: '', SignatureVersion: '1',
        SigningCertURL: 'https://sns.x.amazonaws.com/y.pem',
      }),
    ).toThrow(/unsupported envelope type/);
  });
});

// Sanity check: ensure the public-key PEM the fake helper emits is
// in the shape Node's verify() consumes. The verifier's relaxed
// PEM-or-cert check is what makes the test path work without an
// X.509 issuer.
describe('test cert PEM sanity', () => {
  it('the fake helper emits a valid public-key PEM', () => {
    const cert = makeFakeSnsCert();
    expect(cert.pem).toContain('BEGIN PUBLIC KEY');
    expect(cert.pem).toContain('END PUBLIC KEY');
    // X509Certificate constructor exists in Node 15+ — sanity check
    // the runtime supports the API we'd use against real SNS certs.
    expect(typeof X509Certificate).toBe('function');
  });
});
