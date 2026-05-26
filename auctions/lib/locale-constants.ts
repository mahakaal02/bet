/**
 * Constants shared between the server-side `lib/locale-detect.ts`
 * (which uses `next/headers`) and the client-side `LoginLanding`
 * component (which can't pull in `next/headers`). Keep this file
 * dependency-free so both sides can import it without bundler /
 * server-component boundary issues.
 */

/** Cookie key for the user-chosen locale (persists across visits). */
export const LOCALE_COOKIE = "kalki_locale";

/** 1 year, matches the bet/auctions language preference convention. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
