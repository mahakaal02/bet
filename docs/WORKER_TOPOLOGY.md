# Worker pod topology (PR-WORKER-EXTRACT)

**Status:** shipped 2026-05-23. Default OFF — flip `backend.worker.enabled=true` in `helm/kalki/values.yaml` to roll out.

---

## What changed

`backend/src/main.ts` now reads the `KALKI_ROLE` environment variable:

| `KALKI_ROLE` value | Behaviour | Used by |
|---|---|---|
| `api` (default) | Boots full HTTP server + WebSocket + every `@Cron` decorator | `kalki-backend` Deployment |
| `worker` | Boots the Nest application context (no HTTP listener) — `@Cron` jobs still fire | New `kalki-backend-worker` Deployment |

Both modes use the same container image — the only difference is the env var and the absence of port 4000 in the worker spec. This keeps the build / CD path identical.

When `backend.worker.enabled=true`, the api pod's `@Cron`s **still fire** — Nest doesn't know about the worker pod's existence. The whole point of the rollout dance below is to move those workloads off the api pod without leaving a gap.

---

## Cron jobs in scope

| `@Cron` decorator | Module | Cadence |
|---|---|---|
| `AuctionScheduler.promoteUpcoming` | `auctions/` | Every minute (UPCOMING → LIVE) |
| `AuctionScheduler.settleEnded` | `auctions/` | Every minute (LIVE → ENDED) |
| `NotificationWorker.drain` (worker registry) | `notifications/` | 1.5s polling (Postgres LISTEN-style) |
| `OutboxWorker.dispatch` | `foundation/` | 1.5s polling |
| `ReconciliationWorker.runNightly` | `reconciliation/` | 02:00 UTC daily |
| `FraudWorker.runNightly` | `fraud/` | 03:00 UTC daily |

The notification + outbox drainers are the high-cadence workloads. Moving them off the api pod is the main goal — they used to take ~30ms of event-loop time every 1.5s, which competed with HTTP request latency at p99.

---

## Rollout sequence (safe, two-phase)

### Phase 1 — Stand up the worker pod alongside the api

```yaml
# helm/kalki/values.yaml
backend:
  worker:
    enabled: true
    replicas: 1
```

Apply with `helm upgrade kalki ./helm/kalki -n kalki`. The api pod **continues** to run its own crons; the worker pod runs the same crons in parallel.

What's safe to double up:
- `NotificationWorker.drain` — Postgres `SELECT … FOR UPDATE SKIP LOCKED` on the queue. Two drainers split the workload row-by-row; no row is dispatched twice.
- `OutboxWorker.dispatch` — same SKIP LOCKED pattern on the outbox table.
- `ReconciliationWorker.runNightly` — `ReconciliationReport.forDate` is unique; the second pod's `create` throws P2002 and we treat it as already-existed.
- `FraudWorker.runNightly` — same dedup pattern (`fraudSignal.findFirst({ createdAt: { gte: windowStart } })` short-circuits the second pod).

What's **unsafe** to double up:
- `AuctionScheduler.promoteUpcoming` / `settleEnded` — these use `prisma.auction.updateMany` against status filters with no idempotency anchor. Two pods firing the same minute would settle each auction twice (most updates are no-ops, but the second pod's update writes the same `closedAt` again, which races on the winner-selection logic).

**Mitigation during Phase 1**: leave the api pod's auction scheduler running, and trust that the worker pod's auction scheduler will see the already-settled rows in its `where: { status: LIVE, endsAt: { lte: now } }` filter (empty result) by the time it runs. The race window is ~50ms; in practice no auction has been observed to settle twice. This is documented as Open Architecture Question 13 in CONTEXT.md.

### Phase 2 — Disable api-pod crons (PR-LEADER-ELECT or follow-up)

Once leader election is in place, the api pod's `ScheduleModule` is replaced with a no-op variant in api-mode, so crons run **only** on the worker. The worker pod can then safely scale to `replicas: 2` for HA.

This phase isn't shipped in this PR — `backend.worker.enabled=true` today gives parallel-run semantics, which is correct for everything except the auction scheduler edge case above.

---

## Local dev

```bash
# Default — same as before, single process runs HTTP + Cron.
npm run start:dev

# Worker mode — no HTTP server, only Cron jobs + drainers.
KALKI_ROLE=worker npm run start:dev
```

Both modes pick up the same `.env` and Prisma client.

---

## Observability

The worker pod logs every `@Cron` tick. Watch with:

```bash
kubectl logs -n kalki -l app.kubernetes.io/name=backend-worker -f --tail=200
```

Heartbeat: a 60s debug-level log line `worker heartbeat` keeps the event loop pinned. If you don't see it, the process has exited and Kubernetes will restart the pod automatically.

---

## Rollback

```yaml
backend:
  worker:
    enabled: false
```

The worker Deployment is deleted; api pod's `@Cron`s continue uninterrupted because they never stopped firing in the first place. Zero data-loss path.
