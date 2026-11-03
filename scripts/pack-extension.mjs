#!/usr/bin/env node
// Build the Chrome Web Store zip: dist/flipledger-extension-<version>.zip.
// Leaves out tests and the .md docs, and drops the localhost / 127.0.0.1 entries from the
// manifest (they're only for local development, and reviewers flag hosts we don't need).
// Bump "version" in extension/manifest.json before packing an update; the store rejects
// a version it has already seen.
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const src = join(root, "extension")
const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"))

const isLocal = (pattern) => /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(pattern)
manifest.host_permissions = manifest.host_permissions.filter((p) => !isLocal(p))
for (const script of manifest.content_scripts) script.matches = script.matches.filter((p) => !isLocal(p))

const stage = mkdtempSync(join(tmpdir(), "flipledger-ext-"))
cpSync(src, stage, { recursive: true, filter: (path) => !/\.test\.ts$|\.md$|\.DS_Store$/.test(path) })
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")

const outDir = join(root, "dist")
const out = join(outDir, `flipledger-extension-${manifest.version}.zip`)
mkdirSync(outDir, { recursive: true })
rmSync(out, { force: true })
// Zip from inside the folder so manifest.json sits at the top of the zip, as the store requires.
const zip = spawnSync("zip", ["-qr", out, "."], { cwd: stage, stdio: "inherit" })
rmSync(stage, { recursive: true, force: true })
if (zip.status !== 0) process.exit(zip.status ?? 1)
console.log(`Packed ${out}`)
