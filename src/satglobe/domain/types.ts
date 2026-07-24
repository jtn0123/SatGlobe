export type ObjectKind = 'payload' | 'rocket-body' | 'debris' | 'other';
export type OrbitRegime = 'leo' | 'meo' | 'geo' | 'heo' | 'other';
export type VisualEncoding = 'object-type' | 'orbit-regime' | 'launch-cohort' | 'orbital-plane' | 'data-age' | 'starlink';
export type ScaleMode = 'semantic' | 'true';
export type AppMode = 'workshop' | 'presentation' | 'story';

export interface CameraPose {
  pitch: number;
  yaw: number;
  zoom: number;
}

export interface NumericRange {
  min: number;
  max: number;
}

export interface FilterState {
  objectKinds: ObjectKind[];
  status: 'all' | 'active' | 'inactive';
  regimes: OrbitRegime[];
  altitudeKm: NumericRange;
  inclinationDeg: NumericRange;
  launchCohort: string;
  constellation: string;
  countryOrOperator: string;
}

export interface PresentationState {
  mode: AppMode;
  panelsVisible: boolean;
  storyId?: string;
  storyBeat?: number;
}

export interface SavedViewV1 {
  schemaVersion: 1;
  name: string;
  camera: CameraPose;
  simulationTime: string;
  filters: FilterState;
  encoding: VisualEncoding;
  selectedObjectIds: string[];
  scaleMode: ScaleMode;
  presentation: PresentationState;
}

export interface PlaylistEntryV1 {
  view: SavedViewV1;
  caption: string;
  durationMs: number;
}

/** Portable, local-first sequence of absolute views. Playback state is never persisted. */
export interface PlaylistV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  entries: PlaylistEntryV1[];
}

export interface DataSourceRecord {
  id: string;
  title: string;
  url: string;
  retrievedAt: string;
  notes?: string;
}

export interface OmmMeanElements {
  [field: string]: string | number | null;
}

export interface OemSample {
  epoch: string;
  positionKm: [number, number, number];
  velocityKmS?: [number, number, number];
}

export type ReferenceFrame = 'TEME' | 'GCRF' | 'EME2000' | 'ICRF';

export type CatalogElementSet =
  | { kind: 'tle'; line1: string; line2: string; epoch: string }
  | { kind: 'omm'; fields: OmmMeanElements; epoch: string }
  | { kind: 'oem'; samples: OemSample[]; frame: ReferenceFrame };

export interface SpaceObjectRecord {
  catalogId: string;
  name: string;
  type: ObjectKind;
  active: boolean | null;
  internationalDesignator?: string;
  launchDate?: string;
  sourceId: string;
  elements: CatalogElementSet;
}

export interface CatalogSnapshotV1 {
  schemaVersion: 1;
  snapshotId: string;
  generatedAt: string;
  sources: DataSourceRecord[];
  objects: SpaceObjectRecord[];
  checksum: string;
}

export interface SpaceObjectView {
  catalogId: string;
  name: string;
  kind: ObjectKind;
  active: boolean;
  status: string;
  internationalDesignator: string;
  launchDate: string;
  launchVehicle: string;
  owner: string;
  country: string;
  source: string;
  epoch: string;
  apogeeKm: number;
  perigeeKm: number;
  inclinationDeg: number;
  periodMinutes: number;
  regime: OrbitRegime;
  isStarlink: boolean;
  /*
   * Precomputed lowercase text, filled once when the view is built. Search and
   * filter sweeps run O(catalog) per keystroke/change; these keep the per-object
   * cost to comparisons instead of allocations.
   */
  nameText: string;
  launchText: string;
  ownershipText: string;
  searchText: string;
}

/** One side of a public SOCRATES close-approach prediction. Neither side is privileged. */
export interface ConjunctionObjectRef {
  catalogId: string;
  name: string;
  /** Age of the object's GP element set at time of closest approach, in days. */
  dseDays: number;
}

export interface ConjunctionPair {
  id: string;
  object1: ConjunctionObjectRef;
  object2: ConjunctionObjectRef;
  timeOfClosestApproach: string;
  missDistanceKm: number;
  relativeSpeedKmS: number;
  maximumProbability: number;
  dilutionThreshold: number;
}

export interface ConjunctionSource {
  provider: 'CelesTrak';
  rawUrl: string;
  /** Provider-reported source update time; this, not retrieval time, drives freshness. */
  updatedAt: string;
  retrievedAt: string;
  checksum: string;
}

export interface ConjunctionFeedV1 {
  schemaVersion: 1;
  snapshotId: string;
  generatedAt: string;
  source: ConjunctionSource;
  conjunctions: ConjunctionPair[];
}

