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
  engineId: number;
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
}

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
  objectCount: number;
  newestElementEpoch: string;
  simulationTime: string;
  selectedObject: SpaceObjectView | null;
  filters: FilterState;
  encoding: VisualEncoding;
  camera: CameraPose;
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
