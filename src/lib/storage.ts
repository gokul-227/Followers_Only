import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";
import { db } from "./db";
import { assert, token, HttpError, canRead, canViewProfile } from "./security";
import type { User } from "@prisma/client";
const root = () => path.join(process.cwd(), ".local", "media");
const s3 = () =>
  new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
  });
export async function storeMedia(user: User, file: File, purpose: string) {
  assert(
    ["post", "message", "avatar", "cover"].includes(purpose),
    400,
    "Invalid upload purpose.",
  );
  assert(
    file.size > 0 &&
      file.size <=
        (purpose === "post" || purpose === "message" ? 10 : 5) * 1024 * 1024,
    400,
    "Upload must be smaller than 10 MB (5 MB for profile images).",
  );
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = await fileTypeFromBuffer(buffer);
  assert(
    type &&
      [
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
        "video/webm",
      ].includes(type.mime),
    400,
    "Use a JPEG, PNG, WebP, MP4 or WebM file.",
  );
  assert(
    !["avatar", "cover"].includes(purpose) || type.mime.startsWith("image/"),
    400,
    "Profile images must be images.",
  );
  const key = token() + "." + type.ext;
  if (process.env.MEDIA_DRIVER === "s3") {
    assert(process.env.S3_BUCKET, 503, "Storage is not configured.");
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: type.mime,
        ServerSideEncryption: "AES256",
      }),
    );
  } else {
    assert(
      process.env.NODE_ENV !== "production",
      503,
      "Configure private object storage for production.",
    );
    await mkdir(root(), { recursive: true, mode: 0o700 });
    await writeFile(path.join(root(), key), buffer, { mode: 0o600 });
  }
  return db.media.create({
    data: {
      ownerId: user.id,
      key,
      mime: type.mime,
      size: file.size,
      purpose,
      processingStatus: "READY",
    },
  });
}
export async function readMedia(id: string, user: User | null) {
  const media = await db.media.findUnique({
    where: { id },
    include: {
      owner: { select: { suspended: true } },
      posts: { include: { post: true } },
      messages: {
        include: { conversation: { include: { participants: true } } },
      },
    },
  });
  assert(media && !media.owner.suspended, 404, "Media not found.");
  let allowed = user?.id === media.ownerId || user?.role === "ADMIN";
  if (!allowed && media.purpose === "avatar")
    allowed =
      !!(await db.user.findFirst({
        where: { avatarId: id, suspended: false },
      })) && (await canViewProfile(media.ownerId, user));
  if (!allowed && media.purpose === "cover")
    allowed =
      !!(await db.creatorProfile.findFirst({
        where: { coverId: id, user: { suspended: false } },
      })) && (await canViewProfile(media.ownerId, user));
  for (const link of media.posts) {
    if (
      link.post.published &&
      !link.post.removed &&
      (await canRead(link.post.authorId, link.post.visibility, user))
    )
      allowed = true;
  }
  if (
    user &&
    media.messages.some((m) =>
      m.conversation.participants.some((p) => p.userId === user.id),
    )
  )
    allowed = true;
  assert(allowed, 403, "This media requires authorized access.");
  assert(
    media.processingStatus === "READY",
    409,
    "This media is still being processed.",
  );
  assert(
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/webm",
    ].includes(media.mime),
    415,
    "Unsupported stored media type.",
  );
  try {
    if (process.env.MEDIA_DRIVER === "s3") {
      const result = await s3().send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: media.key }),
      );
      assert(result.Body, 404, "Media not found.");
      return {
        buffer: Buffer.from(await result.Body.transformToByteArray()),
        mime: media.mime,
      };
    }
    return {
      buffer: await readFile(path.join(root(), media.key)),
      mime: media.mime,
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(404, "Media file unavailable.");
  }
}
