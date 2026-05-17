import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PER_USER_WINDOW_MS = 3_000;
const PER_USER_MAX_IN_WINDOW = 5;
const MAX_LEN = 280;
const MIN_LEN = 1;

interface RecentSend {
  ts: number;
}

/**
 * Aviator chat. Per-user rate limit (5 msgs / 3s window) plus length cap
 * (1..280 chars). Persisted to AviatorChatMessage; recent history replayed
 * to newly-connected sockets.
 */
@Injectable()
export class AviatorChatService {
  private recentByUser = new Map<string, RecentSend[]>();

  constructor(private readonly prisma: PrismaService) {}

  async send(userId: string, username: string, raw: string) {
    const message = raw.trim();
    if (message.length < MIN_LEN) throw new BadRequestException('empty message');
    if (message.length > MAX_LEN) throw new BadRequestException('message too long');

    this.enforceRateLimit(userId);

    const row = await this.prisma.aviatorChatMessage.create({
      data: { userId, message },
    });
    return {
      id: row.id,
      username,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async recent(limit = 50) {
    const rows = await this.prisma.aviatorChatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { username: true } } },
    });
    return rows
      .reverse()
      .map((r) => ({
        id: r.id,
        username: r.user.username,
        message: r.message,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  async adminList(limit = 100) {
    const rows = await this.prisma.aviatorChatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: { id: true, username: true, whatsappPhone: true, email: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user.username,
      contact: r.user.whatsappPhone ?? r.user.email ?? null,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async deleteMessage(id: string) {
    await this.prisma.aviatorChatMessage.delete({ where: { id } });
    return { ok: true };
  }

  private enforceRateLimit(userId: string) {
    const now = Date.now();
    const cutoff = now - PER_USER_WINDOW_MS;
    const history = (this.recentByUser.get(userId) ?? []).filter((r) => r.ts >= cutoff);
    if (history.length >= PER_USER_MAX_IN_WINDOW) {
      throw new BadRequestException('rate limited');
    }
    history.push({ ts: now });
    this.recentByUser.set(userId, history);
  }
}
