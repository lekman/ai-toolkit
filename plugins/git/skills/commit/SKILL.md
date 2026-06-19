---
name: commit
description: Analyze changes, generate commit messages, run QA checks, and create grouped commits
argument-hint: [files...] [--amend] [--all] [--message="text"] [--no-verify] [--dry-run] [--compare] [--quick]
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Bash(git *), Bash(task *)
user-invocable: true
---

# Commit Command: $ARGUMENTS

Intelligently groups related files and creates multiple focused commits with generated conventional commit messages, comprehensive validation, and strict hook compliance.

**IMPORTANT - Report Location Pattern**: This command generates a commit report. Follow this pattern:

- **Save to temporary directory**: `${TMPDIR:-${TEMP:-/tmp}}/commit-report-$(date +%Y%m%d-%H%M%S).md`
- **Auto-open in VSCode**: `code "$REPORT_FILE"` after generation
- **Never save to project root**: No `.commit.report.local.md` files

**Key Features:**

- **Smart grouping** - Groups files by directory, file type, and logical relationships
- **Multiple commits** - Creates separate commits for unrelated changes
- **Strict validation** - Respects all commit hooks, validates file readiness
- **TODO sync** - Moves matching tasks in `.tmp/TODO.md` to Done after commits
- **Reporting** - Detailed report in `.commit.report.local.md`

## Quick Examples

```bash
# Commit all staged files (auto-grouped into multiple commits)
/commit

# Commit specific files
/commit src/cli/*.ts tests/cli/*.test.ts

# Stage and commit everything (auto-grouped)
/commit --all

# Preview what would be committed
/commit --dry-run --all

# Use custom message for single commit (bypasses grouping)
/commit --message="chore: update dependencies" package.json bun.lock

# Amend previous commit
/commit --amend src/fix.ts

# Compare with previous attempt
/commit --all --compare

# Quick mode - commit files from current conversation
/commit --quick
```

## Phase 0: Parse Arguments

Extract from `$ARGUMENTS`:

- **Files**: Optional file list (e.g., `src/cli/*.ts Taskfile.yml`)
- **--all**: Stage all modified files before committing
- **--amend**: Amend the previous commit instead of creating new
- **--message="text"**: Use provided message (creates single commit, bypasses grouping)
- **--no-verify**: Skip git hooks (dangerous, requires explicit confirmation)
- **--dry-run**: Show what would be committed without actually committing
- **--compare**: Compare with previous commit attempt (if `.commit.report.local.md` exists)
- **--quick**: Quick mode - commit files discussed in current conversation with minimal ceremony

