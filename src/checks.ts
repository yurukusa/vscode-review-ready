// checks.ts — each check is a pure function: (lines, filename) → CheckResult[]
// Why pure functions: easy to test, easy to add/remove checks without side effects

export interface CheckResult {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  file?: string;
}

export interface FileChanges {
  filename: string;
  addedLines: string[];           // only added/modified lines (from git diff)
  addedLineNumbers: number[];     // line numbers corresponding to addedLines
  isNewFile: boolean;
  sizeBytes: number;
}

// ── Debug statements ──────────────────────────────────────────────────────────
// Why these patterns: most common debug artifacts across JS/TS/Python/Ruby/Go
const DEBUG_PATTERNS: RegExp[] = [
  /\bconsole\.(log|debug|warn|error|trace|dir|table)\s*\(/,
  /\bdebugger\b/,
  /\bprint\s*\(/,          // Python
  /\bputs\s/,              // Ruby
  /\bfmt\.Print/,          // Go
  /\bprintln!\s*\(/,       // Rust
  /\bvar_dump\s*\(/,       // PHP
  /\bdd\s*\(/,             // PHP/Laravel
];

export function checkDebugStatements(changes: FileChanges): CheckResult[] {
  const results: CheckResult[] = [];
  changes.addedLines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;
    for (const pattern of DEBUG_PATTERNS) {
      if (pattern.test(line)) {
        results.push({
          rule: 'no-debug-statements',
          severity: 'error',
          message: `Debug statement found: ${line.trim()}`,
          line: changes.addedLineNumbers[idx],
          file: changes.filename,
        });
        break;
      }
    }
  });
  return results;
}

// ── TODO/FIXME/HACK in changed lines ─────────────────────────────────────────
// Why: new TODOs added in a PR signal incomplete work; old ones are acceptable
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|TEMP|WTF|BUG)[\s:]/i;

export function checkTodos(changes: FileChanges): CheckResult[] {
  const results: CheckResult[] = [];
  changes.addedLines.forEach((line, idx) => {
    if (TODO_PATTERN.test(line)) {
      results.push({
        rule: 'no-todo-in-changes',
        severity: 'warning',
        message: `Unresolved marker in new code: ${line.trim()}`,
        line: changes.addedLineNumbers[idx],
        file: changes.filename,
      });
    }
  });
  return results;
}

// ── Secret/credential detection ───────────────────────────────────────────────
// Why these patterns: catches the most common accidental credential leaks
// Intentionally conservative — false positives are better than missed secrets
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /['"][A-Za-z0-9+/]{40,}['"]/, label: 'long base64-like string' },
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: 'API key' },
  { pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, label: 'credential' },
  { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/, label: 'AWS access key' },
  { pattern: /ghp_[A-Za-z0-9]{36}/, label: 'GitHub personal access token' },
  { pattern: /sk-[A-Za-z0-9]{48}/, label: 'OpenAI API key' },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
];

export function checkSecrets(changes: FileChanges): CheckResult[] {
  // Skip test/mock/example files — they legitimately contain fake credentials
  const lowerName = changes.filename.toLowerCase();
  if (
    lowerName.includes('test') || lowerName.includes('spec') ||
    lowerName.includes('mock') || lowerName.includes('fixture') ||
    lowerName.includes('example') || lowerName.includes('.env.sample') ||
    lowerName.endsWith('.md')
  ) return [];

  const results: CheckResult[] = [];
  changes.addedLines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) return;
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        results.push({
          rule: 'no-secrets',
          severity: 'error',
          message: `Possible ${label} detected`,
          line: changes.addedLineNumbers[idx],
          file: changes.filename,
        });
        break;
      }
    }
  });
  return results;
}

// ── Large file check ──────────────────────────────────────────────────────────
const LARGE_FILE_THRESHOLD = 500 * 1024; // 500 KB

export function checkLargeFile(changes: FileChanges): CheckResult[] {
  if (changes.sizeBytes > LARGE_FILE_THRESHOLD) {
    return [{
      rule: 'no-large-files',
      severity: 'warning',
      message: `File is ${(changes.sizeBytes / 1024).toFixed(0)} KB — is this intentional?`,
      file: changes.filename,
    }];
  }
  return [];
}

// ── Test coverage heuristic ───────────────────────────────────────────────────
// Why heuristic: we can't run tests, but we can check if a test file exists
// Only flags source files that look like they should have tests
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.java']);
const TEST_NAMING_CONVENTIONS = [
  (f: string) => f.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
  (f: string) => f.replace(/\.(ts|tsx|js|jsx)$/, '.spec.$1'),
  (f: string) => f.replace('/src/', '/tests/').replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
  (f: string) => f.replace('/src/', '/test/').replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
  // Python conventions — only valid if the transformed name is actually different
  (f: string) => { const r = f.replace(/\.(py)$/, '_test.$1'); return r !== f ? r : ''; },
  (f: string) => { const base = f.replace(/.*\//, ''); return f.replace(base, 'test_' + base); },
];

export function checkTestExists(
  changes: FileChanges,
  allProjectFiles: Set<string>
): CheckResult[] {
  const ext = '.' + changes.filename.split('.').pop();
  if (!SOURCE_EXTENSIONS.has(ext)) return [];

  // Skip if this IS a test file
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(changes.filename)) return [];
  if (/test_\w+\.py$/.test(changes.filename)) return [];
  if (changes.filename.includes('__tests__')) return [];

  // Skip if it's a config, type, index, or declaration file
  const base = changes.filename.split('/').pop() ?? '';
  if (/^(index|types|constants|config|main|app)\.(ts|tsx|js|jsx)$/.test(base)) return [];

  const hasTest = TEST_NAMING_CONVENTIONS.some(fn => allProjectFiles.has(fn(changes.filename)));
  if (!hasTest) {
    return [{
      rule: 'test-file-exists',
      severity: 'info',
      message: `No test file found for ${base}`,
      file: changes.filename,
    }];
  }
  return [];
}

// ── Cyclomatic complexity (JS/TS only, quick heuristic) ───────────────────────
// Why heuristic: real CC requires AST parsing; this approximates via branch-counting
// False positive rate is acceptable — the goal is to flag obvious complexity spikes
const BRANCH_KEYWORDS = /\b(if|else if|while|for|case|catch|\?\s*[^:]+:|\&\&|\|\|)\b/g;

export function checkComplexity(
  changes: FileChanges,
  threshold: number
): CheckResult[] {
  const ext = '.' + changes.filename.split('.').pop();
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return [];

  // Approximate: scan added lines for branch keywords
  // Only meaningful if we added a lot of lines (>20) — small changes are fine
  if (changes.addedLines.length < 20) return [];

  const fullText = changes.addedLines.join('\n');
  const matches = fullText.match(BRANCH_KEYWORDS);
  const approxCC = (matches?.length ?? 0) + 1;

  if (approxCC > threshold) {
    return [{
      rule: 'complexity-threshold',
      severity: 'warning',
      message: `New code has high apparent complexity (~${approxCC} branches) — consider breaking it up`,
      file: changes.filename,
    }];
  }
  return [];
}
