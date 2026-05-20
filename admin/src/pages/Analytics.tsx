import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Admin analytics dashboard (PR-ANALYTICS-1).
 *
 * Two reports:
 *   - Funnel: signup → email → phone → KYC → deposit → bid
 *   - Cohort retention: by-signup-week × week-N-active grid
 *
 * No charting lib pulled in — we render conversion + retention with
 * plain HTML bars (background gradient + width%). Keeps the admin
 * bundle tiny and the dashboard fast.
 */

interface FunnelStep {
  key: string;
  label: string;
  count: number;
  ratioFromPrev: number;
}

interface FunnelReport {
  from: string;
  to: string;
  steps: FunnelStep[];
  overallConversion: number;
}

interface CohortRow {
  cohortWeekStart: string;
  totalUsers: number;
  retention: number[];
}

interface CohortReport {
  weeksBack: number;
  retentionWeeks: number;
  cohorts: CohortRow[];
}

export default function Analytics() {
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [cohort, setCohort] = useState<CohortReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, c] = await Promise.all([
        api.get<FunnelReport>('/admin/analytics/funnel'),
        api.get<CohortReport>('/admin/analytics/cohort-retention?weeksBack=8&retentionWeeks=4'),
      ]);
      setFunnel(f);
      setCohort(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-indigo-dark">Analytics</h1>
        <p className="mt-1 text-sm text-slate-600">User funnel + weekly cohort retention.</p>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {funnel && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Conversion funnel · {funnel.from.slice(0, 10)} → {funnel.to.slice(0, 10)}
          </h2>
          <div className="space-y-2">
            {funnel.steps.map((step, i) => (
              <FunnelBar key={step.key} step={step} firstStep={i === 0} maxCount={funnel.steps[0].count || 1} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Overall signup → first bid: <strong>{Math.round(funnel.overallConversion * 1000) / 10}%</strong>
          </p>
        </section>
      )}

      {cohort && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Weekly retention · {cohort.weeksBack} cohorts × {cohort.retentionWeeks} follow-up weeks
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Cohort week</th>
                  <th className="px-3 py-2 text-right">Signups</th>
                  {Array.from({ length: cohort.retentionWeeks }, (_, i) => (
                    <th key={i} className="px-3 py-2 text-right">W{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohort.cohorts.map((c) => (
                  <tr key={c.cohortWeekStart} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      {c.cohortWeekStart.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{c.totalUsers}</td>
                    {c.retention.map((r, i) => (
                      <td key={i} className="px-3 py-2 text-right font-mono text-xs">
                        <RetentionCell value={r} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function FunnelBar({ step, firstStep, maxCount }: { step: FunnelStep; firstStep: boolean; maxCount: number }) {
  const widthPct = (step.count / maxCount) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-700">{step.label}</span>
        <span className="font-mono text-slate-500">
          {step.count.toLocaleString('en-IN')}{firstStep ? '' : ` · ${Math.round(step.ratioFromPrev * 1000) / 10}%`}
        </span>
      </div>
      <div className="mt-1 h-3 w-full rounded bg-slate-100">
        <div className="h-3 rounded bg-brand-indigo" style={{ width: `${Math.max(2, widthPct)}%` }} />
      </div>
    </div>
  );
}

function RetentionCell({ value }: { value: number }) {
  const pct = Math.round(value * 1000) / 10;
  const intensity = Math.min(0.85, value * 1.1);
  return (
    <span
      className="inline-block min-w-[3em] rounded px-1.5 py-0.5"
      style={{ backgroundColor: `rgba(99, 102, 241, ${intensity})`, color: intensity > 0.4 ? 'white' : '#475569' }}
    >
      {pct}%
    </span>
  );
}
