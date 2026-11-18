import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, ".local", "postgres");
const port = process.env.LOCAL_DB_PORT ?? "55439";
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...options });
  if (r.error) throw r.error;
  if (r.status) process.exit(r.status);
  return r;
}
if (process.argv[2] === "stop") {
  if (existsSync(dir)) run("pg_ctl", ["-D", dir, "stop", "-m", "fast"]);
  process.exit(0);
}
mkdirSync(path.join(root, ".local"), { recursive: true, mode: 0o700 });
if (!existsSync(path.join(dir, "PG_VERSION")))
  run("initdb", [
    "-D",
    dir,
    "-A",
    "trust",
    "-U",
    "followersonly",
    "--no-locale",
    "--encoding=UTF8",
  ]);
if (
  spawnSync("pg_ctl", ["-D", dir, "status"], { stdio: "ignore" }).status !== 0
)
  run("pg_ctl", [
    "-D",
    dir,
    "-l",
    path.join(root, ".local", "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k /tmp`,
    "start",
  ]);
const query = spawnSync(
  "psql",
  [
    "-h",
    "127.0.0.1",
    "-p",
    port,
    "-U",
    "followersonly",
    "-d",
    "postgres",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname='followersonly'",
  ],
  { encoding: "utf8" },
);
if (query.status !== 0)
  throw new Error("Could not inspect the project-local database.");
if (query.stdout.trim() !== "1")
  run("createdb", [
    "-h",
    "127.0.0.1",
    "-p",
    port,
    "-U",
    "followersonly",
    "followersonly",
  ]);
console.log(
  `FollowersOnly development database is available on 127.0.0.1:${port}. Trust authentication is for local development only.`,
);
