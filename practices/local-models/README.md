# Local Models

Running Claude Code against a model on your own machine instead of the hosted
one. Nothing leaves the laptop, nothing is metered, and it works on a plane.
The trade is capability: the best model that fits in 48 GB is not close to the
hosted model on multi-step agentic work.

Use it for the cases where that trade is worth it, not as a replacement.

## Why This Works Now

Claude Code talks to whatever `ANTHROPIC_BASE_URL` points at, as long as that
endpoint speaks Anthropic's Messages API. [LM Studio](https://lmstudio.ai) added
a native `/v1/messages` endpoint, so tool calls round-trip unchanged.

That last part is the whole reason to pick LM Studio over Ollama. Ollama serves
an OpenAI-shaped API, so a proxy has to translate tool-call blocks in both
directions, and Claude Code — which is almost entirely tool calls — trips over
the lossy conversion. With a native endpoint there is no translation layer to
get wrong.

## Install

```bash
npx @lekman/claude-local
```

On first run it offers a checkbox list — the core pack (LM Studio and its `lms`
CLI) is always included, models are yours to pick — then downloads what is
missing, starts the server, loads the main model with a context window sized to
your RAM, and hands you Claude Code. On every run after, it just starts.

```bash
claude-local            # local model
claude                  # hosted model, unchanged
claude-local --switch   # swap which local model is loaded
```

The first two are kept apart on purpose. Nothing is exported into your shell and
no wrapper script is written; the `ANTHROPIC_*` variables are built at launch and
handed to the child process only. A stray `ANTHROPIC_BASE_URL` in a shell profile
would silently redirect every ordinary session to the weaker model, and you would
notice that as confusing quality rather than as an error.

Flags and the full command reference are in
[packages/claude-local/README.md](../../packages/claude-local/README.md).

## Models for 48 GB

Unified memory holds the model weights _and_ the context. macOS caps GPU-wired
memory at roughly 75% of RAM by default, so on 48 GB the working budget is about
36 GB. A 4-bit 30B model at 64k context lands near 24 GB, which is comfortable.

| Model               | Key                      | Size   | Notes                                                                                                                                      |
| ------------------- | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Qwen3-Coder 30B A3B | `qwen/qwen3-coder-30b`   | ~17 GB | The default. MoE, 3.3B active, so it runs at roughly 30 tok/s. Trained for agentic coding: tool calls and file edits, not just completion. |
| Gemma 4 26B A4B     | `google/gemma-4-26b-a4b` | ~16 GB | Stronger general reasoning, weaker at tool-call discipline. Good second opinion, poor driver.                                              |
| Gemma 4 31B         | `google/gemma-4-31b`     | ~19 GB | Dense, so higher per-token quality and noticeably slower.                                                                                  |
| Gemma 4 E4B         | `google/gemma-4-e4b`     | ~6 GB  | Installed as the background model, for titles and summaries. Not for real work.                                                            |

Setup pre-checks the first and the last: Qwen3-Coder as the model you work with,
Gemma 4 E4B as the background one, ~23 GB together. The other two are unchecked,
because only one model fits in memory at a time — adding them means swapping,
not running both.

To swap, at setup time or any time after:

```bash
claude-local --switch                         # pick from a list
claude-local --model google/gemma-4-31b       # or name it, then launch
claude-local --status                         # what is downloaded and loaded
```

It downloads the model if it is missing, starts the server if it is down,
unloads what is resident, loads the new one at the right context size, and
repoints `claude-local`. The same thing by hand, if you would rather see it:

```bash
lms get google/gemma-4-26b-a4b --mlx           # download, ~16 GB
lms unload --all                               # free the memory Qwen is holding
lms load google/gemma-4-26b-a4b --context-length 65536 --gpu max
```

**Not on this machine:** Qwen3-Coder-Next (80B MoE) is the best local option for
Claude Code, but even at 4-bit it needs more than 48 GB once context is added.
The 8-bit build of Qwen3-Coder 30B is ~32 GB, which leaves nothing for context —
worth trying at 96 GB and up, not here.

## What to Expect

Be clear-eyed about this before you rewire your workflow.

- **Quality.** A local 30B handles single-file edits, tests, refactors, and
  explanations. It degrades on long multi-step tasks — the kind where Claude
  Code plans, reads six files, and threads a change through them.
- **Speed.** About 30 tokens/sec. Every tool call is a round trip, so an
  agentic loop that the hosted model finishes in a minute can take ten.
- **Context.** Coding agents burn context fast. Below 32k the model is unusable
  for anything but a single file, which is why setup loads at 64k or better.
- **Heat and battery.** Sustained inference pins the GPU. On battery, expect the
  fans and a fast drain.

Where it earns its place: code you are not allowed to send to a third party,
offline work, throwaway loops you do not want to pay for, and testing whether a
prompt or skill depends on model strength.

## Tuning

Raise the GPU memory cap if you want a 128k context window. This is not
persistent across reboots:

```bash
sudo sysctl iogpu.wired_limit_mb=40960
```

Leave at least 8 GB for macOS. Setting this too high makes the system swap,
which is slower than the smaller context you were avoiding.

## Undo

```bash
claude-local --stop
rm ~/.claude/claude-local.json
npm uninstall -g @lekman/claude-local     # if you installed it globally
brew uninstall --cask lm-studio
rm -rf ~/.lmstudio        # downloaded models, tens of GB
```

`claude` itself is never modified, so uninstalling is enough to go back.

## Sources

- [Claude Code with LM Studio](https://lmstudio.ai/docs/integrations/claude-code)
- [LM Studio Anthropic compatibility endpoints](https://lmstudio.ai/docs/developer/anthropic-compat)
- [lms CLI reference](https://lmstudio.ai/docs/cli)
- [Gemma 4 in the LM Studio catalog](https://lmstudio.ai/models/gemma-4)
