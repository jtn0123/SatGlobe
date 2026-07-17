import { ServiceLocator } from '@app/engine/core/service-locator';
import { PluginRegistry } from '@app/engine/core/plugin-registry';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { errorManagerInstance } from '@app/engine/utils/errorManager';
import { SelectSatManager } from '@app/plugins/select-sat-manager/select-sat-manager';
import { BaseObject, PayloadStatus, Satellite } from '@ootk/src/main';
import { prepareFilterMatcher } from '../domain/filters';
import { classifyOrbit, tleEpochToIso } from '../domain/orbits';
import {
  DEFAULT_CAMERA,
  DEFAULT_FILTERS,
  type CameraPose,
  type EngineState,
  type FilterState,
  type SpaceObjectView,
  type ScaleMode,
  type VisualEncoding,
} from '../domain/types';
import { SatGlobeColorScheme } from './satglobe-color-scheme';
import { isKnownActivePayloadStatus, objectKindFromSpaceObjectType } from './satglobe-object-state';

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

export class SatGlobeEngineAdapter {
  private state_: EngineState = {
    ready: false,
    error: null,
    objectCount: 0,
    visibleCount: 0,
    simulationTime: new Date().toISOString(),
    selectedObject: null,
    filters: structuredClone(DEFAULT_FILTERS),
    encoding: 'object-type',
    camera: DEFAULT_CAMERA,
    newestElementEpoch: '',
  };
  private objects_: SpaceObjectView[] = [];
  private objectsByCatalogId_ = new Map<string, SpaceObjectView>();
  // Engine-allocated dot indices stay adapter-private; the domain model speaks catalog ids only.
  private engineIdByCatalogId_ = new Map<string, number>();
  private readonly listeners_ = new Set<EngineStateListener>();
  private colorScheme_: SatGlobeColorScheme | null = null;
  private interval_: number | null = null;
  private disposed_ = false;
  private engineReady_ = false;
  /** Wall-clock ms at construction; the engine must produce a catalog within BOOT_TIMEOUT_MS_ or the UI surfaces an error. */
  private readonly constructedAt_ = Date.now();
  private static readonly BOOT_TIMEOUT_MS_ = 30_000;
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
    this.patchState_({ selectedObject: this.toView_(obj) });
  };

  constructor() {
    this.eventBus_.on(EventBusEvent.catalogReloaded, this.onCatalogReloaded_);
    this.eventBus_.on(EventBusEvent.onKeepTrackReady, this.onKeepTrackReady_);
    this.eventBus_.on(EventBusEvent.selectSatData, this.onSelection_);
    this.eventBus_.on(EventBusEvent.updateLoop, this.onUpdateLoop_);
    this.interval_ = window.setInterval(() => this.poll_(), 600);
  }

  /**
   * Returns the current state snapshot. Snapshots are immutable by contract:
   * every change produces a new state object, and unchanged slices (filters,
   * selectedObject, camera) keep reference identity so React.memo consumers
   * can skip re-rendering. Do not mutate the returned object.
   */
  getState(): EngineState {
    return this.state_;
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
      .filter((obj) => obj.searchText.includes(normalized))
      .sort((a, b) => Number(b.nameText.startsWith(normalized)) - Number(a.nameText.startsWith(normalized)))
      .slice(0, limit);
  }

  selectObject(catalogId: string): void {
    const obj = this.objectsByCatalogId_.get(catalogId);
    const engineId = this.engineIdByCatalogId_.get(catalogId);

    if (!obj || engineId === undefined) {
      return;
    }
    PluginRegistry.getPlugin(SelectSatManager)?.selectSat(engineId);
    this.patchState_({ selectedObject: obj });
  }

  clearSelection(): void {
    PluginRegistry.getPlugin(SelectSatManager)?.selectSat(-1);
    this.patchState_({ selectedObject: null });
  }

  setSimulationTime(iso: string): void {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
      throw new Error('Simulation time must be a valid ISO date.');
    }
    const timeManager = ServiceLocator.getTimeManager();

    timeManager.changeStaticOffset(date.getTime() - Date.now());
    timeManager.setSelectedDate(date);
    this.patchState_({ simulationTime: date.toISOString() });
  }

  setPlaybackRate(rate: number): void {
    ServiceLocator.getTimeManager().changePropRate(rate, false);
  }

  setCamera(pose: CameraPose): void {
    const state = ServiceLocator.getMainCamera().state;

    state.camPitchTarget = pose.pitch as typeof state.camPitchTarget;
    state.camYawTarget = pose.yaw as typeof state.camYawTarget;
    state.zoomTarget = pose.zoom;
    this.patchState_({ camera: pose });
  }

  setFilters(filters: FilterState): void {
    this.patchState_({ filters: structuredClone(filters) }, false);
    this.applyVisualState_();
  }

  setEncoding(encoding: VisualEncoding): void {
    this.patchState_({ encoding }, false);
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
    const engineId = this.engineIdByCatalogId_.get(catalogId);

    if (engineId !== undefined) {
      ServiceLocator.getOrbitManager().addInViewOrbit(engineId);
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
    let catalog: ReturnType<typeof ServiceLocator.getCatalogManager>;

    try {
      catalog = ServiceLocator.getCatalogManager();
    } catch {
      // The catalog service registers in phases during startup; the polling loop retries.
      return;
    }
    if (!catalog?.objectCache?.length) {
      return;
    }
    try {
      /*
       * KeepTrack reserves inactive Satellite instances as propagation slots.
       * Exclude those placeholders here; operational status is derived separately
       * in toView_ and must never reuse this engine-allocation flag.
       */
      const sats = catalog.getSats().filter((sat) => sat.active);

      this.objects_ = sats.map((sat) => this.toView_(sat));
      this.objectsByCatalogId_ = new Map(this.objects_.map((obj) => [obj.catalogId, obj]));
      this.engineIdByCatalogId_ = new Map(sats.map((sat, index) => [this.objects_[index].catalogId, sat.id]));
      const newestEpochMs = this.objects_.reduce((newest, obj) => {
        const epoch = new Date(obj.epoch).getTime();

        return Number.isFinite(epoch) ? Math.max(newest, epoch) : newest;
      }, Number.NEGATIVE_INFINITY);

      this.patchState_({
        objectCount: this.objects_.length,
        visibleCount: this.countVisible_(),
        newestElementEpoch: Number.isFinite(newestEpochMs) ? new Date(newestEpochMs).toISOString() : '',
        ready: true,
        error: null,
      }, false);
      this.installColorScheme_();
      this.poll_();
    } catch (error) {
      // A populated catalog that fails to map is a real defect, not a startup race.
      const message = `Catalog hydration failed: ${error instanceof Error ? error.message : String(error)}`;

      errorManagerInstance.warn(`SatGlobe adapter: ${message}`);
      this.patchState_({ error: message });
    }
  }

  private poll_(): void {
    if (this.disposed_) {
      return;
    }
    /*
     * Checked before the service reads: a failed boot (missing catalog, engine
     * crash) can leave services unregistered forever, and the old spinner had
     * no exit. Runs from construction, not engine-ready, for the same reason.
     */
    if (!this.state_.ready && !this.state_.error && Date.now() - this.constructedAt_ > SatGlobeEngineAdapter.BOOT_TIMEOUT_MS_) {
      const message = 'The bundled catalog or propagation engine did not start. Check that public/tle/tle.json is present, then reload.';

      errorManagerInstance.warn(`SatGlobe adapter: ${message}`);
      this.patchState_({ error: message });

      return;
    }
    let simulationTimeIso: string;
    let camera: ReturnType<typeof ServiceLocator.getMainCamera>['state'];

    try {
      simulationTimeIso = ServiceLocator.getTimeManager().simulationTimeObj.toISOString();
      camera = ServiceLocator.getMainCamera().state;
    } catch {
      // Time and camera services register in phases during startup; retry next tick.
      return;
    }
    const pitch = Number(camera.camPitchTarget);
    const yaw = Number(camera.camYawTarget);
    const zoom = camera.zoomTarget;
    const current = this.state_;
    const timeChanged = current.simulationTime !== simulationTimeIso;
    const cameraChanged = current.camera.pitch !== pitch || current.camera.yaw !== yaw || current.camera.zoom !== zoom;

    if (!current.ready && this.engineReady_) {
      if (timeChanged || cameraChanged) {
        this.patchState_({
          simulationTime: timeChanged ? simulationTimeIso : current.simulationTime,
          camera: cameraChanged ? { pitch, yaw, zoom } : current.camera,
        }, false);
      }
      this.hydrate_();

      return;
    }
    // Emit only when something observable moved — an idle scene produces zero
    // notifications and therefore zero React re-renders (ADR 0002 idle budget).
    if (timeChanged || cameraChanged) {
      this.patchState_({
        simulationTime: timeChanged ? simulationTimeIso : current.simulationTime,
        camera: cameraChanged ? { pitch, yaw, zoom } : current.camera,
      });
    }
  }

  /**
   * Replaces the state with a new immutable snapshot; unchanged slices keep
   * reference identity. Emits to subscribers unless emit is false (callers
   * that batch further changes emit themselves).
   */
  private patchState_(partial: Partial<EngineState>, emit = true): void {
    this.state_ = { ...this.state_, ...partial };
    if (emit) {
      this.emit_();
    }
  }

  private installColorScheme_(): void {
    if (this.colorScheme_) {
      return;
    }
    const manager = ServiceLocator.getColorSchemeManager();

    this.colorScheme_ = new SatGlobeColorScheme(this.state_.filters, this.state_.encoding);
    manager.registerScheme(this.colorScheme_);
    manager.setColorScheme(this.colorScheme_, true);
  }

  private applyVisualState_(): void {
    this.colorScheme_?.setState(this.state_.filters, this.state_.encoding);
    if (this.colorScheme_) {
      try {
        ServiceLocator.getColorSchemeManager().setColorScheme(this.colorScheme_, true);
      } catch (error) {
        // Color buffers may still be initializing; the next update applies the state.
        errorManagerInstance.log(`SatGlobe adapter: recolor deferred (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    this.patchState_({ visibleCount: this.countVisible_() }, false);
    this.emit_();
  }

  /** One prepared-matcher sweep over the precomputed views; the UI reads the result from state. */
  private countVisible_(): number {
    const matcher = prepareFilterMatcher(this.state_.filters);
    let count = 0;

    for (const obj of this.objects_) {
      if (matcher(obj)) {
        count += 1;
      }
    }

    return count;
  }

  private toView_(obj: BaseObject): SpaceObjectView {
    const sat = obj as Satellite;
    const isSatellite = obj.isSatellite();
    const epoch = isSatellite ? tleEpochToIso(Number(sat.epochYear), Number(sat.epochDay)) : '';
    const catalogId = isSatellite ? String(sat.sccNum) : String(obj.id);
    const name = obj.name || 'Unnamed object';
    const intlDes = isSatellite ? sat.intlDes || '' : '';
    const launchDate = isSatellite ? sat.launchDate || '' : '';
    const owner = isSatellite ? sat.owner || '' : '';
    const country = isSatellite ? sat.country || '' : '';
    const nameText = name.toLocaleLowerCase();

    return {
      catalogId,
      name,
      kind: objectKindFromSpaceObjectType(obj.type),
      active: isSatellite ? isKnownActivePayloadStatus(sat.status) : false,
      status: isSatellite ? statusLabels[sat.status] ?? 'Unknown' : 'Unknown',
      internationalDesignator: intlDes,
      launchDate,
      launchVehicle: isSatellite ? sat.launchVehicle || '' : '',
      owner,
      country,
      source: isSatellite && sat.source && sat.source.toLocaleLowerCase() !== 'unknown' ? sat.source : 'KeepTrack enriched catalog',
      epoch,
      apogeeKm: isSatellite ? Number(sat.apogee) : Number.NaN,
      perigeeKm: isSatellite ? Number(sat.perigee) : Number.NaN,
      inclinationDeg: isSatellite ? Number(sat.inclination) : Number.NaN,
      periodMinutes: isSatellite ? Number(sat.period) : Number.NaN,
      regime: isSatellite ? classifyOrbit(Number(sat.perigee), Number(sat.apogee), Number(sat.period)) : 'other',
      isStarlink: nameText.startsWith('starlink'),
      nameText,
      launchText: `${intlDes} ${launchDate}`.toLocaleLowerCase(),
      ownershipText: `${country} ${owner}`.toLocaleLowerCase(),
      searchText: `${nameText} ${catalogId} ${intlDes} ${owner} ${country}`.toLocaleLowerCase(),
    };
  }

  private emit_(): void {
    const snapshot = this.state_;

    this.listeners_.forEach((listener) => listener(snapshot));
  }
}
