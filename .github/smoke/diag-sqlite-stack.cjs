// Diagnostic preload for the riscv64 smoke test ONLY.
//
// The v2 agent-runner's index.ts catches startup failures with
// `main().catch(err => log(err.message))` — it logs the message but not
// the stack, so a better-sqlite3 bind error ("Too many parameter values
// were provided") gives no file or line. This preload wraps
// better-sqlite3 statement methods to print the offending SQL and a full
// stack to stderr before rethrowing, so the failing statement can be
// pinpointed from the workflow log.
//
// Loaded via NODE_OPTIONS=--require. It resolves better-sqlite3 from the
// image's /app install and patches the shared prototype, so the ESM app
// (which imports the same cached module) sees the patched methods. No
// change to the app or to the riscv64 overlay surface.

const { createRequire } = require('module');

let Database;
try {
  Database = createRequire('/app/package.json')('better-sqlite3');
} catch (e) {
  console.error('[diag] better-sqlite3 not loadable: ' + (e && e.message));
  return;
}

const origPrepare = Database.prototype.prepare;
Database.prototype.prepare = function patchedPrepare() {
  const stmt = origPrepare.apply(this, arguments);
  const sql = arguments && arguments[0];
  for (const m of ['run', 'get', 'all', 'iterate']) {
    if (typeof stmt[m] !== 'function') continue;
    const orig = stmt[m];
    stmt[m] = function tracedMethod() {
      try {
        return orig.apply(stmt, arguments);
      } catch (err) {
        console.error(
          '[diag] better-sqlite3 .' + m + '() threw\n' +
          '[diag] SQL: ' + String(sql).replace(/\s+/g, ' ').slice(0, 400) + '\n' +
          '[diag] argc=' + arguments.length + '\n' +
          '[diag] stack:\n' + ((err && err.stack) || String(err)),
        );
        throw err;
      }
    };
  }
  return stmt;
};

console.error('[diag] better-sqlite3 stack tracer armed');
