---
'@getmunin/backend-core': patch
---

Treat a DMARC result that is neither `pass` nor `fail` as unknown, not as a failure.

`evaluateInboundEmailAuth` refused every DMARC result it could not read as `pass`, so
`dmarc=none` — what `mailauth` writes when the From domain publishes no DMARC record at all —
was recorded as `fail` and refused self-service booking writes. That is the opposite of the rule
the gate was built for: a domain without a DMARC record is a sender we cannot check, not
evidence of forgery, and it was listed as a limit deliberately left open. `dmarc=temperror` (a
DNS timeout during the lookup) and `dmarc=permerror` (a malformed record) refused the write for
the same reason, turning a transient resolver failure into a guest who cannot move their table.

Only an explicit `dmarc=fail`, or a header carrying more than one DMARC result, is a failure now.
Everything else that is not an aligned `pass` is `unknown`, which reads and books as before.
