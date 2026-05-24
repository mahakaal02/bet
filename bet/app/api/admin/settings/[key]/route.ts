import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, RbacError } from "@/lib/rbac";

/**
 * PATCH /api/admin/settings/[key] (PR-BET-ADMIN-REDESIGN).
 * Body: { value, type, category, description, sensitive? }
 *
 * Any admin can edit settings. Every write is audited via AdminLog
 * with the prior + new value embedded in metadata for full diff
 * history.
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const me = await requireAdmin();
    const { key } = await context.params;
    const body = (await req.json()) as {
      value: unknown;
      type?: string;
      category?: string;
      description?: string;
      sensitive?: boolean;
    };
    const previous = await db.adminSetting.findUnique({ where: { key } });
    const saved = await db.adminSetting.upsert({
      where: { key },
      create: {
        key,
        value: body.value as never,
        type: body.type ?? "string",
        category: body.category ?? "misc",
        description: body.description ?? null,
        sensitive: body.sensitive ?? false,
        updatedById: me.id,
      },
      update: {
        value: body.value as never,
        type: body.type ?? previous?.type ?? "string",
        category: body.category ?? previous?.category ?? "misc",
        description: body.description ?? previous?.description ?? null,
        sensitive: body.sensitive ?? previous?.sensitive ?? false,
        updatedById: me.id,
      },
    });
    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: "setting.update",
        targetId: key,
        // Cast to JSON-compatible — `previous.value` is a Prisma
        // JsonValue and `body.value` is unknown; both are safe here.
        metadata: {
          previous: (previous?.value ?? null) as never,
          next: body.value as never,
        },
      },
    });
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
