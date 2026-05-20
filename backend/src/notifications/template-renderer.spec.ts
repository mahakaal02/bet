import { BadRequestException } from '@nestjs/common';
import { TemplateRendererService } from './template-renderer';

/**
 * Template renderer is the part of the notification pipeline that's
 * easiest to introduce a bug into — small string-substitution
 * surface, but every failure mode reaches a user. Heavier coverage
 * here is cheap insurance.
 */
describe('TemplateRendererService', () => {
  const r = new TemplateRendererService();

  describe('render — happy paths', () => {
    it('substitutes a single variable', () => {
      const out = r.render({
        body: 'Hello, {{name}}!',
        payload: { name: 'world' },
        declaredVariables: { name: 'string' },
        escape: 'none',
      });
      expect(out).toBe('Hello, world!');
    });

    it('substitutes multiple variables in one pass', () => {
      const out = r.render({
        body: '{{verb}} {{count}} times',
        payload: { verb: 'click', count: 7 },
        declaredVariables: { verb: 'string', count: 'number' },
        escape: 'none',
      });
      expect(out).toBe('click 7 times');
    });

    it('handles a template with no variables', () => {
      const out = r.render({
        body: 'plain text',
        payload: {},
        declaredVariables: {},
        escape: 'none',
      });
      expect(out).toBe('plain text');
    });

    it('handles repeated occurrences of the same variable', () => {
      const out = r.render({
        body: '{{x}}-{{x}}-{{x}}',
        payload: { x: 'ab' },
        declaredVariables: { x: 'string' },
        escape: 'none',
      });
      expect(out).toBe('ab-ab-ab');
    });

    it('supports whitespace around the variable name', () => {
      const out = r.render({
        body: 'Hi {{ name }}',
        payload: { name: 'there' },
        declaredVariables: { name: 'string' },
        escape: 'none',
      });
      expect(out).toBe('Hi there');
    });

    it('coerces number + boolean to string', () => {
      const out = r.render({
        body: '{{a}} {{b}}',
        payload: { a: 42, b: true },
        declaredVariables: { a: 'number', b: 'boolean' },
        escape: 'none',
      });
      expect(out).toBe('42 true');
    });
  });

  describe('render — HTML escaping', () => {
    it('HTML-escapes when escape=html', () => {
      const out = r.render({
        body: '{{name}}',
        payload: { name: '<script>alert("xss")</script>' },
        declaredVariables: { name: 'string' },
        escape: 'html',
      });
      expect(out).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('does NOT escape when escape=none', () => {
      const out = r.render({
        body: '{{name}}',
        payload: { name: '<b>' },
        declaredVariables: { name: 'string' },
        escape: 'none',
      });
      expect(out).toBe('<b>');
    });

    it('escapes ampersands and quotes', () => {
      const out = r.render({
        body: '{{q}}',
        payload: { q: 'a & b "c" \'d\'' },
        declaredVariables: { q: 'string' },
        escape: 'html',
      });
      expect(out).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
    });
  });

  describe('render — error paths', () => {
    it('throws when a referenced variable is not declared', () => {
      expect(() =>
        r.render({
          body: '{{name}}',
          payload: { name: 'world' },
          declaredVariables: {},
          escape: 'none',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws when payload is missing a declared variable', () => {
      expect(() =>
        r.render({
          body: '{{name}}',
          payload: {},
          declaredVariables: { name: 'string' },
          escape: 'none',
        }),
      ).toThrow(/missing payload value/);
    });

    it('throws when a payload value is not a primitive', () => {
      expect(() =>
        r.render({
          body: '{{obj}}',
          payload: { obj: { nested: true } },
          declaredVariables: { obj: 'string' },
          escape: 'none',
        }),
      ).toThrow(/must be primitive/);
    });

    it('does NOT eval template expressions', () => {
      // No conditionals, no helpers — `{{#if foo}}` is just a literal.
      const out = r.render({
        body: 'literal {{#if x}}should{{/if}} pass',
        payload: {},
        declaredVariables: {},
        escape: 'none',
      });
      // The renderer treats `{{#if x}}` as a non-match (regex
      // requires identifier syntax), so the literal text is
      // preserved.
      expect(out).toBe('literal {{#if x}}should{{/if}} pass');
    });
  });

  describe('validatePayload', () => {
    it('returns no errors for a complete payload', () => {
      expect(
        r.validatePayload({ a: 'x', b: 1 }, { a: 'string', b: 'number' }),
      ).toEqual([]);
    });

    it('flags missing variables', () => {
      const errs = r.validatePayload({}, { a: 'string' });
      expect(errs).toEqual(['missing variable a']);
    });

    it('flags type mismatches', () => {
      const errs = r.validatePayload(
        { a: 1, b: 'wrong' },
        { a: 'string', b: 'number' },
      );
      expect(errs).toContain('a should be string, got number');
      expect(errs).toContain('b should be number, got string');
    });
  });
});
