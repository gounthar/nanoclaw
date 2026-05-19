// Bootstrap a v2 NanoClaw session workspace for the riscv64 smoke test.
//
// The v2 agent-runner does all IO through two SQLite session DBs and no
// longer reads stdin. It expects the host to have created /workspace
// before the container starts:
//
//   inbound.db            host-owned, container opens READ-ONLY
//   outbound.db           container-owned
//   agent/container.json  per-group config (optional; defaults apply)
//
// SQLite's readonly open of a missing inbound.db throws SQLITE_CANTOPEN
// ("unable to open database file"), so the smoke test must create both
// files first. The schema is taken verbatim from the upstream host-side
// definitions (src/db/schema.ts) so this stays in lock-step with upstream
// instead of drifting from a hand-copied schema. The DBs are built with
// the image's own better-sqlite3 so the native binding is the real
// riscv64 build that the container will use.
//
// Usage: node bootstrap-session-dbs.mjs <schema.ts path> <workspace dir>

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

// Resolve better-sqlite3 from the image's app install (/app/package.json),
// not from this script's location.
const require = createRequire('/app/package.json');
const Database = require('better-sqlite3');

const [, , schemaPath, workDir] = process.argv;
if (!schemaPath || !workDir) {
  console.error('usage: bootstrap-session-dbs.mjs <schema.ts> <workDir>');
  process.exit(2);
}

const src = readFileSync(schemaPath, 'utf8');

// The schema constants are exported as backtick template literals whose
// bodies contain no backticks, so a non-greedy match to the closing `;
// is safe.
function extract(name) {
  const m = src.match(new RegExp('export const ' + name + ' = `([\\s\\S]*?)`;'));
  if (!m) {
    console.error(`could not find ${name} in ${schemaPath}`);
    process.exit(3);
  }
  return m[1];
}

const schemas = {
  'inbound.db': extract('INBOUND_SCHEMA'),
  'outbound.db': extract('OUTBOUND_SCHEMA'),
};

mkdirSync(path.join(workDir, 'agent'), { recursive: true });
writeFileSync(path.join(workDir, 'agent', 'container.json'), '{"provider":"claude"}\n');

for (const [file, schema] of Object.entries(schemas)) {
  const db = new Database(path.join(workDir, file));
  // Match the host: ensureSchema() sets journal_mode = DELETE before
  // applying the schema (WAL's -shm is not coherent across a host/guest
  // mount boundary).
  db.pragma('journal_mode = DELETE');
  db.exec(schema);
  db.close();
  console.error(`bootstrapped ${file}`);
}

console.error('session workspace ready');
