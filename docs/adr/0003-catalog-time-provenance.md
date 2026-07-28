# ADR 0003: Catalog time and snapshot provenance

- Status: accepted
- Date: 2026-07-18

## Context

CelesTrak's GP CSV represents OMM epochs as timezone-less timestamps such as `2026-07-20T02:43:32.333088`. JavaScript interprets that shape in the host timezone. The same CXO row therefore became TLE epoch `26201.11356867` under UTC, `26201.40523534` under `America/Los_Angeles`, and `26200.73856867` under `Asia/Tokyo`. The Los Angeles result also became the refresh manifest's `generatedAt`, making a catalog-element timestamp look like a local processing timestamp.

Manifest schema v1 consequently conflated two different provenance facts: when the refresh ran and the newest element epoch actually installed. Because snapshot IDs included that misparsed date, host timezone could also change snapshot identity for identical input bytes.

## Decision

- One strict parser owns CelesTrak OMM epoch interpretation. It accepts the provider's ISO date/time shape with an optional fractional second and optional literal `Z`, treats a missing zone as UTC, validates every calendar field, and rejects offsets, normalized overflow dates, and non-finite values.
- OMM-to-TLE conversion and epoch-regression protection use that parser. Any incoming epoch older than the installed row is rejected; there is no timezone-sized tolerance or sub-seven-hour exception.
- Manifest schema v2 records `refreshedAt` (local pipeline execution time) separately from `newestElementEpoch` (the maximum TLE epoch across accepted rows in the exact candidate catalog). Rejected source rows cannot advance it.
- The catalog checksum covers the exact serialized `tle.json` bytes. `snapshotId` is `satglobe-<newest-element-UTC-date>-<first-12-checksum-hex>`. Candidate validation requires schema v2, exact checksum and object count, snapshot identity coherence, and equality between `newestElementEpoch` and the maximum installed TLE epoch before installation.
- Checked-in schema v1 is accepted only at the explicit artifact-migration boundary, where its historical `generatedAt` meaning is validated as the installed maximum element epoch. New refreshes never emit v1.
- Runtime age labels preserve future dates instead of clamping them to “0 days old,” and the top bar warns when the newest installed element is future-dated.
- Stable catalog JSON URLs revalidate on every request in the nginx profile. Hashed JavaScript, CSS, fonts, and images retain the seven-day immutable policy.

## Consequences

Identical OMM bytes now produce identical TLE epochs, catalog bytes, and snapshot inputs in UTC, Los Angeles, and Tokyo. The processing timestamp intentionally changes between refresh executions, while content identity does not.

This code/schema decision does not rewrite the currently installed Git LFS catalog or its v1 reports. Correcting those artifacts is a separate audited data operation using the exact preserved input CSV bytes and provider metadata; it must update the catalog, checksum, summary, rejection report, and manifest together through the existing manifest-last transaction.
