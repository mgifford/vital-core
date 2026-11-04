# Plan

1. Reuse Phase B correlations and existing ranking/redaction; add one shared reporting projection. Check raw immutability, complete duplicate grouping, URL evidence and sanitization.
2. Wire the projection into API v1 and server-rendered HTML; expose raw engine impact without changing legacy severity. Check old fields, IDs and no-JavaScript content.
3. Document additive fields and MCP passthrough. Run full unit/e2e, locale and governance checks. Commit locally only.

Scope: reporting projection, bug report metadata, HTML, API schema/documentation, MCP descriptions and neighboring tests.

Rollback: revert the Phase E commit; no stored data, IDs, URL identities or ledgers are migrated.

Ownership: reusable vital-core enhancement, not a fleet override. Uses installed contracts and parse5, not a new scanner or integration package.