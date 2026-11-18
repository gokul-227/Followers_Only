import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { db } from "./db";
import { hash, token, HttpError } from "./security";
export async function sendAccountMail(
  userId: string,
  email: string,
  purpose: "verify" | "reset",
) {
  const value = token();
  await db.accountToken.create({
    data: {
      userId,
      tokenHash: hash(value),
      purpose,
      expiresAt: new Date(
        Date.now() + (purpose === "reset" ? 3600000 : 86400000),
      ),
    },
  });
  const url = `${process.env.APP_URL}/${purpose === "reset" ? "reset-password" : "verify-email"}?token=${value}`;
  const text = `FollowersOnly: ${purpose === "reset" ? "Reset your password" : "Verify your email"}\n\n${url}\n\nIf you did not request this, ignore this message.`;
  if (process.env.MAIL_MODE === "smtp") {
    if (!process.env.SMTP_URL)
      throw new HttpError(503, "Email delivery is not configured.");
    await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: `FollowersOnly ${purpose === "reset" ? "password recovery" : "email verification"}`,
      text,
    });
  } else {
    if (process.env.NODE_ENV === "production")
      throw new HttpError(503, "Production email delivery is not configured.");
    const dir = path.join(process.cwd(), ".local", "mail");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dir, `${Date.now()}-${purpose}-${userId}.txt`),
      `To: ${email}\n${text}`,
      { mode: 0o600 },
    );
  }
}
