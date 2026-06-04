# Tiny Local LM Architecture

This demo is intentionally small and local. It is not a production language model.

## Components

- `src/model.js`: a bilingual hashed neural n-gram model with dense local parameter arrays and transition boosts.
- `src/server.js`: a Node HTTP server with `/health`, `/model-info`, and `/generate`.
- `public/`: a static frontend for prompt input, generated text, temperature, and max token controls.
- `tests/`: unit and API smoke tests using Node's built-in test runner.

## Model

The model builds a generated Chinese/English corpus, learns character n-gram transition counts, and allocates dense local parameters:

- context bucket embeddings
- output character embeddings
- output bias values
- n-gram transition entries

At generation time it hashes the recent context into a bucket, scores every vocabulary character with dense embedding similarity, adds transition-count boosts, applies a light Chinese/English continuity bias, then samples with temperature.

## Limitations

- It is a toy model, so generated text is often repetitive and not instruction-following.
- It has no tokenizer, transformer layers, training loop, or external corpus loader.
- It does not call OpenAI, OpenRouter, or any cloud model API.
- It is designed for TomorrowEdge orchestration acceptance, not quality text generation.
