# Demo Transcript

```text
$ tedge run "fix failing test" --headless
planner: extracts task and risk
explorer: selects visible repo files
coder_a/coder_b: prepare offline candidates
reviewer: scores candidates
judge: requests revision when no concrete diff exists
summarizer: writes local session artifact
```

```text
$ tedge run "fix failing test" --headless --provider fixture --approve-patch --approve-shell
planner: extracts task and risk
explorer: selects index.js, package.json, test.js
coder_a: proposes a minimal index.js patch
coder_b: proposes an inferior alternative
reviewer: recommends coder_a
judge: selects fixture_candidate_a
runner: applies patch after explicit approval
runner: runs npm test after explicit approval
summarizer: records changed file, test evidence, and session artifact
```
