// extension.ts — VS Code extension entry point
// "Review Ready" — catches debug statements, secrets, TODO debt, and complexity
// before your PR hits the reviewer's eyes.

import * as vscode from 'vscode';
import * as path from 'path';
import {
  CheckResult,
  checkDebugStatements,
  checkTodos,
  checkSecrets,
  checkLargeFile,
  checkTestExists,
  checkComplexity,
} from './checks';
import { getStagedAndUnstagedChanges, getAllProjectFiles } from './gitDiff';

// ── Tree view item ────────────────────────────────────────────────────────────

class ResultItem extends vscode.TreeItem {
  constructor(
    public readonly result: CheckResult,
    public readonly collapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(result.message, collapsibleState);
    this.tooltip = `${result.file ?? ''}${result.line ? `:${result.line}` : ''}`;
    this.iconPath = new vscode.ThemeIcon(
      result.severity === 'error' ? 'error' :
      result.severity === 'warning' ? 'warning' : 'info'
    );
    if (result.file && result.line) {
      this.command = {
        command: 'reviewReady.openFile',
        title: 'Open',
        arguments: [result.file, result.line],
      };
    }
    this.description = result.file
      ? `${path.basename(result.file ?? '')}${result.line ? `:${result.line}` : ''}`
      : '';
  }
}

class SummaryItem extends vscode.TreeItem {
  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

// ── Tree data provider ────────────────────────────────────────────────────────

class ReviewReadyProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private results: CheckResult[] = [];
  private lastRunLabel = 'Not yet run — click ✓ in Source Control';

  setResults(results: CheckResult[], label: string) {
    this.results = results;
    this.lastRunLabel = label;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.results.length === 0) {
      return [new SummaryItem(this.lastRunLabel, 'check')];
    }
    const errors = this.results.filter(r => r.severity === 'error');
    const warnings = this.results.filter(r => r.severity === 'warning');
    const infos = this.results.filter(r => r.severity === 'info');

    const summary = new SummaryItem(
      `${errors.length} errors · ${warnings.length} warnings · ${infos.length} info`,
      errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass'
    );

    return [summary, ...this.results.map(r => new ResultItem(r))];
  }
}

// ── Main check runner ─────────────────────────────────────────────────────────

async function runChecks(
  provider: ReviewReadyProvider,
  statusBar: vscode.StatusBarItem
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Review Ready: No workspace folder open.');
    return;
  }

  const repoRoot = workspaceFolders[0].uri.fsPath;
  const config = vscode.workspace.getConfiguration('reviewReady');
  const complexityThreshold = config.get<number>('complexity.threshold', 10);

  statusBar.text = '$(sync~spin) Review Ready: checking…';
  statusBar.show();

  // Run in a microtask so the UI updates before the sync work starts
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  const changedFiles = getStagedAndUnstagedChanges(repoRoot);
  const allFiles = getAllProjectFiles(repoRoot);

  if (changedFiles.length === 0) {
    provider.setResults([], 'No changed files detected');
    statusBar.text = '$(check) Review Ready: no changes';
    return;
  }

  const allResults: CheckResult[] = [];

  for (const file of changedFiles) {
    if (config.get<boolean>('checks.noDebugStatements', true)) {
      allResults.push(...checkDebugStatements(file));
    }
    if (config.get<boolean>('checks.noTodoInChanges', true)) {
      allResults.push(...checkTodos(file));
    }
    if (config.get<boolean>('checks.noSecrets', true)) {
      allResults.push(...checkSecrets(file));
    }
    if (config.get<boolean>('checks.noLargeFiles', true)) {
      allResults.push(...checkLargeFile(file));
    }
    if (config.get<boolean>('checks.testCoverage', true)) {
      allResults.push(...checkTestExists(file, allFiles));
    }
    if (config.get<boolean>('checks.complexity', true)) {
      allResults.push(...checkComplexity(file, complexityThreshold));
    }
  }

  // Sort: errors first, then warnings, then info
  allResults.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const errors = allResults.filter(r => r.severity === 'error').length;
  const warnings = allResults.filter(r => r.severity === 'warning').length;

  const timeLabel = new Date().toLocaleTimeString();
  provider.setResults(allResults, `Last checked: ${timeLabel}`);

  if (errors > 0) {
    statusBar.text = `$(error) Review Ready: ${errors} error${errors > 1 ? 's' : ''}`;
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (warnings > 0) {
    statusBar.text = `$(warning) Review Ready: ${warnings} warning${warnings > 1 ? 's' : ''}`;
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBar.text = '$(pass) Review Ready: looks good!';
    statusBar.backgroundColor = undefined;
  }
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const provider = new ReviewReadyProvider();
  const treeView = vscode.window.createTreeView('reviewReady.results', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'reviewReady.check';
  statusBar.text = '$(checklist) Review Ready';
  statusBar.tooltip = 'Click to check your changes before opening a PR';
  statusBar.show();

  context.subscriptions.push(
    vscode.commands.registerCommand('reviewReady.check', () => runChecks(provider, statusBar)),
    vscode.commands.registerCommand('reviewReady.checkFile', () => runChecks(provider, statusBar)),
    vscode.commands.registerCommand('reviewReady.openFile', async (file: string, line: number) => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return;
      const fullPath = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, file));
      const doc = await vscode.workspace.openTextDocument(fullPath);
      const editor = await vscode.window.showTextDocument(doc);
      const pos = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    }),
    statusBar,
    treeView,
  );

  // Auto-run when SCM changes (user stages/unstages files)
  const scmWatcher = vscode.workspace.createFileSystemWatcher('**/.git/index');
  scmWatcher.onDidChange(() => runChecks(provider, statusBar));
  context.subscriptions.push(scmWatcher);
}

export function deactivate() {}
