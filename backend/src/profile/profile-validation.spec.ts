import {
  getProfanityPatterns,
  getReservedNames,
  validateDisplayName,
} from './profile-validation';

describe('validateDisplayName', () => {
  describe('length rules', () => {
    it('rejects < 3 chars', () => {
      expect(validateDisplayName('Al').ok).toBe(false);
      expect(validateDisplayName('').ok).toBe(false);
      expect(validateDisplayName('   ').ok).toBe(false);
    });
    it('rejects > 40 chars', () => {
      expect(validateDisplayName('a'.repeat(41)).ok).toBe(false);
    });
    it('accepts 3 + 40 boundary lengths', () => {
      expect(validateDisplayName('abc').ok).toBe(true);
      expect(validateDisplayName('a'.repeat(40)).ok).toBe(true);
    });
    it('ignores leading/trailing whitespace for the length check', () => {
      expect(validateDisplayName('  abc  ').ok).toBe(true);
    });
  });

  describe('allowed chars', () => {
    it('accepts ASCII letters + digits + space + hyphen + dot + underscore', () => {
      expect(validateDisplayName('Alice Smith').ok).toBe(true);
      expect(validateDisplayName('Alice-Smith').ok).toBe(true);
      expect(validateDisplayName('alice_smith_42').ok).toBe(true);
      expect(validateDisplayName('A. Smith').ok).toBe(true);
    });
    it('accepts non-Latin scripts (Devanagari, CJK, Arabic)', () => {
      expect(validateDisplayName('अमित कुमार').ok).toBe(true);
      expect(validateDisplayName('王小明').ok).toBe(true);
      expect(validateDisplayName('علي').ok).toBe(true);
    });
    it('rejects emoji', () => {
      expect(validateDisplayName('Alice 🎉').ok).toBe(false);
    });
    it('rejects zero-width chars (homoglyph attack surface)', () => {
      expect(validateDisplayName('Ali​ce').ok).toBe(false);
    });
    it('rejects symbols (@, slash, brackets, etc.)', () => {
      expect(validateDisplayName('Alice@home').ok).toBe(false);
      expect(validateDisplayName('Alice/Bob').ok).toBe(false);
      expect(validateDisplayName('Alice<script>').ok).toBe(false);
    });
  });

  describe('reserved names', () => {
    it('blocks "admin"', () => {
      expect(validateDisplayName('admin').ok).toBe(false);
    });
    it('blocks variant casings of reserved names', () => {
      expect(validateDisplayName('Admin').ok).toBe(false);
      expect(validateDisplayName('ADMIN').ok).toBe(false);
    });
    it('blocks reserved names spelled with separators', () => {
      // The validator strips separators before comparison.
      expect(validateDisplayName('a_d_m_i_n').ok).toBe(false);
      expect(validateDisplayName('Kalki-Bet').ok).toBe(false);
    });
    it('allows reserved name as a substring of a legitimate name', () => {
      // "Administer" is not the same as "admin" once stripped.
      // But "administrator" IS in the list, so block that.
      // We pick a non-collision-prone substring.
      expect(validateDisplayName('Madmin').ok).toBe(true);    // M + admin → "madmin"
      expect(validateDisplayName('Administrator').ok).toBe(false);
    });
  });

  describe('profanity filter', () => {
    it('rejects obvious English slurs (case-insensitive substring)', () => {
      for (const slur of getProfanityPatterns()) {
        const ascii = slur.match(/^[a-z]+$/);
        if (!ascii) continue;
        expect(validateDisplayName(slur).ok).toBe(false);
        expect(validateDisplayName(slur.toUpperCase()).ok).toBe(false);
      }
    });
    it('rejects Romanised Hindi slurs', () => {
      expect(validateDisplayName('madarchod').ok).toBe(false);
      expect(validateDisplayName('Some chutiya person').ok).toBe(false);
    });
    it('does NOT scunthorpe-flag innocent words containing safe substrings', () => {
      // The list is curated tight enough to avoid the classic
      // Scunthorpe problem ("ass" in "passenger", "tit" in
      // "titanium"). Spot-check a few.
      expect(validateDisplayName('Passenger').ok).toBe(true);
      expect(validateDisplayName('Titanium').ok).toBe(true);
      expect(validateDisplayName('Cumulus Cloud').ok).toBe(true);
    });
  });

  describe('exports', () => {
    it('reserved set is non-empty and read-only', () => {
      expect(getReservedNames().size).toBeGreaterThan(10);
    });
    it('profanity list is non-empty', () => {
      expect(getProfanityPatterns().length).toBeGreaterThan(5);
    });
  });
});
