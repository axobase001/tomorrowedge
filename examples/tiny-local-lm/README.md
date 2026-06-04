# Tiny Local LM Demo

A locally runnable small-parameter language model demo for TomorrowEdge 0.4.1 acceptance.

## Setup

```bash
npm install
npm start
```

Open `http://127.0.0.1:8787`.

## API

- `GET /health`
- `GET /model-info`
- `POST /generate`

Example:

```bash
curl -s http://127.0.0.1:8787/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"TomorrowEdge routes","temperature":0.8,"maxTokens":80}'
```

## Tests

```bash
npm test
npm run api:smoke
npm run frontend:build
npm run verify
```

## Notes

The model is a tiny local character-level n-gram model. It does not call OpenAI, OpenRouter, or any other cloud API. It is useful for validating a TomorrowEdge workflow that delegates planning, coding, review, repair, and final judgment while keeping implementation small enough to run on an ordinary machine.
