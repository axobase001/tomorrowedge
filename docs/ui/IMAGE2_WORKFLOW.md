# Image2 Component Workflow

This project can generate UI components with the bundled imagegen fallback CLI when `OPENAI_API_KEY` is set locally.

Local findings:

- CLI path: `%USERPROFILE%\.codex\skills\.system\imagegen\scripts\image_gen.py`
- command: `generate-batch`
- CLI default model: `gpt-image-2`
- current environment check during setup: `OPENAI_API_KEY` was missing

Official OpenAI docs currently describe the Image API generation endpoint and GPT Image model parameters. They do not guarantee that every local skill default is enabled for every account, so if `gpt-image-2` returns `model does not exist`, switch the prompt pack to an available GPT Image model for that account.

## Generate Components

Dry-run:

```powershell
.\docs\ui\scripts\generate-image2-components.ps1 -DryRun
```

Real run:

```powershell
$env:OPENAI_API_KEY = "<set locally, do not commit>"
.\docs\ui\scripts\generate-image2-components.ps1
```

Outputs:

```text
output/imagegen/tomorrowedge-components/
```

## Component Prompts

Prompt JSONL:

```text
docs/ui/image2-components/prompts.jsonl
```

The prompts generate five pieces:

1. header and safe-mode strip
2. agents and router panes
3. diff and approval pane
4. debate and evidence panes
5. shell, memory, and help panes

## Assembly

Current hand-assembled visual reference:

```text
docs/ui/tomorrowedge-cockpit-v2.html
```

Once generated PNG components exist, they can be placed into the same layout or used as visual references while implementing the actual Ink panes.
