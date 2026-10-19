#!/usr/bin/env node
// Apply pending supabase/migrations to the production database before `next build`.
// Runs from vercel.json's buildCommand. Production deploys only: preview builds share
// the same database, so they skip (pass --force to run anyway). A failed migration
// fails the deploy, so code that needs new tables never goes live without them.
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const force = args.includes("--force")
const passThrough = args.filter((a) => a !== "--force") // e.g. --dry-run

const env = process.env.VERCEL_ENV
if (env && env !== "production" && !force) {
  console.log(`[migrate] Skipping: VERCEL_ENV=${env} (migrations only run on production deploys).`)
  process.exit(0)
}
if (!env && !force) {
  console.log("[migrate] Skipping: not a Vercel build. Use `npm run db:migrate -- --force` to run by hand.")
  process.exit(0)
}

// SUPABASE_DB_URL overrides; otherwise the Vercel Supabase integration's session-mode URL.
// (The transaction pooler on :6543 can't run migrations.)
const raw = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL_NON_POOLING
if (!raw) {
  console.error(
    "[migrate] No database URL. Set SUPABASE_DB_URL, or connect the Supabase integration (POSTGRES_URL_NON_POOLING).",
  )
  process.exit(1)
}

// The integration appends extra query params (e.g. `supa=`) that Postgres would reject
// as runtime settings. Keep only sslmode.
let dbUrl
try {
  const u = new URL(raw)
  const sslmode = u.searchParams.get("sslmode") ?? (["localhost", "127.0.0.1"].includes(u.hostname) ? "disable" : "require")
  u.search = ""
  u.searchParams.set("sslmode", sslmode)
  dbUrl = u.toString()
  console.log(`[migrate] Pushing migrations to ${u.hostname}:${u.port || 5432}${u.pathname}`)
} catch {
  console.error("[migrate] Database URL is not a valid connection string.")
  process.exit(1)
}

const res = spawnSync("npx", ["--no-install", "supabase", "db", "push", "--db-url", dbUrl, "--yes", ...passThrough], {
  stdio: "inherit",
})
if (res.status !== 0) {
  console.error("[migrate] Migration failed; stopping the deploy so the app doesn't run against an old schema.")
  process.exit(res.status ?? 1)
}
console.log("[migrate] Database is up to date.")
