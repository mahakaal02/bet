import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

// Where uploaded avatars are stored on disk. Sits under `public/` so Next
// serves them at the same path with no extra handler.
const PUBLIC_AVATAR_DIR = join(process.cwd(), "public", "uploads", "avatars");

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB raw

// Whitelist content types — defence-in-depth alongside the magic-byte check.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Upload a new avatar for the signed-in user.
 *
 *   POST /api/me/avatar  (multipart/form-data, field name: "file")
 *
 * Flow:
 *   1. Validate type + size.
 *   2. Generate a random suffix so each upload has its own URL — old
 *      browser caches don't show the previous image after a swap.
 *   3. Write to disk under public/uploads/avatars/.
 *   4. Atomically update User.image and unlink the previous file (if any
 *      previous upload was local — leaves Google avatars alone).
 *
 * Old avatars under public/uploads are best-effort deleted; an unlink
 * failure is logged but not fatal.
 */
export async function POST(req: Request) {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`avatar:${u.id}`, { limit: 5, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  // Buffer + magic-byte sniff. Browsers can lie about Content-Type; we
  // double-check the first few bytes match a real image header. Cheap and
  // catches both honest mistakes and obvious attempts to upload garbage.
  const buf = Buffer.from(await file.arrayBuffer());
  if (!hasImageMagic(buf, file.type)) {
    return NextResponse.json({ error: "bad_image" }, { status: 400 });
  }

  await mkdir(PUBLIC_AVATAR_DIR, { recursive: true });
  const filename = `${u.id}-${randomBytes(6).toString("hex")}.${ext}`;
  const fsPath = join(PUBLIC_AVATAR_DIR, filename);
  const publicUrl = `/uploads/avatars/${filename}`;

  await writeFile(fsPath, buf);

  // Replace the User.image and grab the previous URL so we can clean up.
  const prev = await db.user.findUnique({
    where: { id: u.id },
    select: { image: true },
  });
  await db.user.update({
    where: { id: u.id },
    data: { image: publicUrl },
  });

  // Best-effort unlink of the old file. Only delete things we own — Google
  // OAuth puts a googleusercontent URL there and we must not touch those.
  if (prev?.image && prev.image.startsWith("/uploads/avatars/")) {
    const oldName = prev.image.replace("/uploads/avatars/", "");
    // Sanity: filename must be exactly what we generated. Reject anything
    // with path separators or .. — defence against an attacker with DB
    // write access poisoning the field.
    if (/^[a-z0-9-]+\.(png|jpg|webp|gif)$/i.test(oldName)) {
      unlink(join(PUBLIC_AVATAR_DIR, oldName)).catch((err) => {
        console.warn("avatar: could not unlink previous", oldName, err.message);
      });
    }
  }

  return NextResponse.json({ ok: true, url: publicUrl });
}

/**
 * Delete the current avatar. Resets User.image to null so the gradient
 * initial renders again.
 */
export async function DELETE() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const prev = await db.user.findUnique({
    where: { id: u.id },
    select: { image: true },
  });
  await db.user.update({ where: { id: u.id }, data: { image: null } });

  if (prev?.image && prev.image.startsWith("/uploads/avatars/")) {
    const oldName = prev.image.replace("/uploads/avatars/", "");
    if (/^[a-z0-9-]+\.(png|jpg|webp|gif)$/i.test(oldName)) {
      unlink(join(PUBLIC_AVATAR_DIR, oldName)).catch(() => undefined);
    }
  }
  return NextResponse.json({ ok: true });
}

/** Quick magic-byte sniff for the four formats we accept. */
function hasImageMagic(buf: Buffer, contentType: string): boolean {
  if (buf.length < 12) return false;
  // PNG: 89 50 4E 47
  if (
    contentType === "image/png" &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return true;
  }
  // JPEG: FF D8 FF
  if (
    contentType === "image/jpeg" &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return true;
  }
  // WebP: starts with "RIFF…WEBP"
  if (
    contentType === "image/webp" &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    contentType === "image/gif" &&
    (buf.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buf.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return true;
  }
  return false;
}
