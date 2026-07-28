import { z } from 'zod';

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 checksum');
const snapshotIdSchema = z.string().regex(
  /^satglobe-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/u,
  'Expected a stable SatGlobe catalog snapshot id',
);
const countSchema = z.number().int().nonnegative();
const sourceRecordFields = {
  recordCount: countSchema,
  checksum: checksumSchema,
};
const sourceSchema = z.discriminatedUnion('id', [
  z.object({
    id: z.literal('keeptrack-enriched'),
    url: z.literal('https://github.com/thkruz/keeptrack.space'),
    ...sourceRecordFields,
  }).strict(),
  z.object({
    id: z.literal('celestrak-active'),
    url: z.literal('https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=CSV'),
    ...sourceRecordFields,
  }).strict(),
  z.object({
    id: z.literal('celestrak-starlink'),
    url: z.literal('https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=CSV'),
    ...sourceRecordFields,
  }).strict(),
]);
const sourcesSchema = z.array(sourceSchema).length(3).superRefine((sources, context) => {
  const sourceIds = new Set(sources.map((source) => source.id));

  if (sourceIds.size !== sources.length) {
    context.addIssue({
      code: 'custom',
      message: 'Each catalog source ID must appear exactly once',
    });
  }
});
const conjunctionSummarySchema = z.object({
  snapshotId: z.string().regex(/^socrates-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/u),
  eventCount: countSchema.min(1).max(25),
  updatedAt: z.iso.datetime(),
  retrievedAt: z.iso.datetime(),
  checksum: checksumSchema,
}).strict();
const commonManifestFields = {
  snapshotId: snapshotIdSchema,
  previousObjectCount: countSchema,
  objectCount: countSchema,
  added: countSchema,
  updated: countSchema,
  unchanged: countSchema,
  rejected: countSchema,
  rejectionReasons: z.record(z.string(), countSchema),
  sources: sourcesSchema,
  conjunctions: conjunctionSummarySchema,
  checksum: checksumSchema,
};

/** Add relationships that cannot be expressed by individual field schemas. */
function withManifestCoherence<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict().superRefine((manifest, context) => {
    const rejectedFromReasons = Object.values(manifest.rejectionReasons as Record<string, number>)
      .reduce((total, count) => total + count, 0);

    if (manifest.rejected !== rejectedFromReasons) {
      context.addIssue({
        code: 'custom',
        message: 'rejected must equal the sum of rejectionReasons',
        path: ['rejected'],
      });
    }
    if (manifest.objectCount !== manifest.previousObjectCount + manifest.added) {
      context.addIssue({
        code: 'custom',
        message: 'objectCount must equal previousObjectCount plus added',
        path: ['objectCount'],
      });
    }
  });
}

/** Legacy checked-in shape. In v1, generatedAt actually meant newest element epoch. */
export const catalogRefreshManifestV1Schema = withManifestCoherence({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  ...commonManifestFields,
});

/** Current refresh shape: processing time and installed-element freshness are separate facts. */
export const catalogRefreshManifestV2Schema = withManifestCoherence({
  schemaVersion: z.literal(2),
  refreshedAt: z.iso.datetime(),
  newestElementEpoch: z.iso.datetime(),
  ...commonManifestFields,
});

export const catalogRefreshManifestSchema = z.union([
  catalogRefreshManifestV1Schema,
  catalogRefreshManifestV2Schema,
]);

export type CatalogRefreshManifest = z.infer<typeof catalogRefreshManifestSchema>;
export type CatalogRefreshManifestV2 = z.infer<typeof catalogRefreshManifestV2Schema>;
