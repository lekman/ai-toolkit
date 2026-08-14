---
paths:
  - "packages/**/*.ts"
  - "packages/**/*.tsx"
---

# Clean Architecture Rules

## Module Structure

Each domain lives in its own folder with an `index.ts` barrel:

```ini
src/
├── {domain}/
│   ├── index.ts                  # Barrel: public exports only
│   ├── types.ts                  # Types, value objects, enums — no classes
│   ├── {name}.ts                 # Business logic class (static methods)
│   ├── interfaces.ts             # Port interfaces (contracts for adapters)
│   └── {domain}.system.ts        # System layer: I/O wrappers
```

### File Naming

| File                 | Contains                                                    | Example                                                           |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `types.ts`           | Type aliases, interfaces, value objects, enums, no classes  | `FormatterOptions`, `ScanMode`                                    |
| `{name}.ts`          | Business logic as a static class                            | `formatter.ts` → `Formatter`, `security-scan.ts` → `SecurityScan` |
| `interfaces.ts`      | Port interfaces: contracts that adapters implement          | `IChunkStore`, `IEmbeddingsProvider`                              |
| `{domain}.system.ts` | Adapter implementations (I/O, network, filesystem)          | `LanceDbChunkStore`                                               |
| `index.ts`           | Barrel re-exports. No logic.                                | `export { Formatter } from "./formatter"`                         |

Business logic classes go in a named file, not in `types.ts`. If `types.ts` contains a class, the class belongs in its own file.

Do not use `{domain}-interface.ts` as a file name. Port interfaces go in `interfaces.ts`.

Consumers import from the barrel, not from internal files:

```typescript
// Good
import { Bootstrap } from "@src/bootstrap";

// Avoid
import { Bootstrap } from "@src/bootstrap/types";
```

## `*.system.ts` Naming

Any file that makes a system call (reads files, writes files, executes shell commands, makes network requests) **must** use the `.system.ts` suffix.

A single glob (`**/*.system.ts`) in `bunfig.toml` excludes all of them from coverage. These files contain no business logic, only thin wrappers.

```typescript
// bootstrap.system.ts — thin wrapper, no business logic
export class FileSystemSystem implements IFileSystem {
  async writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
  }
}
```

Never put business logic in a `*.system.ts` file.

## Dependency Injection Through Interfaces

Define a contract (`interfaces.ts`), implement it in the system layer, and accept the interface in business logic with the concrete implementation as default:

```typescript
// interfaces.ts
export interface IFileSystem {
  exists(path: string): boolean;
  writeFile(path: string, content: string): Promise<void>;
}

// Business logic accepts the interface with production default
export async function run(
  args: string[],
  fs: IFileSystem = defaultFileSystem,
): Promise<void> {
  // ...
}
```

## Namespaced Static Class Exports

Group related functions under a class with static methods. Factory classes use static factory methods, not loose exported functions.

```typescript
// Good — static class with factory methods
export class StoreClient {
  static createAzureSearchClient(endpoint?, indexName?): IChunkStore { ... }
  static createLocalClient(dataDir?): IChunkStore { ... }
}

// Avoid — loose functions
export function createLocalClient(dataDir) { ... }
export function createAzureSearchClient(endpoint, indexName) { ... }
```

`perfectionist/sort-classes` ESLint rule enforces alphabetical ordering of static methods.

## Convenience Exports

When a class has a primary factory method, export a convenience alias or singleton at module level:

```typescript
// Singleton — reads from env vars, ready to use
export const localStore = StoreClient.createLocalClient();

// Consumer usage:
import { localStore } from "@lekman/rag-core";
const [chunks, error] = await localStore.search("expense policy");
```

The factory method should default its parameters to environment variables so the singleton works without arguments. Consumers who need explicit configuration use the class directly:

```typescript
import { StoreClient } from "@lekman/rag-core";
const store = StoreClient.createLocalClient("/custom/data/dir");
```

## Business Capability Naming

Name classes by what they do, not the tool they use:

```typescript
// Good — business capability
class Bootstrap { static buildCopyPlan(...) }
class Formatter { static process(...) }

// Avoid — tool name in API
class BunFileWriter { ... }
class JSZipDocxProcessor { ... }
```

## Unit Tests Without Mocks

Business logic functions should be pure: they only transform inputs. Unit tests pass values directly with no mocks.

Only the system layer makes system calls, and it is excluded from coverage.

For integration tests that test the full pipeline, use mocks from `tests/mocks/`:

```typescript
// tests/mocks/file-system.mock.ts
export class FileSystemMock implements IFileSystem {
  writtenFiles = new Map<string, string>();
  exists(path: string): boolean {
    return false;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.writtenFiles.set(path, content);
  }
}
```

## Coverage Configuration

`bunfig.toml`:

```toml
[test]
coveragePathIgnorePatterns = [
  "**/*.system.ts",  # System wrappers — no business logic
  "**/index.ts",     # Barrel re-exports — no business logic
  "tests/**",
  "**/*.test.ts",
]
```

## Anti-Patterns

**Never put business logic in `*.system.ts`:**

```typescript
// Bad — validation in system file
export class FileSystemSystem implements IFileSystem {
  exists(path: string): boolean {
    if (!path) throw new Error("Empty path"); // WRONG — this is business logic
    return existsSync(path);
  }
}
```

**Never depend on a concrete system class:**

```typescript
// Bad — depends on concrete class
async function run(fs: FileSystemSystem) { ... }

// Good — depends on interface
async function run(fs: IFileSystem = defaultFileSystem) { ... }
```

**Never put business logic classes in `types.ts`:**

```typescript
// Bad — class in types.ts
src / formatter / types.ts; // contains Formatter class + FormatterOptions

// Good — class in its own file
src / formatter / formatter.ts; // Formatter class
src / formatter / types.ts; // FormatterOptions interface only
src / formatter / interfaces.ts; // IChunkStore port interface
```
