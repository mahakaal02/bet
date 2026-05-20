/**
 * Display-name + reserved-name + profanity validation (Roadmap §F-USER-5).
 *
 * Pure helpers, exported individually so the service can compose them
 * and the tests can verify each rule in isolation.
 *
 * Profanity filter scope: a small static list of English + Hindi
 * top-tier slurs that nobody legitimately wants in their display
 * name. NOT exhaustive — the goal is "obvious-bad-words blocked at
 * write time"; PROFILE-2 ships the admin moderation queue that
 * catches the long tail.
 *
 * The reserved list protects role/system identifiers (admin, support,
 * official, kalki, etc.) so users can't impersonate the platform or
 * its staff.
 */

const RESERVED_NAMES = new Set([
  'admin',
  'administrator',
  'kalki',
  'kalkibet',
  'kalkiauctions',
  'kalki-bet',
  'kalki-auctions',
  'support',
  'system',
  'root',
  'official',
  'staff',
  'moderator',
  'mod',
  'help',
  'helpdesk',
  'team',
  'ringmaster',                                  // sentinel user used for NO_WINNER auctions
  'auction',
  'auctions',
  'aviator',
  'bet',
  'security',
  'finance',
  'auditor',
  'undefined',
  'null',
]);

/**
 * Light-touch profanity list. Lowercase substring match — any name
 * containing one of these is rejected. Intentionally tiny: false
 * positives are unforgivable (e.g. "Scunthorpe problem"), and the
 * PROFILE-2 moderation queue will catch the words this misses.
 *
 * Each entry below is intentionally a single, unambiguous slur. We
 * skip common English-with-substring-collision words like "ass"
 * (passenger), "tit" (titanium), "cum" (cumulative), etc. — those
 * are the moderation queue's problem.
 */
const PROFANITY_PATTERNS = [
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'cunt',
  'retard',
  'tranny',
  // Hindi script for two common slurs.
  'मादरचोद',
  'भोसडीके',
  // Romanised Hindi variants.
  'madarchod',
  'bhosadi',
  'chutiya',
];

export interface DisplayNameValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateDisplayName(input: string): DisplayNameValidationResult {
  const trimmed = (input ?? '').trim();

  if (trimmed.length < 3) {
    return { ok: false, reason: 'Display name must be at least 3 characters.' };
  }
  if (trimmed.length > 40) {
    return { ok: false, reason: 'Display name must be 40 characters or fewer.' };
  }

  // Letters (any script), digits, space, hyphen, underscore, dot.
  // Rejects emoji, control chars, zero-width / homoglyph attack chars.
  //   \p{L} = any unicode letter
  //   \p{M} = combining marks (vowel signs in Devanagari, Arabic
  //          diacritics, etc.) — without this, languages like Hindi
  //          fail to validate because their "letters" are letter +
  //          mark composites.
  //   \p{N} = any unicode digit
  const allowedPattern = /^[\p{L}\p{M}\p{N} _.\-]+$/u;
  if (!allowedPattern.test(trimmed)) {
    return {
      ok: false,
      reason:
        'Display name can only contain letters, numbers, spaces, hyphens, dots, and underscores.',
    };
  }

  // Collapse the name to a comparable form for the reserved + profanity
  // checks: lowercase, ASCII-fold for the most common confusables.
  const lower = trimmed.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9ऀ-ॿ]/g, '');

  if (RESERVED_NAMES.has(stripped)) {
    return {
      ok: false,
      reason:
        'That name is reserved. Pick something a real person might be called.',
    };
  }

  for (const bad of PROFANITY_PATTERNS) {
    if (lower.includes(bad)) {
      return {
        ok: false,
        reason: "That name isn't allowed. Try something else.",
      };
    }
  }

  return { ok: true };
}

/** Exposed for tests; ordering doesn't matter to callers. */
export function getReservedNames(): ReadonlySet<string> {
  return RESERVED_NAMES;
}
export function getProfanityPatterns(): readonly string[] {
  return PROFANITY_PATTERNS;
}
