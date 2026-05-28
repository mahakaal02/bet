import { CountryDetectionService } from './country-detection.service';

describe('CountryDetectionService', () => {
  const svc = new CountryDetectionService();

  describe('parseAcceptLanguage', () => {
    it('prefers the region subtag', () => {
      expect(svc.parseAcceptLanguage('pt-BR,pt;q=0.9,en;q=0.5')).toBe('BR');
    });
    it('falls back to the language primary market', () => {
      expect(svc.parseAcceptLanguage('ja')).toBe('JP');
      expect(svc.parseAcceptLanguage('tr-TR')).toBe('TR');
    });
    it('returns null for empty / wildcard', () => {
      expect(svc.parseAcceptLanguage('')).toBeNull();
      expect(svc.parseAcceptLanguage('*')).toBeNull();
    });
  });

  describe('resolve — trust order', () => {
    it('billing country beats everything', () => {
      const r = svc.resolve({
        billingCountry: 'IN',
        geoHeaderCountry: 'US',
        acceptLanguage: 'fr-FR',
        ipCountry: 'BR',
      });
      expect(r.country).toBe('IN');
      expect(r.source).toBe('billing');
      expect(r.usedFallback).toBe(false);
    });

    it('geo header beats accept-language + ip when no billing/profile', () => {
      const r = svc.resolve({
        geoHeaderCountry: 'JP',
        acceptLanguage: 'en-US',
        ipCountry: 'BR',
      });
      expect(r.country).toBe('JP');
      expect(r.source).toBe('geo-header');
    });

    it('raw IP (possible VPN) is the lowest-trust signal', () => {
      const r = svc.resolve({ ipCountry: 'BR' });
      expect(r.country).toBe('BR');
      expect(r.source).toBe('vpn-ip');
    });

    it('falls back to US default when nothing resolves', () => {
      const r = svc.resolve({});
      expect(r.country).toBe('US');
      expect(r.source).toBe('default');
      expect(r.usedFallback).toBe(true);
    });
  });

  describe('resolve — nearest-region fallback', () => {
    it('maps an unpriced country to its nearest configured proxy', () => {
      // Pakistan isn't priced directly → proxied to India.
      const r = svc.resolve({ billingCountry: 'PK' });
      expect(r.country).toBe('IN');
      expect(r.detectedCountry).toBe('PK');
      expect(r.usedFallback).toBe(true);
    });

    it('maps a eurozone member to France (EUR) and keeps EUR currency', () => {
      const r = svc.resolve({ billingCountry: 'DE' });
      expect(r.country).toBe('FR');
      expect(r.currency).toBe('EUR');
      expect(r.usedFallback).toBe(true);
    });

    it('maps an unknown country to the USD baseline', () => {
      const r = svc.resolve({ billingCountry: 'AQ' });
      expect(r.country).toBe('US');
      expect(r.currency).toBe('USD');
      expect(r.usedFallback).toBe(true);
    });
  });
});
