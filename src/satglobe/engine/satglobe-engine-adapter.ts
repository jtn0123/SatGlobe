import { ServiceLocator } from '@app/engine/core/service-locator';
import { PluginRegistry } from '@app/engine/core/plugin-registry';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { SelectSatManager } from '@app/plugins/select-sat-manager/select-sat-manager';
import { BaseObject, PayloadStatus, Satellite, SpaceObjectType } from '@ootk/src/main';
import { classifyOrbit, tleEpochToIso } from '../domain/orbits';
import {
  DEFAULT_CAMERA,
  DEFAULT_FILTERS,
  type CameraPose,
  type EngineState,
  type FilterState,
  type ObjectKind,
  type SpaceObjectView,
  type ScaleMode,
  type VisualEncoding,
} from '../domain/types';
import { SatGlobeColorScheme } from './satglobe-color-scheme';
import { isKnownActivePayloadStatus } from './satglobe-object-state';

export type EngineStateListener = (state: EngineState) => void;

const statusLabels: Record<PayloadStatus, string> = {
  [PayloadStatus.OPERATIONAL]: 'Operational',
  [PayloadStatus.NONOPERATIONAL]: 'Non-operational',
  [PayloadStatus.PARTIALLY_OPERATIONAL]: 'Partially operational',
  [PayloadStatus.BACKUP_STANDBY]: 'Backup / standby',
  [PayloadStatus.SPARE]: 'Spare',
  [PayloadStatus.EXTENDED_MISSION]: 'Extended mission',
  [PayloadStatus.DECAYED]: 'Decayed',
  [PayloadStatus.UNKNOWN]: 'Unknown',
};

/** Maps an engine object to the type vocabulary exposed to product code. */
function objectKind(obj: BaseObject): ObjectKind {
  if (obj.type === SpaceObjectType.PAYLOAD) {
    return 'payload';
  }
  if (obj.type === SpaceObjectType.ROCKET_BODY) {
    return 'rocket-body';
  }
  if (obj.type === SpaceObjectType.DEBRIS) {
    return 'debris';
  }

  return 'other';
}

export class SatGlobeEngineAdapter {
  private state_: EngineState = {
    ready: false,
    objectCount: 0,
    simulationTime: new Date().toISOString(),
    selectedObject: null,
    filters: structuredClone(DEFAULT_FILTERS),
    encoding: 'object-type',
    camera: DEFAULT_CAMERA,
    newestElementEpoch: '',
  };
  private objects_: SpaceObjectView[] = [];
  private objectsByCatalogId_ = new Map<string, SpaceObjectView>();
  private readonly listeners_ = new Set<EngineStateListener>();
  private colorScheme_: SatGlobeColorScheme | null = null;
  private interval_: number | null = null;
  private disposed_ = false;
  private engineReady_ = false;
  private scaleMode_: ScaleMode = 'semantic';
  private readonly eventBus_ = EventBus.getInstance();
  private readonly onCatalogReloaded_ = () => {
    if (this.engineReady_) {
      this.hydrate_();
    }
  };
  private readonly onKeepTrackReady_ = () => {
    this.engineReady_ = true;
    this.hydrate_();
  };
  private readonly onUpdateLoop_ = () => {
    if (this.scaleMode_ !== 'true') {
      return;
    }
    const sizes = ServiceLocator.getMainCamera().satShaderSizes;

    sizes.minSize = 0.25;
    sizes.maxSize = 1;
  };
  private readonly onSelection_ = (obj: BaseObject) => {
    this.state_.selectedObject = this.toView_(obj);
    this.emit_();
  };

  constructor() {
    this.eventBus_.on(EventBusEvent.catalogReloaded, this.onCatalogReloaded_);
    this.eventBus_.on(EventBusEvent.onKeepTrackReady, this.onKeepTrackReady_);
    this.eventBus_.on(EventBusEvent.selectSatData, this.onSelection_);
    this.eventBus_.on(EventBusEvent.updateLoop, this.onUpdateLoop_);
    this.interval_ = window.setInterval(() => this.poll_(), 600);
  }

