---
'@getmunin/agent-runtime': patch
---

Trim the assistant turn before it becomes a reply draft or an outgoing message. Qwen3-family models served over an OpenAI-compatible endpoint hand back content that still carries the chat template's `<think>\n\n</think>` residue as two leading blank lines, so every draft opened in the dashboard started with an empty gap. The final body is now newline-normalised: CRLF folded, runs of three or more newlines collapsed to one blank line, and leading/trailing whitespace stripped. Paragraph breaks and single newlines inside a paragraph are untouched.
