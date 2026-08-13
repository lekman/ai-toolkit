# @lekman/claude-local

Run Claude Code against a model on your own machine. One command.

Apple Silicon only. The practice behind it — why local, what it costs, and when
it is the wrong choice — is in
[practices/local-models/README.md](../../practices/local-models/README.md).

## Use

```bash
npx @lekman/claude-local
```

That is the whole thing. On first run it installs the backend, downloads a
model, and starts Claude Code against it. On every run after, it just starts.

Install it properly once and the name is shorter:

```bash
npm install -g @lekman/claude-local
claude-local
```

The published package bundles its dependencies, so `npx` installs nothing and
starts cold in about a second. Node 20 or later is the only requirement — Bun
builds it, users never need Bun.

## Commands

```bash
claude-local                    # launch (installs the backend on first run)
claude-local --switch           # pick a different model
claude-local --model <key>      # switch to that model, then launch
claude-local --setup            # re-run the installer
claude-local --status           # what is downloaded, loaded, and serving
claude-local --stop             # unload the model and free the memory
```

| Flag            | Effect                                |
| --------------- | ------------------------------------- |
| `--port <n>`    | Server port (default 1234)            |
| `--context <n>` | Context window when loading a model   |
| `--yes`, `-y`   | Accept defaults during setup          |
| `--no-launch`   | Do the work, do not start Claude Code |
| `--help`, `-h`  | Usage                                 |

### Passing flags to Claude Code

The reserved flags above are handled here. The first token that is not one of
them ends the parsing, and everything from there goes to `claude` untouched:

```bash
claude-local -p "fix the failing test"
claude-local --model qwen/qwen3-coder-30b --resume
claude-local -- --help              # claude's help, not this one
```

`--model` is the one word both tools use. Here it always means the local model,
because choosing that is the reason this wrapper exists. To reach Claude Code's
own `--model`, put it after `--`.

## First run

```text
◆  What should be installed?
│  ◼ Core pack
│     LM Studio and its lms CLI — always installed
│  ◼ Qwen3-Coder 30B A3B  17 GB
│     The one you work with. MoE, 3.3B active, ~30 tok/s.
│  ◼ Gemma 4 E4B  6 GB
│     Background model for titles and summaries.
│  ◻ Gemma 4 26B A4B  16 GB
│  ◻ Gemma 4 31B  19 GB
```

Anything that will not fit in your machine's memory is left out of the list
rather than offered and then failing. Setup then downloads what is missing,
starts the server, and loads the main model with a context window sized to your
RAM.

## Switching models

Only one model fits in unified memory at a time, so `--switch` swaps rather than
adds: start the server, unload what is resident, load the new one at a size the
machine can hold, and record it as current. Models in the catalog that are not
downloaded yet are offered too, and fetched on demand.

## What It Writes

| Path                          | Purpose                             |
| ----------------------------- | ----------------------------------- |
| `~/.claude/claude-local.json` | Current model, port, context window |
| LM Studio's own model store   | The weights, tens of GB             |

Nothing else. No wrapper script, no shell profile edits, no exported variables.
The `ANTHROPIC_*` variables that point at localhost are built at launch and
handed to the child process only.

That is deliberate. A stray `ANTHROPIC_BASE_URL` in a `.zshrc` would silently
send every ordinary `claude` session to the weaker local model, and you would
notice it as confusing quality rather than as an error. Here `claude-local` is
local and `claude` is untouched, in the same terminal, at the same time.

## Undo

```bash
claude-local --stop
rm ~/.claude/claude-local.json
npm uninstall -g @lekman/claude-local
brew uninstall --cask lm-studio
rm -rf ~/.lmstudio            # downloaded models, tens of GB
```

## Contributing

Building, testing, and releasing this package: [CONTRIBUTING.md](CONTRIBUTING.md).
