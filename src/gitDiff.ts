// gitDiff.ts — parse `git diff --cached` (staged) + `git diff HEAD` output into FileChanges
// Why HEAD diff: captures both staged and unstaged changes before a PR

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { FileChanges } from './checks';

export function getStagedAndUnstagedChanges(repoRoot: string): FileChanges[] {
  const results: FileChanges[] = [];

  // Get list of changed files from git
  let changedFiles: string[] = [];
  try {
    // Staged changes
    const staged = execSync('git diff --cached --name-only', { cwd: repoRoot, encoding: 'utf8' });
    // Unstaged tracked changes
    const unstaged = execSync('git diff --name-only', { cwd: repoRoot, encoding: 'utf8' });
    // Untracked new files (not yet staged) — skip, they won't be in a PR anyway
    const allFiles = new Set([
      ...staged.trim().split('\n').filter(Boolean),
      ...unstaged.trim().split('\n').filter(Boolean),
    ]);
    changedFiles = [...allFiles];
  } catch {
    return [];
  }

  for (const filename of changedFiles) {
    const fullPath = path.join(repoRoot, filename);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(fullPath).size;
    } catch { /* file deleted, skip size check */ }

    // Get the actual diff for this file
    let diffOutput = '';
    try {
      // Try staged first, fall back to HEAD diff
      diffOutput = execSync(
        `git diff --cached -U0 -- "${filename}"`,
        { cwd: repoRoot, encoding: 'utf8' }
      );
      if (!diffOutput.trim()) {
        diffOutput = execSync(
          `git diff -U0 -- "${filename}"`,
          { cwd: repoRoot, encoding: 'utf8' }
        );
      }
    } catch { continue; }

    const { addedLines, addedLineNumbers, isNewFile } = parseDiffOutput(diffOutput);

    results.push({ filename, addedLines, addedLineNumbers, isNewFile, sizeBytes });
  }

  return results;
}

interface ParsedDiff {
  addedLines: string[];
  addedLineNumbers: number[];
  isNewFile: boolean;
}

function parseDiffOutput(diff: string): ParsedDiff {
  const lines = diff.split('\n');
  const addedLines: string[] = [];
  const addedLineNumbers: number[] = [];
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
      addedLines.push(line.slice(1));  // strip leading '+'
      addedLineNumbers.push(currentNewLine);
      currentNewLine++;
    } else if (line.startsWith(' ')) {
      currentNewLine++;  // context line — advance counter but don't record
    }
    // '-' lines: don't advance new line counter
  }

  return { addedLines, addedLineNumbers, isNewFile };
}

export function getAllProjectFiles(repoRoot: string): Set<string> {
  try {
    const output = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}
