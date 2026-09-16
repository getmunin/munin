---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Check that fixture data cannot identify a real person.

Fixture data is a published surface. Test files and changelog prose reach
tarballs, release notes and pull request descriptions, and not all of those can
be retracted later, so the useful guarantee is that a fixture never refers to
anyone real in the first place.

`scripts/check-fixture-pii.mjs` now runs in pre-commit and in CI. Email
addresses must sit on a reserved domain — `.test`, `.example`, `.invalid`,
`example.com`, `example.no` — which can never be registered. Norwegian phone
numbers must use a national number starting `0` or `1`; Norway assigns
subscriber numbers starting 2-9, so a number that was invented may still be
assigned to someone.

Both rules have an allow-list keyed by reason rather than a bare list of
strings, so adding an entry is a visible decision. Numbers that must parse as
valid are the reason the phone allow-list exists at all: the inbox formatting
tests assert libphonenumber's grouping, which it applies only to numbers it
considers real, so those fixtures cannot use an unassignable number.
