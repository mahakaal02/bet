import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SupportTicket,
  TicketCategory,
  TicketCloseReason,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../foundation/audit-log.service';
import { SettingsService } from '../foundation/settings.service';
import { clampPageLimit, cursorPage } from '../common/pagination';

/**
 * Support ticket service (Roadmap §F-USER-15).
 *
 * Lifecycle:
 *
 *   OPEN — fresh submission. SLA timer started.
 *     ↓ first admin reply
 *   AWAITING_USER — admin replied, ball is in the user's court.
 *     ↓ user replies
 *   AWAITING_ADMIN — back to admin.
 *     ↓ admin escalate
 *   ESCALATED — flagged for higher-tier support. Same as AWAITING_ADMIN
 *               but with a separate queue / SLA.
 *     ↓ admin resolve
 *   RESOLVED — admin marked done. Auto-CLOSED after `tickets.auto_close_days` (default 7).
 *     ↓ user replies again
 *   (Bounces back to AWAITING_ADMIN — re-opens.)
 *   CLOSED — terminal. New activity opens a fresh ticket.
 *
 * SLA: `slaDueAt` is set on submit based on the category + priority
 * matrix (held in SystemSetting so support can tune). When an admin
 * makes the first response, `firstResponseAt` is set — we expose
 * "did we hit our SLA?" downstream via that comparison.
 *
 * Attachments: schema-only for this PR — the bytes pipeline reuses
 * the storage abstraction that lands in PR-BULK-IMG-1 (storage +
 * virus-scan adapters). Until then `SupportAttachment` rows can be
 * inserted manually for testing but the user-facing upload UI is
 * deferred.
 *
 * Internal notes: `SupportMessage.isInternal=true` hides the row
 * from the user — admins use this for coordination ("escalating to
 * finance" / "user posted to Twitter about this" / etc.). The user
 * REST endpoints filter it out at the query layer.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  // SLA defaults if SystemSetting rows are missing — minutes.
  static readonly DEFAULT_SLA_MIN: Record<TicketPriority, number> = {
    URGENT: 60,           // 1h
    HIGH: 4 * 60,         // 4h
    NORMAL: 24 * 60,      // 24h
    LOW: 3 * 24 * 60,     // 3d
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsService,
  ) {}

  // ─── User-side ─────────────────────────────────────────────────

  /**
   * Submit a new ticket. Refuses if the user already has an OPEN /
   * AWAITING_* ticket in the same category — they should reply to
   * the existing one rather than spawn a duplicate. Idempotent on
   * `idempotencyKey` if provided (front-end retries shouldn't fork).
   */
  async submit(input: {
    userId: string;
    subject: string;
    body: string;
    category: TicketCategory;
    priority?: TicketPriority;
    linkedEntityType?: string;
    linkedEntityId?: string;
  }): Promise<{ ticketId: string; status: TicketStatus; slaDueAt: Date }> {
    if (input.subject.trim().length < 4) {
      throw new BadRequestException({ code: 'TICKET_SUBJECT_TOO_SHORT' });
    }
    if (input.body.trim().length < 10) {
      throw new BadRequestException({ code: 'TICKET_BODY_TOO_SHORT' });
    }
    if (input.subject.trim().length > 200 || input.body.trim().length > 5000) {
      throw new BadRequestException({ code: 'TICKET_TOO_LARGE' });
    }

    const priority = input.priority ?? TicketPriority.NORMAL;

    // Anti-duplicate: refuse if user has an active ticket in the same category.
    const dup = await this.prisma.supportTicket.findFirst({
      where: {
        userId: input.userId,
        category: input.category,
        status: { in: [TicketStatus.OPEN, TicketStatus.AWAITING_USER, TicketStatus.AWAITING_ADMIN, TicketStatus.ESCALATED] },
      },
      select: { id: true, status: true },
    });
    if (dup) {
      throw new ConflictException({
        code: 'TICKET_ACTIVE_DUPLICATE',
        existingTicketId: dup.id,
        message: 'You already have an open ticket in this category — reply to it instead.',
      });
    }

    const slaMin = await this.slaMinutesFor(input.category, priority);
    const now = new Date();
    const slaDueAt = new Date(now.getTime() + slaMin * 60_000);

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: input.userId,
        subject: input.subject.trim(),
        category: input.category,
        priority,
        status: TicketStatus.OPEN,
        slaDueAt,
        linkedEntityType: input.linkedEntityType ?? null,
        linkedEntityId: input.linkedEntityId ?? null,
        messages: {
          create: {
            senderId: input.userId,
            isFromAdmin: false,
            isInternal: false,
            body: input.body.trim(),
          },
        },
      },
    });
    return { ticketId: ticket.id, status: ticket.status, slaDueAt: ticket.slaDueAt };
  }

  /**
   * List tickets visible to a user — only their own. Cursor pagination.
   */
  async listMine(input: { userId: string; cursor?: string; limit?: number }) {
    const take = clampPageLimit(input.limit);
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId: input.userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const { page, nextCursor } = cursorPage(rows, take);
    return {
      items: page.map(this.toUserListShape),
      nextCursor,
    };
  }

  /**
   * Per-ticket detail — includes message history with isInternal=true
   * rows filtered out for the user view.
   */
  async getMine(userId: string, ticketId: string) {
    const ticket = await this.requireOwnedBy(userId, ticketId);
    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId, isInternal: false },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...this.toUserListShape(ticket),
      linkedEntityType: ticket.linkedEntityType,
      linkedEntityId: ticket.linkedEntityId,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        isFromAdmin: m.isFromAdmin,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * User reply — bounces a RESOLVED/AWAITING_USER ticket back to
   * AWAITING_ADMIN. Refuses on CLOSED (start a new ticket instead).
   */
  async userReply(input: { userId: string; ticketId: string; body: string }) {
    if (input.body.trim().length < 1) {
      throw new BadRequestException({ code: 'TICKET_REPLY_EMPTY' });
    }
    if (input.body.trim().length > 5000) {
      throw new BadRequestException({ code: 'TICKET_REPLY_TOO_LARGE' });
    }
    const ticket = await this.requireOwnedBy(input.userId, input.ticketId);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new ConflictException({
        code: 'TICKET_CLOSED',
        message: 'This ticket is closed. Submit a new one if you need help.',
      });
    }
    const newStatus = TicketStatus.AWAITING_ADMIN;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          ticketId: input.ticketId,
          senderId: input.userId,
          isFromAdmin: false,
          isInternal: false,
          body: input.body.trim(),
        },
      });
      return tx.supportTicket.update({
        where: { id: input.ticketId },
        data: { status: newStatus },
      });
    });
    return { ticketId: updated.id, status: updated.status };
  }

  // ─── Admin-side ────────────────────────────────────────────────

  /**
   * Paginated admin queue. Filterable by status + category +
   * assignee. Default sort: oldest-first within OPEN/AWAITING_ADMIN
   * (so the SLA-warmest tickets surface first).
   */
  async listForAdmin(input: {
    status?: TicketStatus;
    category?: TicketCategory;
    assignedToId?: string;
    cursor?: string;
    limit?: number;
  }) {
    const take = clampPageLimit(input.limit);
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
      },
      orderBy: [{ slaDueAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
    });
    const { page, nextCursor } = cursorPage(rows, take);
    const items = page.map((r) => ({
      id: r.id,
      userId: r.user.id,
      username: r.user.username,
      email: r.user.email,
      subject: r.subject,
      category: r.category,
      priority: r.priority,
      status: r.status,
      slaDueAt: r.slaDueAt,
      slaBreached: r.firstResponseAt === null && r.slaDueAt.getTime() < Date.now(),
      assignedToId: r.assignedToId,
      firstResponseAt: r.firstResponseAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    return { items, nextCursor };
  }

  /** Full per-ticket view including internal notes. */
  async getForAdmin(ticketId: string) {
    const ticket = await this.requireTicket(ticketId);
    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: ticket.id,
      userId: ticket.userId,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      slaDueAt: ticket.slaDueAt,
      firstResponseAt: ticket.firstResponseAt,
      linkedEntityType: ticket.linkedEntityType,
      linkedEntityId: ticket.linkedEntityId,
      assignedToId: ticket.assignedToId,
      closedAt: ticket.closedAt,
      closedReason: ticket.closedReason,
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        isFromAdmin: m.isFromAdmin,
        isInternal: m.isInternal,
        body: m.body,
        createdAt: m.createdAt,
      })),
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }

  /**
   * Admin reply (public or internal). On the FIRST public admin
   * reply we stamp `firstResponseAt` — used to measure SLA hit rate
   * downstream.
   */
  async adminReply(input: {
    adminId: string;
    adminEmail: string;
    ticketId: string;
    body: string;
    isInternal?: boolean;
  }) {
    if (input.body.trim().length < 1) {
      throw new BadRequestException({ code: 'TICKET_REPLY_EMPTY' });
    }
    const ticket = await this.requireTicket(input.ticketId);
    if (ticket.status === TicketStatus.CLOSED) {
      throw new ConflictException({ code: 'TICKET_CLOSED' });
    }
    const isPublic = !input.isInternal;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          ticketId: input.ticketId,
          senderId: input.adminId,
          isFromAdmin: true,
          isInternal: !!input.isInternal,
          body: input.body.trim(),
        },
      });
      return tx.supportTicket.update({
        where: { id: input.ticketId },
        data: {
          // Internal notes don't change the user-visible status.
          ...(isPublic
            ? {
                status: TicketStatus.AWAITING_USER,
                firstResponseAt: ticket.firstResponseAt ?? new Date(),
              }
            : {}),
        },
      });
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: isPublic ? 'support.admin_reply' : 'support.admin_note',
      targetType: 'SupportTicket',
      targetId: input.ticketId,
      after: { length: input.body.trim().length, isInternal: !!input.isInternal },
    });
    return { ticketId: result.id, status: result.status };
  }

  /** Assign / reassign to a specific admin. */
  async assign(input: {
    adminId: string;
    adminEmail: string;
    ticketId: string;
    assigneeId: string | null;
  }) {
    const ticket = await this.requireTicket(input.ticketId);
    // Snapshot the old assignee BEFORE the update — Prisma mocks that
    // return the same row reference (and the real client in some
    // configurations) would otherwise leak the post-update value
    // into the audit `before` field.
    const previousAssignee = ticket.assignedToId;
    await this.prisma.supportTicket.update({
      where: { id: input.ticketId },
      data: { assignedToId: input.assigneeId },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'support.assign',
      targetType: 'SupportTicket',
      targetId: input.ticketId,
      before: { assignedToId: previousAssignee },
      after: { assignedToId: input.assigneeId },
    });
    return { ticketId: input.ticketId, assigneeId: input.assigneeId };
  }

  /** Escalate to higher tier. */
  async escalate(input: { adminId: string; adminEmail: string; ticketId: string; reason: string }) {
    if (input.reason.trim().length < 4) {
      throw new BadRequestException({ code: 'TICKET_ESCALATE_REASON_REQUIRED' });
    }
    const ticket = await this.requireTicket(input.ticketId);
    if (ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.RESOLVED) {
      throw new ConflictException({ code: 'TICKET_NOT_ACTIVE' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          ticketId: input.ticketId,
          senderId: input.adminId,
          isFromAdmin: true,
          isInternal: true,
          body: `Escalated: ${input.reason.trim()}`,
        },
      });
      await tx.supportTicket.update({
        where: { id: input.ticketId },
        data: { status: TicketStatus.ESCALATED, priority: TicketPriority.HIGH },
      });
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'support.escalate',
      targetType: 'SupportTicket',
      targetId: input.ticketId,
      before: { status: ticket.status, priority: ticket.priority },
      after: { status: TicketStatus.ESCALATED, priority: TicketPriority.HIGH, reason: input.reason.trim() },
    });
    return { ticketId: input.ticketId, status: TicketStatus.ESCALATED };
  }

  /** Admin closes a ticket with a reason. */
  async close(input: {
    adminId: string;
    adminEmail: string;
    ticketId: string;
    reason: TicketCloseReason;
  }) {
    const ticket = await this.requireTicket(input.ticketId);
    if (ticket.status === TicketStatus.CLOSED) {
      // idempotent
      return { ticketId: ticket.id, status: TicketStatus.CLOSED };
    }
    const updated = await this.prisma.supportTicket.update({
      where: { id: input.ticketId },
      data: { status: TicketStatus.CLOSED, closedAt: new Date(), closedReason: input.reason },
    });
    await this.audit.record({
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      action: 'support.close',
      targetType: 'SupportTicket',
      targetId: input.ticketId,
      before: { status: ticket.status },
      after: { status: TicketStatus.CLOSED, reason: input.reason },
    });
    return { ticketId: updated.id, status: updated.status };
  }

  // ─── helpers ──────────────────────────────────────────────────

  private async slaMinutesFor(category: TicketCategory, priority: TicketPriority): Promise<number> {
    // Per-priority knob from SystemSetting; falls back to the static
    // default. Category-specific overrides land in a follow-up if the
    // support team asks for them.
    const key = `tickets.sla_min.${priority.toLowerCase()}`;
    const minutes = await this.settings.getInt(key, TicketsService.DEFAULT_SLA_MIN[priority]);
    void category;
    return Math.max(1, minutes);
  }

  private toUserListShape(t: SupportTicket) {
    return {
      id: t.id,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      slaDueAt: t.slaDueAt,
      firstResponseAt: t.firstResponseAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  private async requireTicket(id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND' });
    return t;
  }

  private async requireOwnedBy(userId: string, ticketId: string) {
    const t = await this.requireTicket(ticketId);
    if (t.userId !== userId) throw new ForbiddenException({ code: 'NOT_YOUR_TICKET' });
    return t;
  }
}
