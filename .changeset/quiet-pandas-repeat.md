---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
---

Keep real people out of published surfaces, starting before the write

Fixtures, changesets, commit messages and pull request bodies all end up
somewhere that cannot be fully retracted — a tarball, a changelog, a release
note. The existing fixture check caught email addresses and Norwegian phone
numbers in committed files, which left three gaps: numbers from every other
country, hostnames (a customer's own domain identifies them as surely as their
address does), and the surfaces that are not files at all.

The detection rules now live in one module behind four gates: the tracked-file
scan, the commit message, the pull request title and body in CI, and a
PreToolUse hook that inspects what an agent is about to write before the write
lands. Phone numbers are checked against the unassignable ranges of every
numbering plan rather than one country's, and hostnames are held to the same
reserved-domain rule as email.

Read paths are deliberately untouched. Querying live data to diagnose a problem
is the point of having the tools; only the flow of that data back into the
repository is gated. Fixtures carrying assignable numbers have been moved into
reserved ranges, and the three allow-lists remain the review checkpoint.