  getState(): EngineState {
    return structuredClone(this.state_);
  }

  getObjects(): readonly SpaceObjectView[] {
    return this.objects_;
  }

  subscribe(listener: EngineStateListener): () => void {
    this.listeners_.add(listener);
    listener(this.getState());

    return () => this.listeners_.delete(listener);
  }

  search(query: string, limit = 24): SpaceObjectView[] {
    const normalized = query.trim().toLocaleLowerCase();

    if (!normalized) {
      return [];
    }

    return this.objects_
      .filter((obj) => `${obj.name} ${obj.catalogId} ${obj.internationalDesignator} ${obj.owner} ${obj.country}`.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => Number(b.name.toLocaleLowerCase().startsWith(normalized)) - Number(a.name.toLocaleLowerCase().startsWith(normalized)))
      .slice(0, limit);
  }

  selectObject(catalogId: string): void {
    const obj = this.objectsByCatalogId_.get(catalogId);

    if (!obj) {
      return;
    }
    PluginRegistry.getPlugin(SelectSatManager)?.selectSat(obj.engineId);
    this.state_.selectedObject = obj;
    this.emit_();
  }

  clearSelection(): void {
    PluginRegistry.getPlugin(SelectSatManager)?.selectSat(-1);
    this.state_.selectedObject = null;
    this.emit_();
  }

  setSimulationTime(iso: string): void {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
      throw new Error('Simulation time must be a valid ISO date.');
    }
    const timeManager = ServiceLocator.getTimeManager();

