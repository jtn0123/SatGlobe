import { z } from 'zod';

const authoredIdSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case id');

const cameraPoseSchema = z.object({
  pitch: z.number().finite(),
  yaw: z.number().finite(),
  zoom: z.number().min(0.0001).max(1),
}).strict();

const numericRangeSchema = z.object({
  min: z.number().finite(),
  max: z.number().finite(),
}).strict().refine(({ min, max }) => min <= max, 'Minimum must not exceed maximum');

export const filterStateSchema = z.object({
  objectKinds: z.array(z.enum(['payload', 'rocket-body', 'debris', 'other'])).min(1),
  status: z.enum(['all', 'active', 'inactive']),
  regimes: z.array(z.enum(['leo', 'meo', 'geo', 'heo', 'other'])).min(1),
  altitudeKm: numericRangeSchema,
  inclinationDeg: numericRangeSchema,
  launchCohort: z.string().max(120),
  constellation: z.string().max(120),
  countryOrOperator: z.string().max(120),
}).strict();

export const savedViewV1Schema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  camera: cameraPoseSchema,
  simulationTime: z.iso.datetime(),
  filters: filterStateSchema,
  encoding: z.enum(['object-type', 'orbit-regime', 'launch-cohort', 'orbital-plane', 'data-age', 'starlink']),
  selectedObjectIds: z.array(z.string().min(1)).max(500),
  scaleMode: z.enum(['semantic', 'true']),
  presentation: z.object({
    mode: z.enum(['workshop', 'presentation', 'story']),
    panelsVisible: z.boolean(),
    storyId: z.string().optional(),
    storyBeat: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

const sourceSchema = z.object({
  id: authoredIdSchema,
  title: z.string().min(1),
  url: z.url(),
  retrievedAt: z.iso.date(),
  publisher: z.string().min(1),
}).strict();

const factSchema = z.object({
  id: authoredIdSchema,
  text: z.string().min(1),
  sourceIds: z.array(authoredIdSchema).min(1),
  caveat: z.string().optional(),
}).strict();

const orbitCatalogIdSchema = z.string().regex(/^\d{1,6}$/u, 'Expected a numeric catalog id');

const beatSchema = z.object({
  id: authoredIdSchema,
  eyebrow: z.string().min(1),
  title: z.string().min(1),
  dateLabel: z.string().min(1),
  narration: z.string().min(1),
  factIds: z.array(authoredIdSchema).min(1),
  durationMs: z.number().int().min(1_000).max(120_000),
  camera: cameraPoseSchema,
  encoding: z.enum(['object-type', 'orbit-regime', 'launch-cohort', 'orbital-plane', 'data-age', 'starlink']),
  constellation: z.string().max(120).optional(),
  launchCohort: z.string().max(120).optional(),
  simulationTimeOffsetHours: z.number().finite().min(-8_760).max(8_760).optional(),
  orbitCatalogId: orbitCatalogIdSchema.optional(),
  orbitCatalogIds: z.array(orbitCatalogIdSchema)
    .min(1)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length, 'Expected unique catalog ids')
    .optional(),
  filterOverrides: z.object({
    objectKinds: z.array(z.enum(['payload', 'rocket-body', 'debris', 'other'])).min(1).optional(),
    status: z.enum(['all', 'active', 'inactive']).optional(),
    regimes: z.array(z.enum(['leo', 'meo', 'geo', 'heo', 'other'])).min(1).optional(),
  }).strict().optional(),
  reconstruction: z.enum(['observed', 'reconstructed']),
  scaleMode: z.enum(['semantic', 'true']),
}).strict();

export const storyManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: authoredIdSchema,
  title: z.string().min(1),
  dek: z.string().min(1),
  reconstructionPolicy: z.enum(['observed', 'sourced-reconstruction']),
  facts: z.array(factSchema).min(1),
  beats: z.array(beatSchema).min(1),
  sources: z.array(sourceSchema).min(1),
}).strict().superRefine((story, context) => {
  const sourceIds = new Set(story.sources.map(({ id }) => id));
  const factIds = new Set(story.facts.map(({ id }) => id));

  for (const [collection, items] of [
    ['sources', story.sources],
    ['facts', story.facts],
    ['beats', story.beats],
  ] as const) {
    const seen = new Set<string>();

    items.forEach(({ id }, index) => {
      if (seen.has(id)) {
        context.addIssue({ code: 'custom', message: `Duplicate ${collection} id ${id}`, path: [collection, index, 'id'] });
      }
      seen.add(id);
    });
  }

  story.facts.forEach((fact, factIndex) => fact.sourceIds.forEach((sourceId) => {
    if (!sourceIds.has(sourceId)) {
      context.addIssue({ code: 'custom', message: `Unknown source ${sourceId}`, path: ['facts', factIndex, 'sourceIds'] });
    }
  }));
  story.beats.forEach((beat, beatIndex) => beat.factIds.forEach((factId) => {
    if (!factIds.has(factId)) {
      context.addIssue({ code: 'custom', message: `Unknown fact ${factId}`, path: ['beats', beatIndex, 'factIds'] });
    }
  }));
});
