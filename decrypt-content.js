#!/usr/bin/env node
/* ============================================================================
 * decrypt-content.js — a small local-only tool for decrypting an ENCRYPTED
 * content.js export (see the "Access code" field in admin.html) back to
 * plain JSON, so it can be validated with test.js / diffed / inspected
 * before deploying it.
 *
 * This file is never loaded by the game or the editor — it's not referenced
 * from index.html or admin.html at all, purely a helper for whoever's
 * pushing deploys (see README.md's "Access code" section).
 *
 * Usage:
 *   node decrypt-content.js <path-to-encrypted-content.js> <code> [out.json]
 *
 * With no output path, prints the decrypted JSON to stdout.
 * ========================================================================== */

const fs = require("fs");
const path = require("path");
const L = require("./app.js");

async function main() {
  const [, , inputPath, code, outPath] = process.argv;
  if (!inputPath || !code) {
    console.error("Usage: node decrypt-content.js <path-to-encrypted-content.js> <code> [out.json]");
    process.exit(1);
  }

  const mod = require(path.resolve(inputPath));
  if (!mod || !mod.encrypted) {
    console.error("That file doesn't look encrypted (no `encrypted: true` in its module.exports) — " +
                   "is this already a plain content.js? If so, just require() it directly, no decryption needed.");
    process.exit(1);
  }

  let plaintext;
  try {
    plaintext = await L.decryptWithCode(mod, code);
  } catch (e) {
    console.error("Decryption failed — almost certainly the wrong code.");
    process.exit(1);
  }

  const data = JSON.parse(plaintext);
  const out = JSON.stringify(data, null, 2);

  if (outPath) {
    fs.writeFileSync(outPath, out);
    console.error(`Decrypted ${data.stops.length} tasks to ${outPath}`);
  } else {
    console.log(out);
  }
}

main();
