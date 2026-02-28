// checks.test.ts — unit tests for all check functions (no VS Code dependency needed)
// Run with: npx ts-node src/checks.test.ts

import {
  checkDebugStatements,
  checkTodos,
  checkSecrets,
  checkLargeFile,
  checkTestExists,
  checkComplexity,
  FileChanges,
} from './checks';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function makeChanges(overrides: Partial<FileChanges>): FileChanges {
  return {
    filename: 'src/foo.ts',
    addedLines: [],
    addedLineNumbers: [],
    isNewFile: false,
    sizeBytes: 1000,
    ...overrides,
  };
}

// ── checkDebugStatements ──────────────────────────────────────────────────────
console.log('\n[checkDebugStatements]');

{
  const r = checkDebugStatements(makeChanges({ addedLines: ['console.log("hello")'], addedLineNumbers: [5] }));
  assert(r.length === 1, 'detects console.log');
  assert(r[0].severity === 'error', 'severity is error');
  assert(r[0].line === 5, 'correct line number');
}
{
  const r = checkDebugStatements(makeChanges({ addedLines: ['  debugger;'], addedLineNumbers: [10] }));
  assert(r.length === 1, 'detects debugger');
}
{
  const r = checkDebugStatements(makeChanges({ addedLines: ['// console.log("commented out")'], addedLineNumbers: [1] }));
  assert(r.length === 0, 'ignores commented-out debug');
}
{
  const r = checkDebugStatements(makeChanges({ addedLines: ['const x = logger.log("info")'], addedLineNumbers: [1] }));
  assert(r.length === 0, 'ignores logger.log (not console.log)');
}
{
  const r = checkDebugStatements(makeChanges({ addedLines: ['print("debug")'], addedLineNumbers: [1] }));
  assert(r.length === 1, 'detects Python print()');
}

// ── checkTodos ────────────────────────────────────────────────────────────────
console.log('\n[checkTodos]');

{
  const r = checkTodos(makeChanges({ addedLines: ['// TODO: fix this later'], addedLineNumbers: [3] }));
  assert(r.length === 1, 'detects TODO');
  assert(r[0].severity === 'warning', 'severity is warning');
}
{
  const r = checkTodos(makeChanges({ addedLines: ['// FIXME: broken'], addedLineNumbers: [1] }));
  assert(r.length === 1, 'detects FIXME');
}
{
  const r = checkTodos(makeChanges({ addedLines: ['const todos = [];'], addedLineNumbers: [1] }));
  assert(r.length === 0, 'ignores "todos" variable name');
}

// ── checkSecrets ──────────────────────────────────────────────────────────────
console.log('\n[checkSecrets]');

{
  const r = checkSecrets(makeChanges({ addedLines: ['const apiKey = "sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234y";'], addedLineNumbers: [1] }));
  assert(r.length === 1, 'detects OpenAI-style API key');
}
{
  const r = checkSecrets(makeChanges({ addedLines: ['aws_access_key_id = AKIAIOSFODNN7EXAMPLE'], addedLineNumbers: [1] }));
  assert(r.length === 1, 'detects AWS access key');
}
{
  // Test files should be ignored
  const r = checkSecrets(makeChanges({
    filename: 'src/auth.test.ts',
    addedLines: ['const fakeKey = "sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234y";'],
    addedLineNumbers: [1],
  }));
  assert(r.length === 0, 'ignores test files');
}
{
  const r = checkSecrets(makeChanges({ addedLines: ['const name = "Alice";'], addedLineNumbers: [1] }));
  assert(r.length === 0, 'ignores normal strings');
}

// ── checkLargeFile ────────────────────────────────────────────────────────────
console.log('\n[checkLargeFile]');

{
  const r = checkLargeFile(makeChanges({ sizeBytes: 600 * 1024 }));
  assert(r.length === 1, 'flags file over 500KB');
  assert(r[0].severity === 'warning', 'severity is warning');
}
{
  const r = checkLargeFile(makeChanges({ sizeBytes: 100 * 1024 }));
  assert(r.length === 0, 'ignores small files');
}

// ── checkTestExists ───────────────────────────────────────────────────────────
console.log('\n[checkTestExists]');

{
  const files = new Set(['src/foo.ts', 'src/foo.test.ts']);
  const r = checkTestExists(makeChanges({ filename: 'src/foo.ts' }), files);
  assert(r.length === 0, 'no warning when test file exists');
}
{
  const files = new Set(['src/foo.ts']);
  const r = checkTestExists(makeChanges({ filename: 'src/foo.ts' }), files);
  assert(r.length === 1, 'warns when no test file');
  assert(r[0].severity === 'info', 'severity is info');
}
{
  // index.ts should not require a test
  const files = new Set(['src/index.ts']);
  const r = checkTestExists(makeChanges({ filename: 'src/index.ts' }), files);
  assert(r.length === 0, 'ignores index.ts');
}
{
  // test files don't need a test file themselves
  const files = new Set(['src/foo.test.ts']);
  const r = checkTestExists(makeChanges({ filename: 'src/foo.test.ts' }), files);
  assert(r.length === 0, 'test files are excluded');
}

// ── checkComplexity ───────────────────────────────────────────────────────────
console.log('\n[checkComplexity]');

{
  // Short additions should not trigger complexity check
  const lines = Array(10).fill('const x = 1;');
  const r = checkComplexity(makeChanges({ addedLines: lines, addedLineNumbers: lines.map((_,i)=>i) }), 10);
  assert(r.length === 0, 'ignores small additions (<20 lines)');
}
{
  // Many branches in a large addition should trigger
  const branches = Array(25).fill('if (x) { } else if (y) { } && a || b');
  const r = checkComplexity(makeChanges({ addedLines: branches, addedLineNumbers: branches.map((_,i)=>i) }), 5);
  assert(r.length === 1, 'flags high-complexity additions');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
