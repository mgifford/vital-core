# Data Model: Move `data/` into a companion repo

This mission changes where `data/` is stored and tracked, not its shape.
No new entities, fields, or schemas are introduced. Documenting the storage
boundary here for completeness since a "data model" section is expected.

## Entities (unchanged content, changed location)

| Entity | Current location | New location | Schema change |
|---|---|---|---|
| Per-domain weekly summaries (`summary.json`) | `data/<domain>/<week>/summary.json`, tracked in `vital-core` | same relative path, tracked in `vital-core-data` | none |
| Ledgers (`findings.json`, `resources.json`, `third-parties.json`, etc.) | `data/<domain>/<week>/*.json`, tracked in `vital-core` | same relative path, tracked in `vital-core-data` | none |
| Page-level detail (`pages/`, `runs/`) | `data/<domain>/<week>/pages/…`, tracked in `vital-core`, pruned after `retention_weeks` | same, tracked in `vital-core-data`, same pruning behavior via `src/prune.js` (unchanged) | none |
| `data/.last-report-date` | tracked in `vital-core` | tracked in `vital-core-data` | none |

## Relationships

Unchanged: `src/aggregate.js` reads `data/**` and writes `docs/**` +
`docs/api/v1/**`. The only change is that `data/` is now populated by a git
checkout of a different repo rather than being part of `vital-core`'s own
working tree contents at `HEAD`. `docs/` (built output, already gitignored
locally / deployed as a GitHub Actions artifact) is unaffected.

## Companion repo (`vital-core-data`) internal layout

Mirrors `vital-core`'s current `data/` tree exactly (see R3/R4 in
`research.md`):

```
vital-core-data/
└── <domain-key>/
    └── <ISO-week>/
        ├── summary.json
        ├── findings.json
        ├── resources.json
        ├── third-parties.json
        ├── pages/          # pruned after retention_weeks
        └── runs/           # pruned after retention_weeks
```

No new fields are added to any of these files as part of this mission
(NFR-01).
