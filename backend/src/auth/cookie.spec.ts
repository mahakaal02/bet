import {
  ADMIN_COOKIE_NAME,
  parseCookieHeader,
  serializeAdminCookie,
  serializeAdminCookieClear,
} from './cookie';

describe('parseCookieHeader', () => {
  it('returns {} for undefined / empty', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  it('parses a single key/value', () => {
    expect(parseCookieHeader('foo=bar')).toEqual({ foo: 'bar' });
  });

  it('parses multiple cookies separated by semicolons', () => {
    expect(parseCookieHeader('foo=bar; baz=qux; abc=def')).toEqual({
      foo: 'bar', baz: 'qux', abc: 'def',
    });
  });

  it('trims whitespace around keys + values', () => {
    expect(parseCookieHeader('  foo  =  bar  ;  baz=qux')).toEqual({
      foo: 'bar', baz: 'qux',
    });
  });

  it('preserves "=" inside cookie values (e.g. base64)', () => {
    // JWT segments end with `=` padding sometimes.
    expect(parseCookieHeader('token=abc.def=; other=x')).toEqual({
      token: 'abc.def=', other: 'x',
    });
  });

  it('handles cookies with empty values', () => {
    expect(parseCookieHeader('cleared=; live=yes')).toEqual({
      cleared: '', live: 'yes',
    });
  });

  it('last write wins for duplicate keys (matches browser behaviour)', () => {
    expect(parseCookieHeader('a=1; a=2; a=3')).toEqual({ a: '3' });
  });

  it('ignores keyless cookie tokens gracefully', () => {
    expect(parseCookieHeader('; ;foo=bar;')).toEqual({ foo: 'bar' });
  });
});

describe('serializeAdminCookie', () => {
  it('includes HttpOnly, SameSite=Lax, Path=/ by default', () => {
    const v = serializeAdminCookie('abc.def.ghi', { secure: false });
    expect(v).toContain(`${ADMIN_COOKIE_NAME}=abc.def.ghi`);
    expect(v).toContain('Path=/');
    expect(v).toContain('HttpOnly');
    expect(v).toContain('SameSite=Lax');
    expect(v).not.toContain('Secure');
    expect(v).not.toContain('Domain=');
    // 12h = 43200 s default Max-Age
    expect(v).toContain('Max-Age=43200');
  });

  it('adds Secure when opted in', () => {
    const v = serializeAdminCookie('tok', { secure: true });
    expect(v).toContain('Secure');
  });

  it('adds Domain when set', () => {
    const v = serializeAdminCookie('tok', { secure: true, domain: '.cloud.podstack.ai' });
    expect(v).toContain('Domain=.cloud.podstack.ai');
  });

  it('honours custom Max-Age', () => {
    const v = serializeAdminCookie('tok', { secure: true, maxAgeSeconds: 60 });
    expect(v).toContain('Max-Age=60');
  });
});

describe('serializeAdminCookieClear', () => {
  it('emits Max-Age=0 with empty value', () => {
    const v = serializeAdminCookieClear({ secure: true });
    expect(v).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=;`));
    expect(v).toContain('Max-Age=0');
    expect(v).toContain('HttpOnly');
    expect(v).toContain('SameSite=Lax');
    expect(v).toContain('Secure');
  });

  it('includes Domain so the clear targets the same cookie the set targeted', () => {
    const v = serializeAdminCookieClear({ secure: true, domain: '.cloud.podstack.ai' });
    expect(v).toContain('Domain=.cloud.podstack.ai');
  });
});

describe('round-trip: serialize → parse', () => {
  it('parsing the value half of a fresh cookie recovers the token', () => {
    const setCookie = serializeAdminCookie('the.jwt.value', {
      secure: true, domain: '.cloud.podstack.ai',
    });
    // Browsers strip attributes when sending; we simulate the
    // "Cookie:" header by taking only the leading name=value pair.
    const headerLine = setCookie.split(';')[0]!;
    const parsed = parseCookieHeader(headerLine);
    expect(parsed[ADMIN_COOKIE_NAME]).toBe('the.jwt.value');
  });
});
