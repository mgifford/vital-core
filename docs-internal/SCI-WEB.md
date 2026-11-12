# SCI-Web design note

Status: **research/design note, no implementation.**

Source: W3C Sustainable Web WG SCI-Web draft snapshot
`68032f4b101f9532a4a8a5eff93f1e6a2ecf0635` (July 2026 snapshot).
The spec is still a draft and says the methodology is being assembled section
by section. Do not claim VITAL produces an SCI-Web score.

## What VITAL measures now

`src/engines/sustainability.js` records, per page:

- browser-observed decoded response bytes and requests by resource type;
- CO₂e using the **Sustainable Web Design v4** model from `co2.js`;
- derived energy using the model's grid intensity.

Reports call these estimates and use them for week-over-week direction, not
carbon accounting. That remains correct.

## Why this is not SCI-Web

SCI-Web is a **rate** (emissions per functional unit), with a documented
software boundary and per-component implementation tiers. VITAL currently has:

| SCI-Web expectation | VITAL now |
|---|---|
| Explicit functional unit | Not recorded; pages are sampled independently |
| O_server | No server-side energy or PUE data |
| O_network | Byte-based SWD estimate; no time-based network measurement |
| O_client | No device/CPU telemetry; browser bytes only |
| Third-party attribution | Inventoried, not apportioned as emissions |
| Embodied emissions (M) | Not measured |
| Per-component tiers | Not measured |
| Disclosure profile / structural limits | Partial prose caveats, no structured profile |
| Score comparability | Not applicable; no SCI-Web score |

## Recommended incremental path

1. **Label honestly.** Keep “estimated page-weight/CO₂ trend”, never “SCI-Web
   score” or “carbon footprint” without a boundary.
2. **Add a measurement-profile field** to the sustainability record:
   `functional_unit: page-view`, `boundary: client-network-transfer-only`,
   `model: swd-v4`, `limitations: [...], spec_revision`.
   Additive; no historical schema break.
3. **Use Resource Timing duration** where available to support a future
   time-based network tier; do not replace the SWD fallback until the spec
   stabilises and the data is validated.
4. **Do not infer server/embodied/device emissions** from page bytes.
5. Revisit per-component tiers after the spec’s implementation-tier and
   disclosure sections are final.

## Decision

No scanner or report implementation now. The honest current output is a
page-weight/CO₂ trend, not an SCI-Web conformance score. This note records the
gap so future work does not mislabel it.
