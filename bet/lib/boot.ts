/**
 * One-time server-side boot hook. Next.js doesn't have a "startup" entry
 * point per se — importing this from the root layout (a server component)
 * runs it once per process on the first request. Subsequent imports are
 * no-ops thanks to the `globalThis` guard inside startScheduler.
 */
import { startScheduler } from "@/lib/scheduler";
import { installGlobalHandlers } from "@/lib/logger";

installGlobalHandlers();
startScheduler();

export {};