    timeManager.changeStaticOffset(date.getTime() - Date.now());
    timeManager.setSelectedDate(date);
    this.state_.simulationTime = date.toISOString();
    this.emit_();
  }

  setPlaybackRate(rate: number): void {
    ServiceLocator.getTimeManager().changePropRate(rate, false);
  }

  setCamera(pose: CameraPose): void {
    const state = ServiceLocator.getMainCamera().state;

    state.camPitchTarget = pose.pitch as typeof state.camPitchTarget;
    state.camYawTarget = pose.yaw as typeof state.camYawTarget;
    state.zoomTarget = pose.zoom;
    this.state_.camera = pose;
    this.emit_();
  }

  setFilters(filters: FilterState): void {
    this.state_.filters = structuredClone(filters);
    this.applyVisualState_();
  }

  setEncoding(encoding: VisualEncoding): void {
    this.state_.encoding = encoding;
    this.applyVisualState_();
  }

  setScaleMode(mode: ScaleMode): void {
    this.scaleMode_ = mode;
    const sizes = ServiceLocator.getMainCamera().satShaderSizes;

    if (mode === 'true') {
      sizes.minSize = 0.25;
      sizes.maxSize = 1;
    } else {
      sizes.minSize = null;
      sizes.maxSize = null;
    }
  }

  drawOrbit(catalogId: string): void {
    const obj = this.objectsByCatalogId_.get(catalogId);

    if (obj) {
      ServiceLocator.getOrbitManager().addInViewOrbit(obj.engineId);
    }
  }

  clearOrbits(): void {
    ServiceLocator.getOrbitManager().clearInViewOrbit();
  }

  dispose(): void {
    this.disposed_ = true;
    if (this.interval_ !== null) {
      window.clearInterval(this.interval_);
    }
    this.eventBus_.unregister(EventBusEvent.catalogReloaded, this.onCatalogReloaded_);
    this.eventBus_.unregister(EventBusEvent.onKeepTrackReady, this.onKeepTrackReady_);
    this.eventBus_.unregister(EventBusEvent.selectSatData, this.onSelection_);
    this.eventBus_.unregister(EventBusEvent.updateLoop, this.onUpdateLoop_);
    this.listeners_.clear();
  }

  private hydrate_(): void {
    if (this.disposed_) {
      return;
    }
    try {
      const catalog = ServiceLocator.getCatalogManager();

      if (!catalog?.objectCache?.length) {
        return;
      }
      // KeepTrack reserves inactive Satellite instances as propagation slots.
      // Exclude those placeholders here; operational status is derived separately
      // in toView_ and must never reuse this engine-allocation flag.
      this.objects_ = catalog.getSats().filter((sat) => sat.active).map((sat) => this.toView_(sat));
      this.objectsByCatalogId_ = new Map(this.objects_.map((obj) => [obj.catalogId, obj]));
      this.state_.objectCount = this.objects_.length;
      const newestEpochMs = Math.max(...this.objects_.map((obj) => new Date(obj.epoch).getTime()).filter(Number.isFinite));

      this.state_.newestElementEpoch = Number.isFinite(newestEpochMs) ? new Date(newestEpochMs).toISOString() : '';
      this.state_.ready = true;
      this.installColorScheme_();
      this.poll_();
    } catch {
      // KeepTrack services become available in phases. The polling loop retries.
    }
  }

  private poll_(): void {
    if (this.disposed_) {
      return;
    }
    try {
      const time = ServiceLocator.getTimeManager().simulationTimeObj;
      const camera = ServiceLocator.getMainCamera().state;

      this.state_.simulationTime = time.toISOString();
      this.state_.camera = {
        pitch: Number(camera.camPitchTarget),
        yaw: Number(camera.camYawTarget),
        zoom: camera.zoomTarget,
      };
      if (!this.state_.ready && this.engineReady_) {
        this.hydrate_();
      } else {
        this.emit_();
      }
    } catch {
      // Expected during engine startup.
    }
  }

  private installColorScheme_(): void {
    if (this.colorScheme_) {
      return;
    }
    const manager = ServiceLocator.getColorSchemeManager();

    this.colorScheme_ = new SatGlobeColorScheme(this.state_.filters, this.state_.encoding);
    const instances = manager.colorSchemeInstances as unknown as Record<string, SatGlobeColorScheme>;

    instances[this.colorScheme_.id] = this.colorScheme_;
    manager.setColorScheme(this.colorScheme_, true);
  }

  private applyVisualState_(): void {
    try {
      this.colorScheme_?.setState(this.state_.filters, this.state_.encoding);
      const manager = ServiceLocator.getColorSchemeManager();

      if (this.colorScheme_) {
        manager.setColorScheme(this.colorScheme_, true);
      }
    } catch {
      // Visual buffers may still be initializing; the next update will apply state.
    }
    this.emit_();
  }

  private toView_(obj: BaseObject): SpaceObjectView {
    const sat = obj as Satellite;
    const isSatellite = obj.isSatellite();
    const epoch = isSatellite ? tleEpochToIso(Number(sat.epochYear), Number(sat.epochDay)) : '';

    return {
      engineId: obj.id,
      catalogId: isSatellite ? String(sat.sccNum) : String(obj.id),
      name: obj.name || 'Unnamed object',
      kind: objectKind(obj),
      active: isSatellite ? isKnownActivePayloadStatus(sat.status) : false,
      status: isSatellite ? statusLabels[sat.status] ?? 'Unknown' : 'Unknown',
      internationalDesignator: isSatellite ? sat.intlDes || '' : '',
      launchDate: isSatellite ? sat.launchDate || '' : '',
      launchVehicle: isSatellite ? sat.launchVehicle || '' : '',
      owner: isSatellite ? sat.owner || '' : '',
      country: isSatellite ? sat.country || '' : '',
      source: isSatellite && sat.source && sat.source.toLocaleLowerCase() !== 'unknown' ? sat.source : 'KeepTrack enriched catalog',
      epoch,
      apogeeKm: isSatellite ? Number(sat.apogee) : Number.NaN,
      perigeeKm: isSatellite ? Number(sat.perigee) : Number.NaN,
      inclinationDeg: isSatellite ? Number(sat.inclination) : Number.NaN,
      periodMinutes: isSatellite ? Number(sat.period) : Number.NaN,
      regime: isSatellite ? classifyOrbit(Number(sat.perigee), Number(sat.apogee), Number(sat.period)) : 'other',
      isStarlink: obj.name.toLocaleLowerCase().startsWith('starlink'),
    };
  }

  private emit_(): void {
    const snapshot = this.getState();

    this.listeners_.forEach((listener) => listener(snapshot));
  }
}
