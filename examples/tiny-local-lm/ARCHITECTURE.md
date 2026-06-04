# Tiny Local LM Architecture

This demo is intentionally small and local. It is not a production language model.

## Components

- `src/model.js`: a character-level n-gram model with a tiny transition table.
- `src/server.js`: a Node HTTP server with `/health`, `/model-info`, and `/generate`.
- `public/`: a static frontend for prompt input, generated text, temperature, and max token controls.
- `tests/`: unit and API smoke tests using Node's built-in test runner.

## Model

The model learns transition counts from a short embedded corpus. At generation time it looks up the longest available suffix of the prompt and samples the next character with temperature-adjusted weights. The parameter count is the number of stored transition entries plus the global vocabulary size.

## Limitations

- It is a toy model, so generated text is often repetitive.
- It has no tokenizer, transformer layers, training loop, or external corpus loader.
- It does not call OpenAI, OpenRouter, or any cloud model API.
- It is designed for TomorrowEdge orchestration acceptance, not quality text generation.