**If `--quick` flag is present, skip to [Quick Mode](#quick-mode) section.**

## Quick Mode

Quick mode is designed for committing files discussed in the current conversation with minimal ceremony. This is useful for smaller tool changes or work done outside the main task context.

**When to use `--quick`:**

- Small configuration or tool changes
- Files edited during a side conversation
- Quick fixes unrelated to current task
- Documentation updates from chat discussion

**What Quick Mode does:**

1. Extracts files discussed/edited in current conversation
2. Creates a single focused commit
3. Generates conventional commit message from conversation context
4. Respects all git hooks (no `--no-verify`)
5. Skips complex grouping logic

### Quick Mode Workflow

```javascript
// Step 1: Extract files from conversation context
// Look for files that were:
// - Read with Read tool
// - Edited with Edit tool
// - Written with Write tool
// - Discussed explicitly by path

const conversationFiles = extractFilesFromConversation();
// Example result: ['docs/commands/commit.md', '.claude/settings.json']

// Step 2: Filter to only modified files
const modifiedFiles = conversationFiles.filter((file) => {
  // Check git status - only include files with actual changes
  const status = execSync(`git status --porcelain "${file}"`).toString().trim();
  return status.length > 0;
});

// Step 3: Validate files exist and are trackable
const validFiles = modifiedFiles.filter((file) => {
  return existsSync(file) && !isIgnored(file);
});
```

### Quick Mode: Stage and Validate

```bash
# Stage only the conversation files
for file in "${QUICK_FILES[@]}"; do
  if [ -f "$file" ]; then
    git add "$file"
  fi
done

# Verify we have files to commit
STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo "❌ No modified files from conversation to commit"
  echo "   Files checked: ${QUICK_FILES[*]}"
  exit 1
fi

```

### Quick Mode: Generate Commit Message

```javascript
// Analyze conversation context to determine commit type and scope

// Extract the main topic from conversation
const topic = analyzeConversationTopic();
// Example: "updating commit command with quick flag"

// Determine commit type from changes
let commitType = "chore";
const fileTypes = validFiles.map((f) => getFileType(f));

if (fileTypes.some((t) => t === "feature-code")) {
  commitType = "feat";
} else if (fileTypes.some((t) => t === "test")) {
  commitType = "test";
} else if (fileTypes.every((t) => t === "docs")) {
  commitType = "docs";
} else if (fileTypes.some((t) => t === "config")) {
  commitType = "chore";
}

// Determine scope from file paths
const scope = inferScopeFromPaths(validFiles);
// Example: 'commands' from 'docs/commands/commit.md'

// Generate description from conversation context
const description = generateDescriptionFromContext(topic);
// Example: 'add quick flag for conversation-based commits'

// Compose message
const message = scope ? `${commitType}(${scope}): ${description}` : `${commitType}: ${description}`;

// Example: "docs(commands): add quick flag for conversation-based commits"
```

### Quick Mode: Execute Commit

```bash
# Run pre-commit hooks (NEVER skip in quick mode)
# Create commit with generated message
if git commit -m "$(cat <<'EOF'
$COMMIT_MESSAGE
EOF
)"; then
  COMMIT_SHA=$(git rev-parse HEAD)
else
  echo "❌ Commit failed"
  echo ""
  echo "Possible causes:"
  echo "   - Pre-commit hooks failed (fix lint/type errors)"
  echo "   - Commit message format rejected"
  echo ""
  echo "Fix issues and retry with: /commit --quick"
  exit 1
fi
```

### Quick Mode: File Extraction Patterns

**Files to include from conversation:**

```javascript
// Pattern 1: Files read with Read tool
// Look for: Read tool calls in conversation
const readFiles = conversation.toolCalls
  .filter((call) => call.tool === "Read")
  .map((call) => call.params.file_path);

// Pattern 2: Files edited with Edit tool
// Look for: Edit tool calls in conversation
const editedFiles = conversation.toolCalls
  .filter((call) => call.tool === "Edit")
  .map((call) => call.params.file_path);

// Pattern 3: Files written with Write tool
const writtenFiles = conversation.toolCalls
  .filter((call) => call.tool === "Write")
  .map((call) => call.params.file_path);

// Pattern 4: Files explicitly mentioned by path
// Look for: file paths in user messages
const mentionedFiles = extractFilePathsFromMessages(conversation.messages);

// Combine and deduplicate
const allFiles = [...new Set([...readFiles, ...editedFiles, ...writtenFiles, ...mentionedFiles])];

// Filter to only include files with modifications
return allFiles.filter(hasUncommittedChanges);
```

**Files to exclude:**

- Files in `.gitignore`
- Files with no actual changes (read-only access)
- Temporary files (`.tmp/*`, `*.log`)
- Files outside repository root

### Quick Mode vs Standard Mode

| Aspect         | Quick Mode        | Standard Mode            |
| -------------- | ----------------- | ------------------------ |
| File selection | From conversation | All staged or specified  |
| Grouping       | Single commit     | Multiple grouped commits |
| Context        | Conversation only | Full diff analysis       |
| Complexity     | Minimal           | Full analysis            |
| Use case       | Small changes     | Large changesets         |
| Hooks          | Always run        | Always run               |

**Important**: Quick mode still respects all git hooks and conventional commit format. The only simplification is in file selection and grouping logic.

## Phase 1: Analyze Git State

### 1.1 Verify Git Repository

```bash
# Check if we're in a git repository
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "❌ Error: Not a git repository"
  echo "   Initialize with: git init"
  exit 1
}

# Get current branch
BRANCH=$(git branch --show-current)

# Warn if on protected branch
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "⚠️  Warning: Committing to protected branch '$BRANCH'"
  echo "   Consider using a feature branch instead"
fi

# Check for merge in progress
if [ -f .git/MERGE_HEAD ]; then
  echo "❌ Error: Merge in progress"
  echo "   Resolve conflicts first with: git status"
  exit 1
fi

# Check for detached HEAD
if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "⚠️  Warning: Detached HEAD state"
  echo "   Commits will not be on a branch"
  echo "   Consider: git checkout -b <branch-name>"
fi
```

### 1.2 Collect Changed Files

```bash
# Determine which files to process
if [ -n "$FILES_ARG" ]; then
  # Specific files provided
  CHANGED_FILES=("$FILES_ARG")

  # Validate files exist
  for file in "${CHANGED_FILES[@]}"; do
    [ -f "$file" ] || {
      echo "❌ Error: File not found: $file"
      exit 1
    }
  done

  # Stage specified files
  git add "${CHANGED_FILES[@]}"
elif [ "$ALL_FLAG" = "true" ]; then
  # Stage all modified and untracked files
  git add -A
  CHANGED_FILES=($(git diff --cached --name-only))
else
  # Use currently staged files
  CHANGED_FILES=($(git diff --cached --name-only))

  # Warn if nothing is staged
  if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
    echo "❌ Error: No files to commit"
    echo "   Options:"
    echo "   - Stage files: git add <file>"
    echo "   - Use --all: /commit --all"
    exit 1
  fi
fi

TOTAL_FILES=${#CHANGED_FILES[@]}
```

## Phase 2: Validate Files

For each changed file, validate readiness:

### 2.1 Syntax and Completeness Validation

```bash
READY_FILES=()
SKIPPED_FILES=()

for file in "${CHANGED_FILES[@]}"; do
  SKIP_REASON=""

  # Empty files
  if [ ! -s "$file" ] || ! grep -q '[^[:space:]]' "$file" 2>/dev/null; then
    SKIP_REASON="Empty file or whitespace only"

  # JSON syntax
  elif [[ "$file" == *.json ]] && ! jq empty "$file" 2>/dev/null; then
    SKIP_REASON="Invalid JSON syntax"

  # YAML syntax
  elif [[ "$file" =~ \.(yaml|yml)$ ]] && command -v yamllint &>/dev/null; then
    if ! yamllint -d relaxed "$file" 2>/dev/null; then
      SKIP_REASON="Invalid YAML syntax"
    fi

  # TypeScript/JavaScript syntax
  elif [[ "$file" =~ \.(ts|tsx|js|jsx)$ ]] && command -v node &>/dev/null; then
    if ! node -c "$file" 2>/dev/null; then
      SKIP_REASON="Syntax errors detected"
    fi
  fi

  # WIP markers
  if [ -z "$SKIP_REASON" ] && grep -qiE 'WIP|TODO:.*finish|FIXME:.*broken|HACK:' "$file"; then
    MARKERS=$(grep -niE 'WIP|TODO:.*finish|FIXME:.*broken|HACK:' "$file" | head -3)
    SKIP_REASON="Contains WIP markers: $MARKERS"
  fi

  # Debug code
  if [ -z "$SKIP_REASON" ] && grep -qE 'console\.log.*["']test["']|debugger;|console\.debug' "$file"; then
    DEBUG_LINES=$(grep -nE 'console\.log.*["']test["']|debugger;|console\.debug' "$file" | head -3)
    SKIP_REASON="Contains debug code: $DEBUG_LINES"
  fi

  # Add to appropriate list
  if [ -n "$SKIP_REASON" ]; then
    SKIPPED_FILES+=("$file:$SKIP_REASON")
    git reset "$file" 2>/dev/null || true
  else
    READY_FILES+=("$file")
  fi
done
```

### 2.2 Sensitive Data Detection

```bash
SENSITIVE_FILES=()

for file in "${READY_FILES[@]}"; do
  # API keys
  if grep -qE 'api[_-]?key.*["'][a-zA-Z0-9]{32,}["']' "$file"; then
    SENSITIVE_FILES+=("$file:Potential API key detected")

  # AWS credentials
  elif grep -qE 'AKIA[0-9A-Z]{16}' "$file"; then
    SENSITIVE_FILES+=("$file:AWS access key detected")

  # Private keys
  elif grep -q '-----BEGIN.*PRIVATE KEY-----' "$file"; then
    SENSITIVE_FILES+=("$file:Private key detected")

  # JWT tokens
  elif grep -qE 'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*' "$file"; then
    SENSITIVE_FILES+=("$file:JWT token detected")

  # Generic secrets
  elif grep -qiE 'secret.*=.*["'][a-zA-Z0-9]{16,}["']' "$file"; then
    SENSITIVE_FILES+=("$file:Potential secret detected")
  fi
done

# Block commit if sensitive data found
if [ ${#SENSITIVE_FILES[@]} -gt 0 ]; then
  echo "❌ BLOCKED: Sensitive data detected:"
  for item in "${SENSITIVE_FILES[@]}"; do
    echo "   - $item"
  done
  echo ""
  echo "Remove sensitive data before committing"
  exit 1
fi
```

### 2.3 Conflict and Size Detection

```bash
# Check for unresolved conflicts
CONFLICT_FILES=$(git diff --name-only --diff-filter=U)
if [ -n "$CONFLICT_FILES" ]; then
  echo "❌ BLOCKED: Unresolved merge conflicts in:"
  echo "$CONFLICT_FILES" | while read -r file; do
    echo "   - $file"
    grep -n '^<<<<<<< \|^=======$\|^>>>>>>> ' "$file" 2>/dev/null | head -3 || true
  done
  echo ""
  echo "Resolve conflicts before committing"
  exit 1
fi

# Warn about large files
LARGE_FILES=()
for file in "${READY_FILES[@]}"; do
  if [ -f "$file" ]; then
    SIZE=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
    if [ "$SIZE" -gt 1048576 ]; then  # 1MB
      SIZE_MB=$(echo "scale=2; $SIZE / 1048576" | bc)
      LARGE_FILES+=("$file:${SIZE_MB}MB")
    fi
  fi
done

if [ ${#LARGE_FILES[@]} -gt 0 ]; then
  echo "⚠️  Large files detected (>1MB):"
  for item in "${LARGE_FILES[@]}"; do
    echo "   - $item"
  done
  echo "   Consider using Git LFS for large binary files"
  echo ""
fi

# Detect partial staging
PARTIAL_STAGED=$(comm -12 \
  <(git diff --name-only | sort) \
  <(git diff --cached --name-only | sort))

if [ -n "$PARTIAL_STAGED" ]; then
  echo "⚠️  Files with partial staging (staged + unstaged changes):"
  echo "$PARTIAL_STAGED" | while read -r file; do
    echo "   - $file"
  done
  echo "   Only staged changes will be committed"
  echo ""
fi
```

## Phase 3: Group Files by Context

**CRITICAL**: Never commit 40+ files in one commit. Group changes by function and create multiple focused commits.

### 3.1 Analyze Files and Match to Groups

```bash
# For each ready file, determine which group it belongs to
declare -A FILE_TO_GROUP

for file in "${READY_FILES[@]}"; do
  FILE_DIR=$(dirname "$file")
  FILE_NAME=$(basename "$file")
  FILE_EXT="${FILE_NAME##*.}"

  MATCHED_GROUP=""

  # Group by file type and directory
  case "$file" in
      tests/*test.ts)
        # Find matching implementation
        IMPL_FILE=$(echo "$file" | sed 's|tests/||; s|\.test\.ts$|.ts|')
        if echo "${READY_FILES[@]}" | grep -q "$IMPL_FILE"; then
          MATCHED_GROUP="logical:test-impl:$(dirname $IMPL_FILE)"
        else
          MATCHED_GROUP="logical:test:$(dirname $file)"
        fi
        ;;

      src/*)
        # Find matching test
        TEST_FILE=$(echo "$file" | sed 's|src/|tests/|; s|\.ts$|.test.ts|')
        if echo "${READY_FILES[@]}" | grep -q "$TEST_FILE"; then
          MATCHED_GROUP="logical:test-impl:$(dirname $file)"
        else
          MATCHED_GROUP="logical:feature:$(dirname $file | sed 's|src/||')"
        fi
        ;;

      package.json|bun.lock|Taskfile.yml|tsconfig.json|*.config.js|*.config.ts)
        MATCHED_GROUP="logical:build"
        ;;

      .github/workflows/*)
        MATCHED_GROUP="logical:ci"
        ;;

      docs/*.md)
        # Try to link to related feature
        DOC_NAME=$(basename "$file" .md)
        FEATURE_FILE="src/${DOC_NAME}.ts"
        if echo "${READY_FILES[@]}" | grep -q "$FEATURE_FILE"; then
          MATCHED_GROUP="logical:feature-docs:${DOC_NAME}"
        else
          MATCHED_GROUP="logical:docs"
        fi
        ;;

      *)
        MATCHED_GROUP="logical:misc"
        ;;
    esac
  fi

  FILE_TO_GROUP["$file"]="$MATCHED_GROUP"
done
```

### 3.2 Create Commit Groups

```bash
# Group files by their assigned group
declare -A GROUP_FILES

for file in "${READY_FILES[@]}"; do
  GROUP="${FILE_TO_GROUP[$file]}"

  if [ -z "${GROUP_FILES[$GROUP]}" ]; then
    GROUP_FILES[$GROUP]="$file"
  else
    GROUP_FILES[$GROUP]="${GROUP_FILES[$GROUP]} $file"
  fi
done

# Sort groups by priority:
# 1. Feature+test+docs groups first
# 2. Build/CI groups last
SORTED_GROUPS=($(for group in "${!GROUP_FILES[@]}"; do echo "$group"; done | \
  sort -t: -k1,1r -k2,2))


# Validate grouping
ASSIGNED_COUNT=0
for group in "${SORTED_GROUPS[@]}"; do
  FILES="${GROUP_FILES[$group]}"
  FILE_COUNT=$(echo "$FILES" | wc -w | tr -d ' ')
  ASSIGNED_COUNT=$((ASSIGNED_COUNT + FILE_COUNT))
done

if [ $ASSIGNED_COUNT -ne ${#READY_FILES[@]} ]; then
  echo "⚠️  Warning: Grouping mismatch (${ASSIGNED_COUNT} assigned vs ${#READY_FILES[@]} ready)"
fi
```

## Phase 4: Generate Commit Messages

**CRITICAL**: NEVER include external task IDs in commit messages. Task IDs are internal to the operator.

### 4.1 Generate Message Per Group

```bash
declare -A COMMIT_MESSAGES

for group in "${SORTED_GROUPS[@]}"; do
  GROUP_TYPE=$(echo "$group" | cut -d: -f1)
  GROUP_DETAIL=$(echo "$group" | cut -d: -f2-)
  FILES="${GROUP_FILES[$group]}"

  # Analyze files to determine commit type and scope
  FILE_ARRAY=($FILES)

  # Get diff stats
  DIFF_STATS=$(git diff --cached --stat -- "${FILE_ARRAY[@]}")
  DIFF_CONTENT=$(git diff --cached --unified=3 -- "${FILE_ARRAY[@]}" | grep -E '^\+' | head -30)

  # Determine commit type based on changes
  COMMIT_TYPE="chore"

  # Check for new functionality
  if echo "$DIFF_CONTENT" | grep -qE '^\+.*function |^\+.*class |^\+.*export '; then
    if echo "$DIFF_CONTENT" | grep -qE 'test.*it\(|describe\('; then
      COMMIT_TYPE="test"
    else
      COMMIT_TYPE="feat"
    fi
  # Check for bug fixes
  elif echo "$DIFF_CONTENT" | grep -qiE '^\+.*(fix|resolve|correct|patch)'; then
    COMMIT_TYPE="fix"
  # Check for documentation
  elif echo "${FILE_ARRAY[*]}" | grep -qE '\.md$'; then
    COMMIT_TYPE="docs"
  # Check for tests
  elif echo "${FILE_ARRAY[*]}" | grep -qE 'test\.ts$'; then
    COMMIT_TYPE="test"
  # Check for build files
  elif echo "${FILE_ARRAY[*]}" | grep -qE 'package\.json|Taskfile\.yml|\.config\.(js|ts)'; then
    COMMIT_TYPE="build"
  # Check for CI files
  elif echo "${FILE_ARRAY[*]}" | grep -qE '\.github/workflows'; then
    COMMIT_TYPE="ci"
  # Check for refactoring
  elif echo "$DIFF_CONTENT" | grep -qE '^\+' && echo "$DIFF_CONTENT" | grep -qE '^\-'; then
    # Roughly equal additions and deletions suggests refactoring
    PLUS_COUNT=$(echo "$DIFF_CONTENT" | grep -cE '^\+')
    MINUS_COUNT=$(git diff --cached --unified=3 -- "${FILE_ARRAY[@]}" | grep -cE '^\-')
    if [ $((PLUS_COUNT - MINUS_COUNT)) -lt 10 ]; then
      COMMIT_TYPE="refactor"
    fi
  fi

  # Determine scope from file paths
  SCOPE=""
  if [ "$GROUP_TYPE" = "logical" ]; then
    case "$GROUP_DETAIL" in
      test-impl:*)
        SCOPE=$(echo "$GROUP_DETAIL" | sed 's|test-impl:||; s|src/||; s|/|:|g')
        ;;
      feature:*)
        SCOPE=$(echo "$GROUP_DETAIL" | sed 's|feature:||')
        ;;
      feature-docs:*)
        SCOPE=$(echo "$GROUP_DETAIL" | sed 's|feature-docs:||')
        ;;
      build|ci|docs|test|misc)
        SCOPE="$GROUP_DETAIL"
        ;;
      *)
        # Infer from file paths
        COMMON_PATH=$(echo "${FILE_ARRAY[@]}" | tr ' ' '
' | \
          sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -1 | \
          awk '{print $2}' | sed 's|src/||; s|tests/||')
        SCOPE="${COMMON_PATH/\//:}"
        ;;
    esac
  fi

  # Generate description from file changes
  DESCRIPTION=""
  if [ ${#FILE_ARRAY[@]} -eq 1 ]; then
      # Single file - describe the change
      FILE_NAME=$(basename "${FILE_ARRAY[0]}")
      DESCRIPTION="update $FILE_NAME"
    else
      # Multiple files - describe the scope
      case "$COMMIT_TYPE" in
        feat)
          DESCRIPTION="add ${SCOPE} functionality"
          ;;
        fix)
          DESCRIPTION="resolve ${SCOPE} issues"
          ;;
        docs)
          DESCRIPTION="update ${SCOPE} documentation"
          ;;
        test)
          DESCRIPTION="add ${SCOPE} tests"
          ;;
        build)
          DESCRIPTION="update build configuration"
          ;;
        ci)
          DESCRIPTION="update CI workflow"
          ;;
        refactor)
          DESCRIPTION="refactor ${SCOPE} implementation"
          ;;
        *)
          DESCRIPTION="update ${SCOPE}"
          ;;
      esac
    fi
  fi

  # Generate body with bullet points
  BODY=""

  # Analyze changes per file for bullet points
  for file in "${FILE_ARRAY[@]}"; do
    FILE_CHANGES=$(git diff --cached --unified=0 "$file" | \
      grep -E '^\+[^+]' | head -5 | sed 's/^\+//')

    if [ -n "$FILE_CHANGES" ]; then
      FILE_NAME=$(basename "$file")
      # Extract key changes
      if echo "$FILE_CHANGES" | grep -qE 'function |class |export '; then
        FUNCTIONS=$(echo "$FILE_CHANGES" | grep -oE 'function [a-zA-Z]+|class [a-zA-Z]+|export [a-zA-Z]+' | \
          head -3 | sed 's/function /Add function /; s/class /Add class /; s/export /Export /')
        BODY="$BODY
- $FILE_NAME: $FUNCTIONS"
      elif echo "$FILE_CHANGES" | grep -qE 'test\(|it\(|describe\('; then
        BODY="$BODY
- Add tests in $FILE_NAME"
      else
        BODY="$BODY
- Update $FILE_NAME"
      fi
    fi
  done

  # Compose full message
  if [ -n "$SCOPE" ]; then
    MESSAGE="${COMMIT_TYPE}(${SCOPE}): ${DESCRIPTION}${BODY}"
  else
    MESSAGE="${COMMIT_TYPE}: ${DESCRIPTION}${BODY}"
  fi

  COMMIT_MESSAGES["$group"]="$MESSAGE"
done
```

### 4.2 Validate Message Format

```bash
# Validate each generated message
for group in "${SORTED_GROUPS[@]}"; do
  MESSAGE="${COMMIT_MESSAGES[$group]}"
  FIRST_LINE=$(echo -e "$MESSAGE" | head -1)

  # Ensure conventional commit format
  if ! echo "$FIRST_LINE" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?: .+'; then
    echo "⚠️  Generated message doesn't follow conventional format"
    echo "Group: $group"
    echo "Message: $FIRST_LINE"
    echo "Adjusting format..."
  fi

  # Check first line length (≤72 characters)
  if [ ${#FIRST_LINE} -gt 72 ]; then
    echo "⚠️  Message too long (${#FIRST_LINE} chars), truncating to 72"
    FIRST_LINE="${FIRST_LINE:0:69}..."
    # Update message
    BODY=$(echo -e "$MESSAGE" | tail -n +2)
    COMMIT_MESSAGES["$group"]="${FIRST_LINE}${BODY}"
  fi

  # CRITICAL: Ensure no task IDs in message
  if echo "$MESSAGE" | grep -qE 'Task: #|task #[0-9]'; then
    echo "❌ CRITICAL: Task ID found in commit message!"
    echo "Group: $group"
    echo "Task IDs are internal to the operator and must not be in commits"
    exit 1
  fi
done

```

## Phase 5: Pre-Commit QA Checks

### 5.1 Run Validation Tasks

```bash
# Discover available tasks
AVAILABLE_TASKS=()
if [ -f Taskfile.yml ]; then
  AVAILABLE_TASKS=($(task --list 2>/dev/null | grep -E 'lint|typecheck|test' | awk '{print $2}'))
fi

# Run linting
LINT_STATUS="⊘ Skipped"
LINT_FAILED=false
if echo "${AVAILABLE_TASKS[@]}" | grep -q '^lint$'; then
  if task lint; then
    LINT_STATUS="✅ Passed"
  else
    LINT_STATUS="❌ Failed"
    LINT_FAILED=true
  fi
fi

# Run type checking
TYPECHECK_STATUS="⊘ Skipped"
TYPECHECK_FAILED=false
if echo "${AVAILABLE_TASKS[@]}" | grep -q '^typecheck$'; then
  if task typecheck; then
    TYPECHECK_STATUS="✅ Passed"
  else
    TYPECHECK_STATUS="❌ Failed"
    TYPECHECK_FAILED=true
  fi
elif command -v tsc &>/dev/null; then
  if tsc --noEmit; then
    TYPECHECK_STATUS="✅ Passed"
  else
    TYPECHECK_STATUS="❌ Failed"
    TYPECHECK_FAILED=true
  fi
fi

# Run tests (skip in dry-run)
TEST_STATUS="⊘ Skipped"
TEST_FAILED=false
if [ "$DRY_RUN" != "true" ] && echo "${AVAILABLE_TASKS[@]}" | grep -q '^test$'; then
  if task test; then
    TEST_STATUS="✅ Passed"
  else
    TEST_STATUS="❌ Failed"
    TEST_FAILED=true
  fi
fi

# Handle QA failures
if [ "$LINT_FAILED" = "true" ] || [ "$TYPECHECK_FAILED" = "true" ] || [ "$TEST_FAILED" = "true" ]; then
  echo ""
  echo "❌ Pre-commit QA checks failed"
  echo ""
  [ "$LINT_FAILED" = "true" ] && echo "  - Linting: Fix with 'task lint:fix'"
  [ "$TYPECHECK_FAILED" = "true" ] && echo "  - Type errors: Review tsc output"
  [ "$TEST_FAILED" = "true" ] && echo "  - Tests: Fix failing tests"
  echo ""
  echo "Fix issues and retry commit"
  exit 1
fi
```

## Phase 6: Execute Commits

### 6.1 Dry-Run Mode

```bash
if [ "$DRY_RUN" = "true" ]; then
  echo "DRY RUN — would create ${#SORTED_GROUPS[@]} commits for ${#READY_FILES[@]} files:"
  echo ""

  COMMIT_NUM=1
  for group in "${SORTED_GROUPS[@]}"; do
    FILES="${GROUP_FILES[$group]}"
    FILE_COUNT=$(echo "$FILES" | wc -w | tr -d ' ')
    MESSAGE="${COMMIT_MESSAGES[$group]}"
    FIRST_LINE=$(echo -e "$MESSAGE" | head -1)

    echo "Commit $COMMIT_NUM of ${#SORTED_GROUPS[@]}: $FIRST_LINE"
    echo "  Files ($FILE_COUNT):"
    for file in $FILES; do
      STATUS=$(git status --porcelain "$file" | awk '{print $1}')
      echo "    - $file ($STATUS)"
    done
    echo ""
    ((COMMIT_NUM++))
  done

  exit 0
fi
```

### 6.2 Create Commits Sequentially

```bash
COMMIT_NUM=1
CREATED_COMMITS=()
FAILED_COMMITS=()

for group in "${SORTED_GROUPS[@]}"; do
  FILES="${GROUP_FILES[$group]}"
  MESSAGE="${COMMIT_MESSAGES[$group]}"
  FIRST_LINE=$(echo -e "$MESSAGE" | head -1)

  # Reset staging area
  git reset >/dev/null 2>&1 || true

  # Stage only files for this group
  for file in $FILES; do
    git add "$file" || {
      echo "❌ Failed to stage $file"
      FAILED_COMMITS+=("$group:Failed to stage files")
      break 2
    }
  done

  # Create commit
  NO_VERIFY_FLAG=""
  [ "$NO_VERIFY" = "true" ] && NO_VERIFY_FLAG="--no-verify"

  if git commit $NO_VERIFY_FLAG -m "$(echo -e "$MESSAGE")"; then
    COMMIT_SHA=$(git rev-parse HEAD)
    CREATED_COMMITS+=("$group:$COMMIT_SHA")
  else
    FAILED_COMMITS+=("$group:Commit failed (likely hooks)")
    echo "❌ Commit failed for group: $group"
    echo "   Stopping at commit $COMMIT_NUM of ${#SORTED_GROUPS[@]}"
    break
  fi

  ((COMMIT_NUM++))
done

# Handle commit failures
if [ ${#FAILED_COMMITS[@]} -gt 0 ]; then
  echo ""
  echo "❌ Commit sequence failed"
  echo ""
  echo "Created: ${#CREATED_COMMITS[@]} commits"
  echo "Failed: ${#FAILED_COMMITS[@]} commits"
  echo ""
  echo "Options:"
  echo "  1. Fix issues and run /commit again"
  echo "  2. Use 'git reset HEAD~${#CREATED_COMMITS[@]}' to undo all commits"
  echo ""
  exit 1
fi

```

## Phase 7: Update TODO Tracking

After all commits succeed, update `.tmp/TODO.md` if it exists. This keeps task tracking in sync with committed work.

**Skip this phase if:**

- `.tmp/TODO.md` does not exist
- `--dry-run` mode is active
- No commits were created

### 7.1 Match Commits to Tasks

Read `.tmp/TODO.md` and parse the "In Progress" and "Backlog" tables. For each committed group, check if any in-progress or backlog task relates to the committed scope.

**Matching strategy:**

- Compare commit scope/description against task text (case-insensitive substring match)
- Compare committed file paths against task notes (e.g., a task mentioning `planner-hook` matches files in `planner-hook-installer.ts`)
- A match requires overlap in both topic and file area — do not match on generic words like "update" or "fix"

```bash
TODO_FILE=".tmp/TODO.md"
TODO_CHANGES=()

# For each created commit, extract scope and description
for item in "${CREATED_COMMITS[@]}"; do
  GROUP=$(echo "$item" | cut -d: -f1)
  MESSAGE="${COMMIT_MESSAGES[$GROUP]}"
  FIRST_LINE=$(echo -e "$MESSAGE" | head -1)

  # Extract scope and description from conventional commit
  SCOPE=$(echo "$FIRST_LINE" | grep -oP '(?<=\().*?(?=\))' || echo "")
  DESC=$(echo "$FIRST_LINE" | sed 's/^[a-z]*(\([^)]*\)): //' | sed 's/^[a-z]*: //')

  # Search In Progress and Backlog tables for matching tasks
  # Match on: scope keywords, description keywords, file paths in notes
done
```

### 7.2 Update Task Status

For each matched task:

**In Progress → Done:**

- Remove the row from the "In Progress" table
- Add a completion entry under "## Done" with today's date
- Format: `- [X] <task description> (committed: <short SHA>)`

**Backlog → In Progress:**

- If the commit partially addresses a backlog task (e.g., adds a dependency or prerequisite), move it to "In Progress"
- Add a note: `Started via <commit SHA short>`

**No false positives:**

- Only move tasks with a clear match — when in doubt, leave the task unchanged
- Never delete or modify tasks that don't clearly match committed work

### 7.3 Write Changes

```bash
if [ ${#TODO_CHANGES[@]} -gt 0 ]; then
  # Edit .tmp/TODO.md using the Edit tool
  # Track what changed for the final summary
  echo "Updated .tmp/TODO.md:"
  for change in "${TODO_CHANGES[@]}"; do
    echo "   $change"
  done
fi
```

**Do NOT commit the TODO.md changes** — they are gitignored personal tracking.

### 7.4 Update Plan Status

If a matched task references a plan file (look for `Plan:` in the Notes column), update the plan's status in `.tmp/claude.plans.json`.

**Plan references in TODO.md Notes column:**

```text
Plan: `~/.claude/plans/floofy-forging-rabin.md`
Plan: `~/.claude/plans/shiny-humming-floyd.md`
```

**Tracker format** (`.tmp/claude.plans.json`):

```json
[
  { "name": "Plan Title", "id": "plan-id", "path": "/Users/.../plan.md", "status": "active" }
]
```

**Status values:**

- `"active"` — plan has work in progress (default if no status field)
- `"partial"` — some tasks from this plan are done, others remain
- `"done"` — all tasks referencing this plan are in the Done section

**Logic:**

1. For each TODO task moved to Done, extract the plan filename from its Notes
2. Find the matching entry in `.tmp/claude.plans.json` by filename — the `id` field is the filename without `.md` extension (e.g., `floofy-forging-rabin` matches `~/.claude/plans/floofy-forging-rabin.md`)
3. Check if any remaining In Progress or Backlog tasks still reference the same plan
4. If no remaining tasks reference the plan → set `status: "done"`
5. If some tasks remain → set `status: "partial"`
6. Update the tracker file using `writeTracker()` or direct Edit

**Include plan status changes in the Phase 9 summary:**

```text
Plan updates:
   - "Plan Title" → done (all tasks completed)
   - "Plan Title" → partial (2 tasks remain)
```

## Phase 8: Pre-Push Validation

After commits and TODO sync, proactively run pre-push hooks so issues are caught and fixed before the user tries to push. This avoids the frustrating cycle of push → fail → ask for help → fix → push again.

**Skip this phase if:**

- `--dry-run` mode is active
- No commits were created
- No pre-push hooks exist

### 8.1 Detect Pre-Push Hooks

Check for pre-push hooks in order of precedence:

```bash
PRE_PUSH_HOOK=""
PRE_PUSH_SOURCE=""

# 1. Husky (most common in JS/TS projects)
if [ -f .husky/pre-push ]; then
  PRE_PUSH_HOOK=".husky/pre-push"
  PRE_PUSH_SOURCE="Husky"

# 2. Standard git hook
elif [ -f .git/hooks/pre-push ]; then
  PRE_PUSH_HOOK=".git/hooks/pre-push"
  PRE_PUSH_SOURCE="git hook"

# 3. Python pre-commit framework (check config for pre-push stage)
elif [ -f .pre-commit-config.yaml ] && grep -q 'pre-push' .pre-commit-config.yaml 2>/dev/null; then
  PRE_PUSH_HOOK="pre-commit-framework"
  PRE_PUSH_SOURCE="pre-commit (Python)"
fi
```

### 8.2 Run Pre-Push Hooks

Execute the detected hook directly (not via `git push`). This simulates what would happen on push.

```bash
PRE_PUSH_STATUS="⊘ No hooks"
PRE_PUSH_FAILED=false

if [ -n "$PRE_PUSH_HOOK" ]; then
  if [ "$PRE_PUSH_HOOK" = "pre-commit-framework" ]; then
    # Python pre-commit framework
    if pre-commit run --hook-stage pre-push 2>&1; then
      PRE_PUSH_STATUS="✅ Passed"
    else
      PRE_PUSH_STATUS="❌ Failed"
      PRE_PUSH_FAILED=true
    fi
  else
    # Shell-based hook (Husky or standard git hook)
    # Source the hook script directly — pre-push hooks receive
    # <remote-name> <remote-url> on stdin with lines of:
    # <local-ref> <local-sha> <remote-ref> <remote-sha>
    # We simulate this with the current branch info
    REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "origin")
    LOCAL_REF="refs/heads/$(git branch --show-current)"
    LOCAL_SHA=$(git rev-parse HEAD)
    REMOTE_REF="$LOCAL_REF"
    REMOTE_SHA=$(git rev-parse "@{u}" 2>/dev/null || echo "0000000000000000000000000000000000000000")

    if echo "$LOCAL_REF $LOCAL_SHA $REMOTE_REF $REMOTE_SHA" | \
       bash "$PRE_PUSH_HOOK" origin "$REMOTE_URL" 2>&1; then
      PRE_PUSH_STATUS="✅ Passed"
    else
      PRE_PUSH_STATUS="❌ Failed"
      PRE_PUSH_FAILED=true
    fi
  fi
fi
```

### 8.3 Handle Pre-Push Failures

If hooks fail, **you must attempt to fix the issues** before presenting the summary. The user will be blocked from pushing until these pass — waiting for them to ask for help wastes time.

```bash
if [ "$PRE_PUSH_FAILED" = "true" ]; then
  echo ""
  echo "❌ Pre-push hooks failed — diagnosing..."
fi
```

**Behavior on failure — you MUST follow this sequence:**

1. **Diagnose**: Parse the hook output to identify specific failures (type errors, test failures, coverage gaps)
2. **Fix**: Attempt to fix each failure directly:
   - **Type errors**: Read the failing file, fix the type issue, run typecheck to verify
   - **Test failures**: Read the failing test + implementation, fix the root cause (whether in test or source)
   - **Coverage below threshold**: Identify uncovered lines, add missing tests
   - **Lint errors**: Run the fixer (`bun run fix` or equivalent)
   - **Toolchain crashes** (e.g., turbo panic): Fall back to running the underlying commands directly (`bun run typecheck`, `bun test --coverage`)
3. **Re-run**: After fixes, re-run the pre-push hook to confirm it passes
4. **Commit fixes**: If source files changed, create a new fix commit (do NOT amend — follow the commit skill's own rules). If only tests changed, create a `test:` commit
5. **Report**: Include what was broken and what was fixed in the Phase 10 summary

**Do NOT treat failures as "pre-existing" or "unrelated"** — if the hook fails, the user cannot push. Fix it regardless of when the issue was introduced.

**If you cannot fix a failure after a reasonable attempt:**

- Explain what failed and what you tried
- Suggest specific next steps the user can take
- Still present the commit summary so the user sees what was committed

## Phase 9: Generate Report

```bash
REPORT_FILE=".commit.report.local.md"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$REPORT_FILE" <<EOF
# Commit Report

**Generated:** $TIMESTAMP
**Branch:** $(git branch --show-current)
**Operator:** $(git config user.name) <$(git config user.email)>

## Summary

**Files Analyzed:** $TOTAL_FILES
**Files Committed:** ${#READY_FILES[@]}
**Files Skipped:** ${#SKIPPED_FILES[@]}
**Commits Created:** ${#CREATED_COMMITS[@]}

## Commits Created

$(for item in "${CREATED_COMMITS[@]}"; do
  GROUP=$(echo "$item" | cut -d: -f1)
  SHA=$(echo "$item" | cut -d: -f2)
  MESSAGE="${COMMIT_MESSAGES[$GROUP]}"
  FIRST_LINE=$(echo -e "$MESSAGE" | head -1)
  FILES="${GROUP_FILES[$GROUP]}"
  FILE_COUNT=$(echo "$FILES" | wc -w | tr -d ' ')
  echo "### Commit: \`$SHA\`"
  echo ""
  echo "\`\`\`"
  echo -e "$MESSAGE"
  echo "\`\`\`"
  echo ""
  echo "**Files ($FILE_COUNT):**"
  echo ""
  for file in $FILES; do
    STAT=\$(git diff HEAD~1 --numstat -- "$file" 2>/dev/null | awk '{print "+"$1", -"$2}')
    echo "- \`$file\` ($STAT)"
  done
  echo ""
done)

## Skipped Files

$(if [ ${#SKIPPED_FILES[@]} -eq 0 ]; then
  echo "No files skipped"
else
  echo "**Total Skipped:** ${#SKIPPED_FILES[@]}"
  echo ""
  for item in "${SKIPPED_FILES[@]}"; do
    file=$(echo "$item" | cut -d: -f1)
    reason=$(echo "$item" | cut -d: -f2-)
    echo "- \`$file\`: $reason"
  done
fi)

## Pre-Commit Checks

- **Linting:** $LINT_STATUS
- **Type Checking:** $TYPECHECK_STATUS
- **Tests:** $TEST_STATUS

## Pre-Push Validation

- **Hook:** $PRE_PUSH_SOURCE
- **Status:** $PRE_PUSH_STATUS

## Next Steps

$(AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "0")
if [ "$AHEAD" -gt 0 ]; then
  echo "**Branch Status:** Branch is ahead by $AHEAD commit(s)"
  echo "**Action Required:** Use \`git push\` to publish changes"
else
  echo "Branch is up to date with remote"
fi)

---

**Report Location:** \`.commit.report.local.md\`
EOF

# Add report to gitignore
if ! grep -q "^\.commit\.report\.local\.md$" .gitignore 2>/dev/null; then
  echo ".commit.report.local.md" >> .gitignore
fi
```

## Phase 10: Present Results

Output the structured summary below. No opening narration, no closing suggestions — facts only.

```text
Commits:
   - <SHA>: <commit message first line>
   - <SHA>: <commit message first line>
   ...

TODO updates:                              ← omit if .tmp/TODO.md was not modified
   - "Task name" → Done (was: In Progress)

Plan updates:                              ← omit if no plan statuses changed
   - "Plan Title" → done (all tasks completed)

Pre-push validation: Passed (Husky)        ← or: No hooks detected

Pre-push fixes:                            ← omit if no failures were fixed
   - Fixed 3 test failures in mcp.test.ts (commit abc1234)

Branch: <branch name>
Ahead by <N> commit(s)
```

**Rules:**

- List all created commits with short SHA and first line (including any fix commits from Phase 8)
- Omit the TODO and Plan sections entirely if nothing changed
- Always show pre-push validation result and branch status
- If pre-push failed and could NOT be fixed, explain what failed in one line
- No emojis, no "complete!" banners, no trailing `git push` reminders

## Important Notes

### No External Task IDs in Commits

**CRITICAL**: External task/ticket IDs are internal to the operator and MUST NOT appear in commit messages.

- ❌ "feat(cli): implement task 1.2 - selective install"
- ❌ "fix(paths): resolve issue in task 5"
- ❌ "Task: #1.2" in commit footer
- ✅ "feat(cli): add selective tool installation"

### Grouping Philosophy

**Files that belong together:**

- Implementation + corresponding tests
- Feature + documentation
- Related bug fixes
- Build configuration changes

**Files that should be separate commits:**

- Unrelated features
- Different bug fixes
- Independent refactorings
- Feature + unrelated dependency updates

### Hook Compliance

**Always respect git hooks:**

- Husky pre-commit hooks validate code quality
- Commit-msg hooks enforce conventional commits
- Never use `--no-verify` unless explicitly approved by user
- Fix issues rather than bypassing hooks

### Multi-Commit Benefits

**Why create multiple commits:**

- Clear history - each commit has single purpose
- Easy review - reviewers understand changes per commit
- Better rollback - revert specific changes without affecting others
- Semantic grouping - related changes stay together

**When to use single commit:**

- User provides `--message` flag (bypasses grouping)
- Small changesets (< 5 files, all related)
- Trivial changes (formatting, typos, dependency updates)
