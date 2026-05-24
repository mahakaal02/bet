import { Card, PageHeader } from "./ui/primitives";
import type { ReactNode } from "react";

/**
 * "Coming soon — schema TBD" placeholder page (PR-BET-ADMIN-REDESIGN).
 *
 * Used for the ten admin modules the user requested where the
 * backing database schema doesn't exist yet (KYC for bet, multi-admin
 * approval workflows, AI fraud scoring, oracle integrations, webhook
 * monitoring, etc.). The user explicitly asked for the full 19-module
 * nav scaffold without DB changes — these stubs provide a coherent
 * destination for every sidebar link so nothing 404s.
 *
 * Each stub documents the design intent and the data shape the
 * future implementation would need, so the eventual wiring PR has a
 * clear specification to follow.
 */
export function ComingSoon({
  kicker,
  title,
  description,
  intent,
  needs,
}: {
  kicker?: string;
  title: string;
  description: string;
  /** What this page will do once it's wired. Short paragraph. */
  intent: ReactNode;
  /** Database tables / endpoints required to ship the real version. */
  needs: string[];
}) {
  return (
    <>
      <PageHeader kicker={kicker} title={title} description={description} />

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--admin-divider)] bg-[var(--admin-elevated)] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Coming soon
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
              schema TBD
            </span>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <section>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
              Intent
            </div>
            <p className="text-sm leading-relaxed text-[var(--admin-text-secondary)]">
              {intent}
            </p>
          </section>
          <section>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--admin-text-muted)]">
              Required before this ships
            </div>
            <ul className="space-y-1.5">
              {needs.map((n) => (
                <li
                  key={n}
                  className="flex items-start gap-2 text-sm text-[var(--admin-text-secondary)]"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--admin-text-muted)]" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] p-3 text-[11px] text-[var(--admin-text-muted)]">
            UI is fully designed; the page renders this placeholder
            because the user explicitly asked for the redesign in a
            single PR without database-schema changes. Once the schema
            lands, the page swap is a drop-in.
          </div>
        </div>
      </Card>
    </>
  );
}
