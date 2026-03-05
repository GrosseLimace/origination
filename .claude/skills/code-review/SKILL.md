---
name: code-review
description: Self-review checklist before committing - checks for security issues, error handling, test coverage, and code quality. Use when user says review code, code review, check my code, or before committing.
---

# Code Review Skill

## Purpose

Perform a structured self-review of code changes before committing to catch common issues.

## When to Use

Run `/code-review` before committing changes to ensure code quality and catch issues early.

## Process

### Step 1: Identify Changes

Run git commands to see what's changed:

```bash
git status --short
git diff --name-only
git diff --staged --name-only
```

List all modified, added, and deleted files.

### Step 2: Review Each Changed File

For each changed file, check the following:

#### Security Checklist

- [ ] No hardcoded secrets, API keys, or passwords
- [ ] No sensitive data in logs or error messages
- [ ] Input validation on user-provided data
- [ ] SQL queries use parameterized statements (no string concatenation)
- [ ] No command injection vulnerabilities (user input in shell commands)
- [ ] Authentication/authorization checks where needed

#### Error Handling Checklist

- [ ] Try/catch blocks around external calls (API, database, file I/O)
- [ ] Meaningful error messages (not generic "An error occurred")
- [ ] Errors logged appropriately (not swallowed silently)
- [ ] Graceful degradation where possible

#### Code Quality Checklist

- [ ] No debug code left in (console.log, Debug.WriteLine, TODO comments)
- [ ] No commented-out code blocks
- [ ] Variable/function names are clear and descriptive
- [ ] No magic numbers (use named constants)
- [ ] Functions are reasonably sized (not 200+ lines)
- [ ] No obvious code duplication

#### Test Coverage Checklist

- [ ] New functionality has corresponding tests
- [ ] Edge cases are tested
- [ ] Tests actually assert something meaningful
- [ ] No tests that always pass (empty assertions)

### Step 3: Check for Common Patterns

Use grep to scan for potential issues:

```bash
# Hardcoded secrets
grep -r "password\s*=" --include="*.cs" --include="*.ts"
grep -r "api_key\s*=" --include="*.cs" --include="*.ts"

# Debug statements
grep -r "console\.log" --include="*.ts" --include="*.js"
grep -r "Debug\.WriteLine" --include="*.cs"

# TODO/FIXME comments
grep -r "TODO\|FIXME" --include="*.cs" --include="*.ts"
```

### Step 4: Generate Review Report

Output a summary:

```text
CODE REVIEW SUMMARY

Files Changed: XX
- [list of files]

Security Issues Found: [None / List]
Error Handling Issues: [None / List]
Code Quality Issues: [None / List]
Test Coverage: [Good / Needs attention]

Debug Code Found:
- [file:line] - [description]

Recommendations:
1. [Action item]
2. [Action item]

Ready to Commit: [Yes / No - address issues first]
```

## Severity Levels

Categorize issues by severity:

| Level | Action | Examples |
|-------|--------|----------|
| **BLOCKER** | Must fix before commit | Hardcoded secrets, SQL injection, no auth check |
| **WARNING** | Should fix, but can commit | Missing error handling, magic numbers |
| **INFO** | Nice to fix | TODO comments, minor naming issues |

## Notes

- Focus on the diff, not the entire file (unless it's a new file)
- Be specific about line numbers when reporting issues
- Offer to help fix any issues found
- For large changes, suggest breaking into smaller commits