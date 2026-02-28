# Review Ready

**Pre-PR checklist that catches the small things before your reviewer does.**

Review Ready scans your git changes and flags issues before you open a pull request — no CI needed, no setup required.

**[→ Try the live demo](https://yurukusa.github.io/vscode-review-ready/)** — paste code, see results instantly.

![Status bar showing Review Ready: 2 errors](https://github.com/yurukusa/vscode-review-ready/raw/main/images/icon.png)

## What it checks

| Check | What it catches |
|-------|----------------|
| **Debug statements** | `console.log`, `debugger`, `print()`, `puts`, `fmt.Print`, `println!`, `var_dump`, `dd()` |
| **TODO/FIXME debt** | `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP`, `WTF`, `BUG` in newly added lines |
| **Secrets** | AWS keys, GitHub PATs, OpenAI keys, Slack tokens, hardcoded passwords/API keys |
| **Large files** | Files over 500KB accidentally staged |
| **Missing tests** | Source files changed without a corresponding test file |
| **Complexity** | Functions with high cyclomatic complexity (configurable threshold) |

## How to use

### GitHub Action (CI/CD)

Add to `.github/workflows/review-ready.yml`:

```yaml
name: Review Ready
on:
  pull_request:
    branches: [main, master]
jobs:
  review-ready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: yurukusa/review-ready@v0.1.0
```

Results appear as inline PR annotations — errors block merge (by default), warnings are informational.

### VS Code Extension

1. Install from the VS Code Marketplace or Open VSX Registry
2. Make your changes and stage them with git
3. Click the **✓** icon in the Source Control toolbar
4. Or run `Review Ready: Check Changes` from the Command Palette (`Ctrl+Shift+P`)

Results appear in the **Review Ready** panel in the Activity Bar. The extension also runs automatically whenever you stage or unstage files.

## Configuration

All checks can be individually enabled/disabled in Settings → Review Ready.

| Setting | Default | Description |
|---------|---------|-------------|
| `reviewReady.checks.noDebugStatements` | `true` | Flag debug artifacts |
| `reviewReady.checks.noTodoInChanges` | `true` | Flag TODO/FIXME in new code |
| `reviewReady.checks.noSecrets` | `true` | Detect potential secrets |
| `reviewReady.checks.testCoverage` | `true` | Warn when test file is missing |
| `reviewReady.checks.complexity` | `true` | Flag high-complexity additions |
| `reviewReady.checks.noLargeFiles` | `true` | Flag files over 500KB |
| `reviewReady.complexity.threshold` | `10` | Cyclomatic complexity threshold |

## Supported languages

- JavaScript / TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`)
- Python (`.py`)
- Ruby (`.rb`)
- Go (`.go`)
- Java (`.java`)
- Rust (debug statement check only)
- PHP (debug statement check only)

## Why "Review Ready"?

Because the most embarrassing PR review comments are the avoidable ones:
- *"Did you mean to leave this console.log?"*
- *"This looks like a hardcoded API key"*
- *"There's no test for this file"*

Review Ready catches those before they reach your reviewer.

---

Also available as:
- **GitHub Action**: `uses: yurukusa/review-ready@v0.1.0`
- **npm library**: `npm install review-ready`
- **MCP Server** (Claude Code / Claude Desktop): `npx review-ready-mcp`

## License

MIT
