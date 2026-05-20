import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * Safe template renderer for notification bodies.
 *
 * Handlebars-style `{{varName}}` substitution with a strict
 * variable allowlist declared on `NotificationTemplate.variables`.
 * Nothing else is allowed — no helpers, no sub-expressions, no
 * conditionals, no `eval`-able constructs. The template author
 * declares the variable schema once when the template is created;
 * `enqueue()` payloads are validated against it at render time so
 * a missing or extra variable surfaces immediately rather than
 * landing as a half-rendered notification.
 *
 * Why not Handlebars or Mustache? The full libraries open a side
 * channel: a malicious template author (or a stolen admin session)
 * could escape via helpers or partials. A 30-line custom renderer
 * that does ONE thing — substitute named variables — is auditable
 * and has no surface area for template injection.
 *
 * Output is HTML-escaped per channel:
 *   PUSH    → no escape (FCM payload is JSON; FCM client renders
 *              as plain text on the device)
 *   EMAIL   → HTML-escape (the email body is rendered as HTML)
 *   INAPP   → HTML-escape (the in-app body is rendered as text in
 *              React; React itself escapes, but we double-down here
 *              so manual `dangerouslySetInnerHTML` consumers stay safe)
 */
@Injectable()
export class TemplateRendererService {
  private static readonly VAR_REGEX = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;

  /**
   * Render a single template body against a payload.
   *
   * @throws BadRequestException if:
   *   - a variable referenced in the template isn't declared in
   *     `declaredVariables`
   *   - the payload is missing a declared variable
   *   - a payload value is not a primitive (string/number/boolean)
   */
  render(input: {
    body: string;
    payload: Record<string, unknown>;
    declaredVariables: Record<string, string>;       // { auctionTitle: "string", ... }
    escape: 'none' | 'html';
  }): string {
    const declared = new Set(Object.keys(input.declaredVariables));
    const used = new Set<string>();
    const errors: string[] = [];

    const rendered = input.body.replace(TemplateRendererService.VAR_REGEX, (_, name: string) => {
      used.add(name);
      if (!declared.has(name)) {
        errors.push(`undeclared variable {{${name}}}`);
        return '';
      }
      const v = input.payload[name];
      if (v == null) {
        errors.push(`missing payload value for {{${name}}}`);
        return '';
      }
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        errors.push(`payload value for {{${name}}} must be primitive, got ${typeof v}`);
        return '';
      }
      const str = String(v);
      return input.escape === 'html' ? TemplateRendererService.escapeHtml(str) : str;
    });

    if (errors.length > 0) {
      throw new BadRequestException(`template render failed: ${errors.join('; ')}`);
    }
    return rendered;
  }

  /**
   * Validate that a payload satisfies the declared variable schema
   * *before* the notification is enqueued. Lets the caller catch
   * missing variables at enqueue time rather than at render time
   * (which would dead-letter the row).
   */
  validatePayload(payload: Record<string, unknown>, declared: Record<string, string>): string[] {
    const errors: string[] = [];
    for (const [name, expectedType] of Object.entries(declared)) {
      const v = payload[name];
      if (v == null) {
        errors.push(`missing variable ${name}`);
        continue;
      }
      const actualType = typeof v;
      if (expectedType === 'string' && actualType !== 'string') errors.push(`${name} should be string, got ${actualType}`);
      if (expectedType === 'number' && actualType !== 'number') errors.push(`${name} should be number, got ${actualType}`);
      if (expectedType === 'boolean' && actualType !== 'boolean') errors.push(`${name} should be boolean, got ${actualType}`);
    }
    return errors;
  }

  private static escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
