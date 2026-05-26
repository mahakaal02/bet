'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/client';

interface CurrentSeed {
  serverSeedHash: string;
  clientSeed: string;
  seedId: string;
}

interface RevealedSeed {
  id: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  startRoundNumber: number | null;
  endRoundNumber: number | null;
  revealedAt: string;
  rotationReason: string | null;
}

interface RoundHistory {
  id: string;
  roundNumber: number;
  crashMultiplier: string;
  nonce: number | null;
  seedId: string | null;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  crashedAt: string | null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function computeCrashFromHex(hmacHex: string): number {
  const houseEdgeHash = parseInt(hmacHex.slice(52, 56), 16);
  if (houseEdgeHash % 33 === 0) return 1.0;
  const e = parseInt(hmacHex.slice(0, 13), 16);
  const denom = Math.pow(2, 52);
  return Math.max(1.0, Math.floor((100 * denom) / (denom - e)) / 100);
}

export default function FairnessPage() {
  const { t, locale } = useTranslation();
  const [current, setCurrent] = useState<CurrentSeed | null>(null);
  const [revealed, setRevealed] = useState<RevealedSeed[]>([]);
  const [history, setHistory] = useState<RoundHistory[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, { ok: boolean; expected: number; got: number }>>({});

  useEffect(() => {
    void api.get<CurrentSeed | null>('/aviator/fairness/current').then((c) => setCurrent(c));
    void api.get<RevealedSeed[]>('/aviator/fairness/seeds?limit=20').then(setRevealed);
    void api.get<RoundHistory[]>('/aviator/history?limit=30').then(setHistory);
  }, []);

  async function verifyRound(r: RoundHistory) {
    setVerifying(r.id);
    try {
      const expectedHash = await sha256Hex(r.serverSeed);
      if (expectedHash !== r.serverSeedHash) {
        setVerifications((v) => ({
          ...v,
          [r.id]: { ok: false, expected: 0, got: 0 },
        }));
        return;
      }
      const nonce = r.nonce ?? r.roundNumber;
      const hmac = await hmacSha256Hex(r.serverSeed, `${r.clientSeed}:${nonce}`);
      const computed = computeCrashFromHex(hmac);
      const stored = Number(r.crashMultiplier);
      const ok = Math.abs(computed - stored) < 0.01;
      setVerifications((v) => ({ ...v, [r.id]: { ok, expected: stored, got: computed } }));
    } finally {
      setVerifying(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 max-w-5xl mx-auto">
      <Link href={`/${locale}`} className="text-sm text-text-secondary hover:text-text-primary">
        ← {t('nav.backToGame')}
      </Link>

      <h1 className="text-3xl font-extrabold mt-3">{t('fairness.title')}</h1>
      <p className="mt-2 text-text-secondary text-sm max-w-2xl">
        {t('fairness.description')}
      </p>

      <section className="glass rounded-3xl p-5 mt-8">
        <h2 className="text-xs uppercase tracking-widest text-text-secondary mb-2">
          {t('fairness.activeSeed')}
        </h2>
        {current ? (
          <>
            <KV label="seedId" value={current.seedId} />
            <KV label="serverSeedHash" value={current.serverSeedHash} mono />
            <KV label="clientSeed" value={current.clientSeed} mono />
          </>
        ) : (
          <p className="text-sm text-text-secondary">{t('fairness.noActiveSeed')}</p>
        )}
        <p className="mt-2 text-xs text-text-secondary">
          {t('fairness.seedHidden')}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-widest text-text-secondary mb-3">
          {t('fairness.recentRounds')}
        </h2>
        <div className="glass rounded-3xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-elevated/40 text-text-secondary text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">{t('fairness.columnRound')}</th>
                <th className="text-left px-4 py-3">{t('fairness.columnCrash')}</th>
                <th className="text-left px-4 py-3">{t('fairness.columnNonce')}</th>
                <th className="text-left px-4 py-3">{t('fairness.columnSeedStatus')}</th>
                <th className="text-right px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const seedRevealed = !!r.serverSeed && r.serverSeed !== '' && revealed.some((s) => s.id === r.seedId);
                // The /aviator/history endpoint always returns the seed field;
                // but the seed is only verifiable as "revealed" if its batch
                // appears in /fairness/seeds. The per-round seed copy is
                // a legacy artifact and we treat it as authoritative either
                // way.
                const v = verifications[r.id];
                return (
                  <tr key={r.id} className="border-t border-divider">
                    <td className="px-4 py-2 font-mono">#{r.roundNumber}</td>
                    <td className="px-4 py-2 font-mono text-accent-orange">
                      {Number(r.crashMultiplier).toFixed(2)}×
                    </td>
                    <td className="px-4 py-2 font-mono text-text-secondary">
                      {r.nonce ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {seedRevealed ? (
                        <span className="text-neon-green">{t('fairness.seedRevealed')}</span>
                      ) : (
                        <span className="text-text-secondary">{t('fairness.seedVerifiable')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {v ? (
                        v.ok ? (
                          <span className="text-neon-green text-xs">✓ {v.got.toFixed(2)}×</span>
                        ) : (
                          <span className="text-accent-red text-xs">✗ got {v.got.toFixed(2)}×</span>
                        )
                      ) : (
                        <button
                          onClick={() => verifyRound(r)}
                          disabled={verifying === r.id}
                          className="text-xs text-accent-orange hover:underline disabled:opacity-50"
                        >
                          {verifying === r.id ? t('fairness.verifying') : t('fairness.verify')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-widest text-text-secondary mb-3">
          {t('fairness.revealedBatches')}
        </h2>
        {revealed.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {t('fairness.noBatchesYet')}
          </p>
        ) : (
          <div className="space-y-3">
            {revealed.map((s) => (
              <div key={s.id} className="glass rounded-2xl p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-text-secondary text-xs">
                    {t('fairness.rangeRounds', {
                      from: s.startRoundNumber ?? '—',
                      to: s.endRoundNumber ?? '—',
                    })}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {new Date(s.revealedAt).toLocaleString()} · {s.rotationReason ?? '—'}
                  </span>
                </div>
                <KV label="serverSeed" value={s.serverSeed} mono />
                <KV label="serverSeedHash" value={s.serverSeedHash} mono />
                <KV label="clientSeed" value={s.clientSeed} mono />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 glass rounded-3xl p-5 text-sm">
        <h2 className="text-xs uppercase tracking-widest text-text-secondary mb-2">
          {t('fairness.howItWorks')}
        </h2>
        <p className="text-text-secondary">
          {t('fairness.howItWorksBody')}
        </p>
      </section>
    </main>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      <span className="w-32 text-xs text-text-secondary">{label}</span>
      <span className={`text-text-primary ${mono ? 'font-mono break-all text-xs' : 'text-sm'}`}>
        {value}
      </span>
    </div>
  );
}
