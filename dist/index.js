#!/usr/bin/env node
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 282:
/***/ ((__unused_webpack_module, exports) => {


// checks.ts — each check is a pure function: (lines, filename) → CheckResult[]
// Why pure functions: easy to test, easy to add/remove checks without side effects
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.checkDebugStatements = checkDebugStatements;
exports.checkTodos = checkTodos;
exports.checkSecrets = checkSecrets;
exports.checkLargeFile = checkLargeFile;
exports.checkTestExists = checkTestExists;
exports.checkComplexity = checkComplexity;
// ── Debug statements ──────────────────────────────────────────────────────────
// Why these patterns: most common debug artifacts across JS/TS/Python/Ruby/Go
const DEBUG_PATTERNS = [
    /\bconsole\.(log|debug|warn|error|trace|dir|table)\s*\(/,
    /\bdebugger\b/,
    /\bprint\s*\(/, // Python
    /\bputs\s/, // Ruby
    /\bfmt\.Print/, // Go
    /\bprintln!\s*\(/, // Rust
    /\bvar_dump\s*\(/, // PHP
    /\bdd\s*\(/, // PHP/Laravel
];
function checkDebugStatements(changes) {
    const results = [];
    changes.addedLines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*'))
            return;
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
function checkTodos(changes) {
    const results = [];
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
const SECRET_PATTERNS = [
    { pattern: /['"][A-Za-z0-9+/]{40,}['"]/, label: 'long base64-like string' },
    { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: 'API key' },
    { pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, label: 'credential' },
    { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/, label: 'AWS access key' },
    { pattern: /ghp_[A-Za-z0-9]{36}/, label: 'GitHub personal access token' },
    { pattern: /sk-[A-Za-z0-9]{48}/, label: 'OpenAI API key' },
    { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
];
function checkSecrets(changes) {
    // Skip test/mock/example files — they legitimately contain fake credentials
    const lowerName = changes.filename.toLowerCase();
    if (lowerName.includes('test') || lowerName.includes('spec') ||
        lowerName.includes('mock') || lowerName.includes('fixture') ||
        lowerName.includes('example') || lowerName.includes('.env.sample') ||
        lowerName.endsWith('.md'))
        return [];
    const results = [];
    changes.addedLines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#'))
            return;
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
function checkLargeFile(changes) {
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
    (f) => f.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
    (f) => f.replace(/\.(ts|tsx|js|jsx)$/, '.spec.$1'),
    (f) => f.replace('/src/', '/tests/').replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
    (f) => f.replace('/src/', '/test/').replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
    // Python conventions — only valid if the transformed name is actually different
    (f) => { const r = f.replace(/\.(py)$/, '_test.$1'); return r !== f ? r : ''; },
    (f) => { const base = f.replace(/.*\//, ''); return f.replace(base, 'test_' + base); },
];
function checkTestExists(changes, allProjectFiles) {
    const ext = '.' + changes.filename.split('.').pop();
    if (!SOURCE_EXTENSIONS.has(ext))
        return [];
    // Skip if this IS a test file
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(changes.filename))
        return [];
    if (/test_\w+\.py$/.test(changes.filename))
        return [];
    if (changes.filename.includes('__tests__'))
        return [];
    // Skip if it's a config, type, index, or declaration file
    const base = changes.filename.split('/').pop() ?? '';
    if (/^(index|types|constants|config|main|app)\.(ts|tsx|js|jsx)$/.test(base))
        return [];
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
function checkComplexity(changes, threshold) {
    const ext = '.' + changes.filename.split('.').pop();
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext))
        return [];
    // Approximate: scan added lines for branch keywords
    // Only meaningful if we added a lot of lines (>20) — small changes are fine
    if (changes.addedLines.length < 20)
        return [];
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
//# sourceMappingURL=checks.js.map

/***/ }),

/***/ 380:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {


// gitDiff.ts — parse `git diff --cached` (staged) + `git diff HEAD` output into FileChanges
// Why HEAD diff: captures both staged and unstaged changes before a PR
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getStagedAndUnstagedChanges = getStagedAndUnstagedChanges;
exports.getAllProjectFiles = getAllProjectFiles;
const child_process_1 = __nccwpck_require__(317);
const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
function getStagedAndUnstagedChanges(repoRoot) {
    const results = [];
    // Get list of changed files from git
    let changedFiles = [];
    try {
        // Staged changes
        const staged = (0, child_process_1.execSync)('git diff --cached --name-only', { cwd: repoRoot, encoding: 'utf8' });
        // Unstaged tracked changes
        const unstaged = (0, child_process_1.execSync)('git diff --name-only', { cwd: repoRoot, encoding: 'utf8' });
        // Untracked new files (not yet staged) — skip, they won't be in a PR anyway
        const allFiles = new Set([
            ...staged.trim().split('\n').filter(Boolean),
            ...unstaged.trim().split('\n').filter(Boolean),
        ]);
        changedFiles = [...allFiles];
    }
    catch {
        return [];
    }
    for (const filename of changedFiles) {
        const fullPath = path.join(repoRoot, filename);
        let sizeBytes = 0;
        try {
            sizeBytes = fs.statSync(fullPath).size;
        }
        catch { /* file deleted, skip size check */ }
        // Get the actual diff for this file
        let diffOutput = '';
        try {
            // Try staged first, fall back to HEAD diff
            diffOutput = (0, child_process_1.execSync)(`git diff --cached -U0 -- "${filename}"`, { cwd: repoRoot, encoding: 'utf8' });
            if (!diffOutput.trim()) {
                diffOutput = (0, child_process_1.execSync)(`git diff -U0 -- "${filename}"`, { cwd: repoRoot, encoding: 'utf8' });
            }
        }
        catch {
            continue;
        }
        const { addedLines, addedLineNumbers, isNewFile } = parseDiffOutput(diffOutput);
        results.push({ filename, addedLines, addedLineNumbers, isNewFile, sizeBytes });
    }
    return results;
}
function parseDiffOutput(diff) {
    const lines = diff.split('\n');
    const addedLines = [];
    const addedLineNumbers = [];
    let isNewFile = false;
    let currentNewLine = 0;
    for (const line of lines) {
        if (line.startsWith('new file mode')) {
            isNewFile = true;
        }
        // Parse hunk header: @@ -old_start,old_count +new_start,new_count @@
        const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
            currentNewLine = parseInt(hunkMatch[1], 10);
            continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
            addedLines.push(line.slice(1)); // strip leading '+'
            addedLineNumbers.push(currentNewLine);
            currentNewLine++;
        }
        else if (line.startsWith(' ')) {
            currentNewLine++; // context line — advance counter but don't record
        }
        // '-' lines: don't advance new line counter
    }
    return { addedLines, addedLineNumbers, isNewFile };
}
function getAllProjectFiles(repoRoot) {
    try {
        const output = (0, child_process_1.execSync)('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
        return new Set(output.trim().split('\n').filter(Boolean));
    }
    catch {
        return new Set();
    }
}
//# sourceMappingURL=gitDiff.js.map

/***/ }),

/***/ 317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it uses a non-standard name for the exports (exports).
(() => {
var exports = __webpack_exports__;

/**
 * cli.ts — standalone CLI runner for Review Ready checks
 * Used by the GitHub Action and local command line.
 *
 * Exit codes:
 *   0 = all checks passed (or only warnings/info)
 *   1 = one or more errors found
 *
 * GitHub Actions annotation format:
 *   ::error file=<path>,line=<n>::<message>
 *   ::warning file=<path>,line=<n>::<message>
 *   ::notice file=<path>,line=<n>::<message>
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
const child_process_1 = __nccwpck_require__(317);
const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const checks_1 = __nccwpck_require__(282);
const gitDiff_1 = __nccwpck_require__(380);
// ── GitHub Actions annotation output ──────────────────────────────────────────
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
function annotate(result) {
    if (!IS_GITHUB_ACTIONS)
        return;
    const level = result.severity === 'error' ? 'error' : result.severity === 'warning' ? 'warning' : 'notice';
    const file = result.file ? `file=${result.file}` : '';
    const line = result.line ? `,line=${result.line}` : '';
    const loc = file ? `${file}${line}` : '';
    const prefix = loc ? `::${level} ${loc}::` : `::${level}::`;
    process.stdout.write(`${prefix}[review-ready/${result.rule}] ${result.message}\n`);
}
function printLocal(result) {
    const icon = result.severity === 'error' ? '✗' : result.severity === 'warning' ? '⚠' : 'ℹ';
    const loc = result.file ? `  ${result.file}${result.line ? `:${result.line}` : ''}` : '';
    console.log(`  ${icon} [${result.rule}] ${result.message}${loc}`);
}
// ── Configuration from environment variables (for GitHub Action inputs) ────────
function boolEnv(name, defaultVal = true) {
    const v = process.env[name];
    if (v === undefined)
        return defaultVal;
    return v !== 'false' && v !== '0' && v !== 'no';
}
function numEnv(name, defaultVal) {
    const v = process.env[name];
    if (!v)
        return defaultVal;
    const n = parseInt(v, 10);
    return isNaN(n) ? defaultVal : n;
}
const config = {
    noDebugStatements: boolEnv('INPUT_NO_DEBUG_STATEMENTS'),
    noTodoInChanges: boolEnv('INPUT_NO_TODO_IN_CHANGES'),
    noSecrets: boolEnv('INPUT_NO_SECRETS'),
    noLargeFiles: boolEnv('INPUT_NO_LARGE_FILES'),
    testCoverage: boolEnv('INPUT_TEST_COVERAGE'),
    complexity: boolEnv('INPUT_COMPLEXITY'),
    complexityThreshold: numEnv('INPUT_COMPLEXITY_THRESHOLD', 10),
    // 'fail-on' controls what exit code to use: 'error' (default) | 'warning' | 'never'
    failOn: (process.env['INPUT_FAIL_ON'] ?? 'error'),
};
// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
    const repoRoot = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
    if (!IS_GITHUB_ACTIONS) {
        console.log('\n📋 Review Ready — pre-PR check\n');
    }
    const changedFiles = (0, gitDiff_1.getStagedAndUnstagedChanges)(repoRoot);
    if (changedFiles.length === 0) {
        // In GitHub Actions context, try HEAD diff instead
        if (IS_GITHUB_ACTIONS) {
            const allFiles = gatherGitHubActionFiles(repoRoot);
            if (allFiles.length > 0) {
                runChecksAndReport(allFiles, (0, gitDiff_1.getAllProjectFiles)(repoRoot));
                return;
            }
        }
        console.log('  ✓ No changed files detected');
        process.exit(0);
    }
    const allProjectFiles = (0, gitDiff_1.getAllProjectFiles)(repoRoot);
    runChecksAndReport(changedFiles, allProjectFiles);
}
function gatherGitHubActionFiles(repoRoot) {
    // In GitHub Actions, use GITHUB_BASE_SHA and GITHUB_SHA to get diff
    const baseSha = process.env['GITHUB_BASE_SHA'] ?? 'HEAD~1';
    const headSha = process.env['GITHUB_SHA'] ?? 'HEAD';
    try {
        const diffOutput = (0, child_process_1.execSync)(`git diff --name-only ${baseSha}..${headSha}`, { cwd: repoRoot, encoding: 'utf8' });
        const files = diffOutput.trim().split('\n').filter(Boolean);
        if (files.length === 0)
            return [];
        const results = [];
        for (const filename of files) {
            const fullPath = path.join(repoRoot, filename);
            let sizeBytes = 0;
            try {
                sizeBytes = fs.statSync(fullPath).size;
            }
            catch { /* deleted file */ }
            let fileDiff = '';
            try {
                fileDiff = (0, child_process_1.execSync)(`git diff ${baseSha}..${headSha} -U0 -- "${filename}"`, { cwd: repoRoot, encoding: 'utf8' });
            }
            catch {
                continue;
            }
            const { addedLines, addedLineNumbers, isNewFile } = parseDiff(fileDiff);
            results.push({ filename, addedLines, addedLineNumbers, isNewFile, sizeBytes });
        }
        return results;
    }
    catch {
        return [];
    }
}
function parseDiff(diff) {
    const lines = diff.split('\n');
    const addedLines = [];
    const addedLineNumbers = [];
    let isNewFile = false;
    let currentNewLine = 0;
    for (const line of lines) {
        if (line.startsWith('new file mode')) {
            isNewFile = true;
            continue;
        }
        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            currentNewLine = parseInt(hunk[1], 10);
            continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
            addedLines.push(line.slice(1));
            addedLineNumbers.push(currentNewLine++);
        }
        else if (line.startsWith(' ')) {
            currentNewLine++;
        }
    }
    return { addedLines, addedLineNumbers, isNewFile };
}
function runChecksAndReport(changedFiles, allProjectFiles) {
    const allResults = [];
    for (const file of changedFiles) {
        if (config.noDebugStatements)
            allResults.push(...(0, checks_1.checkDebugStatements)(file));
        if (config.noTodoInChanges)
            allResults.push(...(0, checks_1.checkTodos)(file));
        if (config.noSecrets)
            allResults.push(...(0, checks_1.checkSecrets)(file));
        if (config.noLargeFiles)
            allResults.push(...(0, checks_1.checkLargeFile)(file));
        if (config.testCoverage)
            allResults.push(...(0, checks_1.checkTestExists)(file, allProjectFiles));
        if (config.complexity)
            allResults.push(...(0, checks_1.checkComplexity)(file, config.complexityThreshold));
    }
    allResults.sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
    });
    const errors = allResults.filter(r => r.severity === 'error').length;
    const warnings = allResults.filter(r => r.severity === 'warning').length;
    const infos = allResults.filter(r => r.severity === 'info').length;
    if (allResults.length === 0) {
        if (IS_GITHUB_ACTIONS) {
            process.stdout.write('::notice::review-ready: All checks passed ✓\n');
        }
        else {
            console.log('  ✓ All checks passed — ready to review!');
        }
        process.exit(0);
    }
    // Emit annotations or local output
    for (const result of allResults) {
        if (IS_GITHUB_ACTIONS) {
            annotate(result);
        }
        else {
            printLocal(result);
        }
    }
    if (!IS_GITHUB_ACTIONS) {
        console.log(`\n  ${errors} error(s), ${warnings} warning(s), ${infos} info\n`);
    }
    // Determine exit code
    const shouldFail = config.failOn === 'never' ? false :
        config.failOn === 'warning' ? (errors > 0 || warnings > 0) :
            errors > 0; // default: fail only on errors
    process.exit(shouldFail ? 1 : 0);
}
main();
//# sourceMappingURL=cli.js.map
})();

module.exports = __webpack_exports__;
/******/ })()
;