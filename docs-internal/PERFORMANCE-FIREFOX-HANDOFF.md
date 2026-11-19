# Performance evidence → Firefox energy experiment: handoff learnings

Status: **first end-to-end handoff demonstrated; result was a consistent null.**

This records the cross-project work between Vital Core and
[firefox-energy-scanner](https://github.com/mgifford/firefox-energy-scanner).
It is not a claim of measured energy savings.

## What now exists

- Vital Core publishes `performance-investigation/1` candidates from stored
  Lighthouse and Resource Timing evidence.
- Firefox has an opt-in `--from-vital` path that reads a saved snapshot or an
  explicit HTTPS snapshot URL.
- Resource-level candidates map to Firefox `block` specs only when there is a
  representative page and a specific host/URL.
- Component, page-family, slow-page, regression and Lighthouse-recommendation
  candidates are rejected unless Vital Core supplies a real selector/experiment.
- Generated specs use `runs: 10`, `warmups: 2`, `idle_ms: 10000` and a
  conservative `role=main` assertion. The assertion must be strengthened before
  the experiment is treated as a functional test.

Vital Core changes made for this handoff:

- resource candidates now carry a representative `page.url` from existing
  resource examples;
- the investigation cap is 30, so high-transfer third-party resources are not
  hidden behind render-blocking CSS;
- the queue keeps its existing observation/hypothesis/limitation language.

## The demonstrated experiment

Candidate:
`third-party-resource:https://cdn.jsdelivr.net/bluebird/3.5.0/bluebird.min.js`

Intervention: block the entire `jsdelivr.net` host. This is an upper bound, not
the Bluebird-only change. The block removed 108 requests and two focusable/form
controls on the page.

Two clean sessions on an Apple M2, AC power, Low Power Mode off, 10 runs per
side and 2 warm-ups:

| Session | Load (baseline → variant) | Idle (baseline → variant) | Finding |
| --- | --- | --- | --- |
| 1 | 0.632 → 0.612 mWh, IQR 0.034 / 0.016 | 0.178 → 0.179 mWh, IQR 0.013 / 0.025 | no difference |
| 2 | 0.517 → 0.522 mWh, IQR 0.038 / 0.031 | 0.149 → 0.147 mWh, IQR 0.016 / 0.012 | no difference |

### Conclusion

For this page, host block and workload, blocking jsdelivr.net did **not** show a
measurable client-energy difference. This is a null result, not proof that the
resource has no cost elsewhere.

The earlier one-run smoke test reported an indicative 29.8% idle reduction. The
two full sessions showed that this was noise. **Never promote a one-run
indicative result to a finding.**

The result is two sessions on one machine/operator, not independent external
replication. The `role=main` assertion passed, but the page lost two controls;
the host block is therefore not a production recommendation.

## Why host blocking is only an upper bound

`third-party-resource-concern` candidates currently map to a host block. That
can refuse every resource from that host, not only the named resource. It tests
“what if this host disappeared”, not “what does Bluebird cost”. A narrower test
requires blocking the exact resource URL or removing a specific component.

The generated spec note preserves this limitation. Keep it.

## Operational lessons

- Build/run Firefox from its own repository; `vital-core` has no
  `dist/cli/index.js`.
- `npm install && npm run build` creates `dist/`; `doctor` confirms host support.
- Use `mkdir -p experiments` before `--save-spec experiments/...`; the CLI does
  not create parent directories.
- Prefer tracked `examples/experiments/*.yaml` for reproducible specs.
- Shell placeholders such as `<candidate-id>` are redirections in zsh. Use a
  quoted variable or a real ID:
  `CID=$(jq -r ...); --candidate "$CID"`.
- Select candidate IDs from `performance.investigations.candidates`, not from
  `performance.resources`.
- A resource being present in the inventory does not mean it is a published
  candidate; the candidate queue is bounded.
- `doctor` warnings for battery or Low Power Mode invalidate energy comparison.
  Do not mix those runs with clean runs.
- A null result is a valid result. Report it as null.

## Evidence boundaries

Keep these separate:

- Vital Core Lighthouse lab metrics
- Vital Core Resource Timing observations
- CO₂.js modelled emissions and derived energy
- Firefox observed client energy
- Grid-derived carbon

Do not turn a host block into an energy-saving claim, or a modelled estimate into
a measurement.

## Next, only if useful

1. Run the exact Bluebird URL block rather than the whole jsdelivr host.
2. Add a real functional assertion for the page before treating the host block
   as safe.
3. Test a high-transfer candidate such as Qualtrics, now that it can survive the
   candidate cap, with matching functional assertions.
4. Add a machine-readable `experiment` field to Vital Core candidates:
   `kind`, `host`/`url` or `selector`, `page.url`, workload and assertions.
5. Independently replicate any non-null result on another machine/session.

Do not schedule automatic energy experiments or claim energy savings from this
pilot.
