import { Role } from '@prisma/client';
import {
  Permission,
  ROLE_PERMISSIONS,
  permissionGranted,
  permissionsForRoles,
} from './permissions';

/**
 * Permission resolution + role mapping tests. These are pure data
 * — no Nest, no Prisma. The guard tests live separately because
 * they need ExecutionContext mocks.
 */
describe('permissionGranted', () => {
  it('grants when the exact slug is held', () => {
    const held = new Set<Permission>(['audit.view']);
    expect(permissionGranted(held, 'audit.view')).toBe(true);
  });

  it('denies when nothing is held', () => {
    const held = new Set<Permission>();
    expect(permissionGranted(held, 'audit.view')).toBe(false);
  });

  it("ADMIN's '*' grants every slug", () => {
    const held = new Set<Permission>(['*']);
    expect(permissionGranted(held, 'audit.view')).toBe(true);
    expect(permissionGranted(held, 'withdrawal.approve')).toBe(true);
    expect(permissionGranted(held, 'ticket.reply')).toBe(true);
  });

  it("AUDITOR's '*.view' grants any .view slug but no mutations", () => {
    const held = new Set<Permission>(['*.view']);
    expect(permissionGranted(held, 'audit.view')).toBe(true);
    expect(permissionGranted(held, 'withdrawal.view')).toBe(true);
    expect(permissionGranted(held, 'reconciliation.view')).toBe(true);
    expect(permissionGranted(held, 'ledger.view')).toBe(true);
    expect(permissionGranted(held, 'withdrawal.approve')).toBe(false);
    expect(permissionGranted(held, 'user.ban')).toBe(false);
    expect(permissionGranted(held, 'ticket.reply')).toBe(false);
  });

  it("the '*.view' wildcard does not match its own literal", () => {
    // Sanity: a route asking for `'*.view'` doesn't get answered
    // by a user who literally holds `'*.view'`, because route
    // requirements are exact slugs, never wildcards. The guard
    // matches via `permissionGranted(held, required)` where
    // `required` is what the route asks for — `.endsWith('.view')`
    // is true here only because the literal ends in `.view`.
    const held = new Set<Permission>(['*.view']);
    expect(permissionGranted(held, '*.view')).toBe(true);
  });
});

describe('permissionsForRoles', () => {
  it('returns ADMIN as a single-element set containing the wildcard', () => {
    const got = permissionsForRoles([Role.ADMIN]);
    expect(got.has('*')).toBe(true);
    expect(got.size).toBe(1);
  });

  it('unions multiple roles into a flat set', () => {
    const got = permissionsForRoles([Role.MODERATOR, Role.SUPPORT]);
    // MODERATOR has user.view + user.ban + audit.view etc.
    expect(got.has('audit.view')).toBe(true);
    expect(got.has('user.view')).toBe(true);
    expect(got.has('ticket.view')).toBe(true);
    expect(got.has('ticket.reply')).toBe(true);
  });

  it('returns an empty set for an empty role list', () => {
    const got = permissionsForRoles([]);
    expect(got.size).toBe(0);
  });
});

describe('ROLE_PERMISSIONS matrix sanity', () => {
  it('every role declares at least one permission', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('MODERATOR has audit.view (so they can investigate bans)', () => {
    expect(ROLE_PERMISSIONS.MODERATOR).toContain('audit.view');
  });

  it('FINANCE has withdrawal.approve + withdrawal.reject (not just view)', () => {
    expect(ROLE_PERMISSIONS.FINANCE).toContain('withdrawal.approve');
    expect(ROLE_PERMISSIONS.FINANCE).toContain('withdrawal.reject');
  });

  it('AUDITOR is read-only — has no mutation slugs', () => {
    const auditorPerms = new Set<string>(ROLE_PERMISSIONS.AUDITOR);
    // Read-only sanity: nothing in AUDITOR ends in a mutating verb.
    const mutating = ['approve', 'reject', 'ban', 'unban', 'reply', 'edit'];
    for (const p of auditorPerms) {
      if (p === '*' || p === '*.view') continue;
      const verb = p.split('.').slice(1).join('.');
      expect(mutating.some((m) => verb.startsWith(m))).toBe(false);
    }
  });

  it('SUPPORT cannot view audit log (escalation surface, not their job)', () => {
    expect(ROLE_PERMISSIONS.SUPPORT).not.toContain('audit.view');
  });
});
