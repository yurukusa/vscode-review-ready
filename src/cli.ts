#!/usr/bin/env node
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

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkDebugStatements,
  checkTodos,
  checkSecrets,
  checkLargeFile,
  checkTestExists,
  checkComplexity,
  CheckResult,
  FileChanges,
} from './checks';
import { getStagedAndUnstagedChanges, getAllProjectFiles } from './gitDiff';

// ── GitHub Actions annotation output ──────────────────────────────────────────

const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

function annotate(result: CheckResult): void {
  if (!IS_GITHUB_ACTIONS) return;
  const level = result.severity === 'error' ? 'error' : result.severity === 'warning' ? 'warning' : 'notice';
  const file = result.file ? `file=${result.file}` : '';
  const line = result.line ? `,line=${result.line}` : '';
  const loc = file ? `${file}${line}` : '';
  const prefix = loc ? `::${level} ${loc}::` : `::${level}::`;
  process.stdout.write(`${prefix}[review-ready/${result.rule}] ${result.message}\n`);
}

function printLocal(result: CheckResult): void {
  const icon = result.severity === 'error' ? '✗' : result.severity === 'warning' ? '⚠' : 'ℹ';
  const loc = result.file ? `  ${result.file}${result.line ? `:${result.line}` : ''}` : '';
  console.log(`  ${icon} [${result.rule}] ${result.message}${loc}`);
}

// ── Configuration from environment variables (for GitHub Action inputs) ────────

function boolEnv(name: string, defaultVal = true): boolean {
  const v = process.env[name];
  if (v === undefined) return defaultVal;
  return v !== 'false' && v !== '0' && v !== 'no';
}

function numEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultVal : n;
}

const config = {
  noDebugStatements: boolEnv('INPUT_NO_DEBUG_STATEMENTS'),
  noTodoInChanges:   boolEnv('INPUT_NO_TODO_IN_CHANGES'),
  noSecrets:         boolEnv('INPUT_NO_SECRETS'),
  noLargeFiles:      boolEnv('INPUT_NO_LARGE_FILES'),
  testCoverage:      boolEnv('INPUT_TEST_COVERAGE'),
  complexity:        boolEnv('INPUT_COMPLEXITY'),
  complexityThreshold: numEnv('INPUT_COMPLEXITY_THRESHOLD', 10),
  // 'fail-on' controls what exit code to use: 'error' (default) | 'warning' | 'never'
  failOn: (process.env['INPUT_FAIL_ON'] ?? 'error') as 'error' | 'warning' | 'never',
};

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const repoRoot = process.env['GITHUB_WORKSPACE'] ?? process.cwd();

  if (!IS_GITHUB_ACTIONS) {
    console.log('\n📋 Review Ready — pre-PR check\n');
  }

  const changedFiles = getStagedAndUnstagedChanges(repoRoot);

  if (changedFiles.length === 0) {
    // In GitHub Actions context, try HEAD diff instead
    if (IS_GITHUB_ACTIONS) {
      const allFiles = gatherGitHubActionFiles(repoRoot);
      if (allFiles.length > 0) {
        runChecksAndReport(allFiles, getAllProjectFiles(repoRoot));
        return;
      }
    }
    console.log('  ✓ No changed files detected');
    process.exit(0);
  }

  const allProjectFiles = getAllProjectFiles(repoRoot);
  runChecksAndReport(changedFiles, allProjectFiles);
}

function gatherGitHubActionFiles(repoRoot: string): FileChanges[] {
  // In GitHub Actions, use GITHUB_BASE_SHA and GITHUB_SHA to get diff
  const baseSha = process.env['GITHUB_BASE_SHA'] ?? 'HEAD~1';
  const headSha = process.env['GITHUB_SHA'] ?? 'HEAD';

  try {
    const diffOutput = execSync(
      `git diff --name-only ${baseSha}..${headSha}`,
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const files = diffOutput.trim().split('\n').filter(Boolean);
    if (files.length === 0) return [];

    const results: FileChanges[] = [];
    for (const filename of files) {
      const fullPath = path.join(repoRoot, filename);
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(fullPath).size; } catch { /* deleted file */ }

      let fileDiff = '';
      try {
        fileDiff = execSync(
          `git diff ${baseSha}..${headSha} -U0 -- "${filename}"`,
          { cwd: repoRoot, encoding: 'utf8' }
        );
      } catch { continue; }

      const { addedLines, addedLineNumbers, isNewFile } = parseDiff(fileDiff);
      results.push({ filename, addedLines, addedLineNumbers, isNewFile, sizeBytes });
    }
    return results;
  } catch {
    return [];
  }
}

function parseDiff(diff: string): { addedLines: string[]; addedLineNumbers: number[]; isNewFile: boolean } {
  const lines = diff.split('\n');
  const addedLines: string[] = [];
  const addedLineNumbers: number[] = [];
  let isNewFile = false;
  let currentNewLine = 0;

  for (const line of lines) {
    if (line.startsWith('new file mode')) { isNewFile = true; continue; }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { currentNewLine = parseInt(hunk[1], 10); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push(line.slice(1));
      addedLineNumbers.push(currentNewLine++);
    } else if (line.startsWith(' ')) {
      currentNewLine++;
    }
  }
  return { addedLines, addedLineNumbers, isNewFile };
}

function runChecksAndReport(changedFiles: FileChanges[], allProjectFiles: Set<string>): void {
  const allResults: CheckResult[] = [];

  for (const file of changedFiles) {
    if (config.noDebugStatements) allResults.push(...checkDebugStatements(file));
    if (config.noTodoInChanges)   allResults.push(...checkTodos(file));
    if (config.noSecrets)         allResults.push(...checkSecrets(file));
    if (config.noLargeFiles)      allResults.push(...checkLargeFile(file));
    if (config.testCoverage)      allResults.push(...checkTestExists(file, allProjectFiles));
    if (config.complexity)        allResults.push(...checkComplexity(file, config.complexityThreshold));
  }

  allResults.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const errors   = allResults.filter(r => r.severity === 'error').length;
  const warnings = allResults.filter(r => r.severity === 'warning').length;
  const infos    = allResults.filter(r => r.severity === 'info').length;

  if (allResults.length === 0) {
    if (IS_GITHUB_ACTIONS) {
      process.stdout.write('::notice::review-ready: All checks passed ✓\n');
    } else {
      console.log('  ✓ All checks passed — ready to review!');
    }
    process.exit(0);
  }

  // Emit annotations or local output
  for (const result of allResults) {
    if (IS_GITHUB_ACTIONS) {
      annotate(result);
    } else {
      printLocal(result);
    }
  }

  if (!IS_GITHUB_ACTIONS) {
    console.log(`\n  ${errors} error(s), ${warnings} warning(s), ${infos} info\n`);
  }

  // Determine exit code
  const shouldFail =
    config.failOn === 'never' ? false :
    config.failOn === 'warning' ? (errors > 0 || warnings > 0) :
    errors > 0; // default: fail only on errors

  process.exit(shouldFail ? 1 : 0);
}

main();
