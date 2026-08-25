---
'@getmunin/chat-widget': minor
'@getmunin/agent-runtime': minor
'@getmunin/docs-pages': minor
---

Widget speaks eight more languages: Estonian, Latvian, Lithuanian, Czech, Slovak, Hungarian,
Romanian and Nynorsk.

The set was Nordics + Western Europe + Polish, which left conspicuous holes: the Baltics, where a
Nordic-first product's customers already operate as one region, and Central Europe, where Polish was
in but its neighbours were not. Twenty-one locales now ship: `en nb nn da sv fi is et lv lt de fr es
it pt nl pl cs sk hu ro`.

Nynorsk is the odd one out and the cheapest: it was previously *aliased away* — `nn`, `nno` and `nn-NO`
all resolved to Bokmål. It now has its own strings, so `nn` gets Nynorsk while `no`, `nob` and `nor`
stay on Bokmål. Norwegian public bodies are obliged to serve both written standards, which makes this
closer to a requirement than a nicety for public-sector deals.

Locales are statically imported, so every visitor downloads every language. Measured cost of the
eight: **+4.4 KB gzipped** on the widget bundle (174.1 → 178.6 KB), about 0.55 KB per language.

`FALLBACK_LOCALES` in `@getmunin/agent-runtime` mirrors the widget list and moves with it, so the
runtime's canned greeting and handover notice speak the new languages too rather than silently
dropping to English. The chat-widget guide documents `data-munin-locale` for the first time — the
attribute has existed since the widget shipped, was described in `skill://conv/setup-chat-widget`,
and was missing from the human-facing optional-attributes list.

Translation notes worth a native reviewer's eye before this reaches production traffic: register is
informal for Estonian and Nynorsk, polite for Latvian, Lithuanian, Czech, Slovak, Hungarian and
Romanian, matching how support desks in each market actually address customers. Where a template
interpolates an agent's name into a case-inflecting language, the copy uses a colon form
(`Kõne: {who}`, `Hovor: {who}`, `Hívás: {who}`) rather than a preposition that would demand a
declined name. The Romanian month abbreviation `{n} l` and the Estonian `{n} k` are the two terse
relative-time strings most likely to want a second opinion.
