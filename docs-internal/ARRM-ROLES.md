# ARRM role mapping

Source: [W3C WAI Accessibility Roles and Responsibilities Mapping (ARRM)](https://www.w3.org/WAI/planning/arrm/)
tasks, pinned to commit `70f9d027d7a87ab72058ded2037915a76795e46a`
(`_data/arrm/arrm-all-tasks.csv`, fetched 2026-11-11).

The bundled file is `src/data/arrm-tasks.json`; the lookup is
`src/lib/arrm.js`.

## Semantics

- Findings are joined to ARRM tasks by their **WCAG success criterion**.
- The Explorer's **ARRM role** filter uses task **primary ownership** roles:
  Content Authoring, Front-End Development, User Experience (UX) Design,
  Visual Design and Business Analysis.
- A finding can map to several tasks and roles. The filter matches if any
  primary role matches.
- This is **not** an assignment for a specific finding, team or organization.
  It is a typical-responsibility lookup; the UI says so.
- ARRM includes 4.1.1 because it maps WCAG 2.0 tasks. VITAL labels 4.1.1 as
  removed in WCAG 2.1 and excludes it from the WCAG 2.2 A/AA ACR catalog.
  Its ARRM mapping does not make it a WCAG 2.2 criterion.

Secondary/contributor roles are retained in the source JSON for future use but
are not used for the primary filter.

## Refresh

Fetch the pinned CSV and regenerate the JSON if the ARRM source changes. The
`source.revision` field must be updated to the new commit; do not point at
`draft` or `main` in the bundled file.