/** A feed-side object reference proven to exist in the installed catalog. */
export interface ResolvedConjunctionObject extends ConjunctionObjectRef {
  object: SpaceObjectView;
}

export interface ResolvedConjunctionPair extends Omit<ConjunctionPair, 'object1' | 'object2'> {
  object1: ResolvedConjunctionObject;
  object2: ResolvedConjunctionObject;
}

interface ResolvedConjunctionStateBase {
  conjunctions: readonly ResolvedConjunctionPair[];
  /** Resolved pairs represented by the lens at the classification time. */
  lensPairCount: number;
  /** Unique installed catalog ids represented by the resolved conjunctions. */
  catalogIds: readonly string[];
  droppedPairCount: number;
  source: ConjunctionSource;
  error: null;
}

export interface ConjunctionCurrentState extends ResolvedConjunctionStateBase {
  status: 'current';
}

export interface ConjunctionStaleState extends ResolvedConjunctionStateBase {
  status: 'stale';
}

export interface ConjunctionArchivalState extends ResolvedConjunctionStateBase {
  status: 'archival';
}

export type AvailableConjunctionState =
  | ConjunctionCurrentState
  | ConjunctionStaleState
  | ConjunctionArchivalState;

export interface ConjunctionLoadingState {
  status: 'loading';
  conjunctions: readonly ResolvedConjunctionPair[];
  lensPairCount: 0;
  catalogIds: readonly string[];
  droppedPairCount: 0;
  source: null;
  error: null;
}

export interface ConjunctionUnavailableState {
  status: 'unavailable';
  conjunctions: readonly ResolvedConjunctionPair[];
  lensPairCount: 0;
  catalogIds: readonly string[];
  droppedPairCount: number;
  source: ConjunctionSource | null;
  error: string;
}

export type ConjunctionState =
  | ConjunctionLoadingState
  | AvailableConjunctionState
  | ConjunctionUnavailableState;

export interface StorySource {
  id: string;
  title: string;
  url: string;
  retrievedAt: string;
  publisher: string;
}

export interface StoryFact {
  id: string;
  text: string;
  sourceIds: string[];
  caveat?: string;
}

export interface StoryBeat {
  id: string;
  eyebrow: string;
  title: string;
  dateLabel: string;
  narration: string;
  factIds: string[];
  durationMs: number;
  camera: CameraPose;
  encoding: VisualEncoding;
  constellation?: string;
  /** Optional launch-date/designator substring applied through the existing catalog filter. */
  launchCohort?: string;
  /** Hours from the simulation-time anchor captured when the current story session began. */
  simulationTimeOffsetHours?: number;
  /** Optional catalog object whose propagated orbit line makes a sparse story subject legible. */
  orbitCatalogId?: string;
  /** Optional catalog objects whose propagated orbit lines make a multi-plane story subject legible. */
  orbitCatalogIds?: string[];
  /** Optional per-beat departures from DEFAULT_FILTERS (e.g. showing debris for a collision chapter). */
  filterOverrides?: Pick<Partial<FilterState>, 'objectKinds' | 'status' | 'regimes'>;
  reconstruction: 'observed' | 'reconstructed';
  scaleMode: ScaleMode;
}

export interface StoryManifestV1 {
  schemaVersion: 1;
  id: string;
  title: string;
  dek: string;
  reconstructionPolicy: 'observed' | 'sourced-reconstruction';
  facts: StoryFact[];
  beats: StoryBeat[];
  sources: StorySource[];
}

export interface EngineState {
  ready: boolean;
  /** Non-null when the engine failed to hydrate; the UI surfaces it instead of loading forever. */
  error: string | null;
  objectCount: number;
  /** Objects passing the current filters; maintained by the adapter so the UI never sweeps the catalog itself. */
  visibleCount: number;
  newestElementEpoch: string;
  simulationTime: string;
  selectedObject: SpaceObjectView | null;
  filters: FilterState;
  encoding: VisualEncoding;
  camera: CameraPose;
  conjunctions: ConjunctionState;
  /** True while the conjunction lens owns the static highlight, independent of its current object count. */
  conjunctionHighlightActive: boolean;
  highlightedObjectCount: number;
}

export const DEFAULT_FILTERS: FilterState = {
  objectKinds: ['payload'],
  status: 'active',
  regimes: ['leo', 'meo', 'geo', 'heo', 'other'],
  altitudeKm: { min: 0, max: 100_000 },
  inclinationDeg: { min: 0, max: 180 },
  launchCohort: '',
  constellation: '',
  countryOrOperator: '',
};

export const DEFAULT_CAMERA: CameraPose = { pitch: 0.34, yaw: 0.38, zoom: 0.58 };
