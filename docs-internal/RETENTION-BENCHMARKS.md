# Retention archive benchmarks

Measured on 2026-11-11, Node 22, macOS, using synthetic page records
(~132 bytes each) and the in-memory `buildArchive` path. These are size/shape
measurements, not production SLA claims.

| URLs | Input bytes | ZIP bytes | Generation | Max RSS after |
|---:|---:|---:|---:|---:|
| 1,000 | 132,080 | 311,501 | 84 ms | ~76 MB |
| 10,000 | 1,340,780 | 3,129,886 | 502 ms | ~266 MB |

Observations:

- Tiny JSON records are dominated by ZIP per-entry overhead (local header,
  central directory, filename). ZIP can be larger than input for this shape.
  Real page evidence contains more content and usually compresses better.
- 10,000 entries fit comfortably in memory on a normal CI runner.
- The current implementation is not streaming: it builds the full ZIP buffer
  and then the upload/download verification buffers. Peak memory tracks archive
  size plus browser/report work.
- A 100,000-entry fixture is not supported by the conventional ZIP format:
  `createZip` now fails with a clear 65,535-entry error instead of a low-level
  RangeError. No partial archive is written.
- The writer is ZIP32: individual entries and offsets must stay under 4 GiB.
  Archives that approach these limits need ZIP64 or a partitioned archive
  design, which is not implemented.

Decision: keep the in-memory implementation for the current per-domain weekly
budget (the scanner caps weekly pages far below 65,535), and treat larger
archives as a future measured design change. Do not add a compression
dependency without a real-data benchmark showing a need.
