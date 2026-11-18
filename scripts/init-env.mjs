import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
const file = path.resolve(import.meta.dirname, "..", ".env");
if (!existsSync(file)) {
  writeFileSync(
    file,
    `DATABASE_URL="postgresql://followersonly@127.0.0.1:55439/followersonly?schema=public"\nAPP_URL="http://127.0.0.1:3100"\nPAYMENT_MODE="sandbox"\nPAYMENT_WEBHOOK_SECRET="${randomBytes(32).toString("hex")}"\nMEDIA_DRIVER="local"\nMAIL_MODE="local"\n`,
    { mode: 0o600 },
  );
  console.log("Created local .env with a random sandbox signing key.");
} else {
  chmodSync(file, 0o600);
  console.log("Preserved existing .env.");
}
