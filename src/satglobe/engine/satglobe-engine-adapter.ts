import { ServiceLocator } from '@app/engine/core/service-locator';
import { PluginRegistry } from '@app/engine/core/plugin-registry';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { errorManagerInstance } from '@app/engine/utils/errorManager';
import { SelectSatManager } from '@app/plugins/select-sat-manager/select-sat-manager';
import { BaseObject, PayloadStatus, Radians, Satellite } from '@ootk/src/main';
import {
  createUnavailableConjunctionState,
  INITIAL_CONJUNCTION_STATE,
  refreshAvailableConjunctionState,
  resolveConjunctionFeed,
} from '../domain/conjunctions';
import { prepareFilterMatcher } from '../domain/filters';
import { classifyOrbit, tleEpochToIso } from '../domain/orbits';
import {
  DEFAULT_CAMERA,
  DEFAULT_FILTERS,
  type CameraPose,
  type ConjunctionFeedV1,
  type EngineState,
  type FilterState,
  type SpaceObjectView,
  type ScaleMode,
  type VisualEncoding,
} from '../domain/types';
import { loadConjunctionFeed } from '../runtime/conjunction-loader';
import { SatGlobeColorScheme } from './satglobe-color-scheme';
import { isKnownActivePayloadStatus, objectKindFromSpaceObjectType } from './satglobe-object-state';

export type EngineStateListener = (state: EngineState) => void;

type ConjunctionFeedLoader = (signal: AbortSignal) => Promise<ConjunctionFeedV1>;
type IdleScheduler = (callback: () => void, timeoutMs: number) => number;

export interface SatGlobeEngineAdapterOptions {
  loadConjunctionFeed?: ConjunctionFeedLoader;
  scheduleIdle?: IdleScheduler;
  cancelIdle?: (handle: number) => void;
}

const scheduleBrowserIdle: IdleScheduler = (callback, timeoutMs) => (
  typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(callback, { timeout: timeoutMs })
    : window.setTimeout(callback, 0)
);

const cancelBrowserIdle = (handle: number): void => {
  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle);
  } else {
    window.clearTimeout(handle);
  }
};

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
    conjunctions: INITIAL_CONJUNCTION_STATE,
    conjunctionHighlightActive: false,
    highlightedObjectCount: 0,
  };
  private objects_: SpaceObjectView[] = [];
  private objectsByCatalogId_ = new Map<string, SpaceObjectView>();
  private filterVisibleCatalogIds_ = new Set<string>();
  // Engine-allocated dot indices stay adapter-private; the domain model speaks catalog ids only.
  private engineIdByCatalogId_ = new Map<string, number>();
  private readonly listeners_ = new Set<EngineStateListener>();
  private colorScheme_: SatGlobeColorScheme | null = null;
  private highlightedCatalogIds_: ReadonlySet<string> = new Set();
  private conjunctionHighlightActive_ = false;
  private conjunctionFeed_: ConjunctionFeedV1 | null = null;
  private readonly interval_: number | null = null;
  private conjunctionIdleHandle_: number | null = null;
  private conjunctionLoadTimeoutHandle_: number | null = null;
  private conjunctionAbortController_: AbortController | null = null;
  private conjunctionLoadScheduled_ = false;
  private disposed_ = false;
  private engineReady_ = false;
  /** Wall-clock ms at construction; the engine must produce a catalog within BOOT_TIMEOUT_MS_ or the UI surfaces an error. */
  private readonly constructedAt_ = Date.now();
  private static readonly BOOT_TIMEOUT_MS_ = 30_000;
  private static readonly CONJUNCTION_IDLE_TIMEOUT_MS_ = 2_000;
  private static readonly CONJUNCTION_LOAD_TIMEOUT_MS_ = 2_000;
  private static readonly MAX_HIGHLIGHTED_OBJECTS_ = 50;
  private scaleMode_: ScaleMode = 'semantic';
  private readonly loadConjunctionFeed_: ConjunctionFeedLoader;
  private readonly scheduleIdle_: IdleScheduler;
  private readonly cancelIdle_: (handle: number) => void;
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
  private readonly onSelection_ = (obj: BaseObject | null) => {
    // Clicking empty space emits a null selection (deselect), not an object.
    this.patchState_({ selectedObject: obj ? this.toView_(obj) : null });
  };

  constructor({
    loadConjunctionFeed: conjunctionLoader = loadConjunctionFeed,
    scheduleIdle = scheduleBrowserIdle,
    cancelIdle = cancelBrowserIdle,
  }: SatGlobeEngineAdapterOptions = {}) {
    this.loadConjunctionFeed_ = conjunctionLoader;
    this.scheduleIdle_ = scheduleIdle;
    this.cancelIdle_ = cancelIdle;
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
    const camera = ServiceLocator.getMainCamera();
    const { state } = camera;

    // Authored poses are absolute at the current simulation epoch. A time jump
    // must establish a new GMST baseline instead of rotating this fresh yaw by
    // the delta from the preceding frame.
    state.hasPrevGmst = false;
    // KeepTrack starts with left auto-rotation enabled. Leaving it active while
    // chasing an authored yaw creates a permanent offset instead of a settled
    // view, so an explicit SatGlobe camera command also stops that ambient spin.
    camera.autoRotate(false);
    // camSnap restores the target-following flag that pointer drags disable, so
    // a later story beat or "Authored view" action moves the real camera again.
    camera.camSnap(pose.pitch as Radians, pose.yaw as Radians);
    // KeepTrack's zoom guard cancels a target when this direction bit still
    // describes the preceding gesture/beat instead of the authored target.
    state.isZoomIn = pose.zoom < state.zoomLevel;
    state.zoomTarget = pose.zoom;
  }

  setFilters(filters: FilterState): void {
    this.conjunctionHighlightActive_ = false;
    this.highlightedCatalogIds_ = new Set();
    this.patchState_({
      filters: structuredClone(filters),
      conjunctionHighlightActive: false,
      highlightedObjectCount: 0,
    }, false);
    this.applyVisualState_(this.rebuildFilterVisibility_());
  }

  setEncoding(encoding: VisualEncoding): void {
    this.conjunctionHighlightActive_ = false;
    this.highlightedCatalogIds_ = new Set();
    this.patchState_({ encoding, conjunctionHighlightActive: false, highlightedObjectCount: 0 }, false);
    this.applyVisualState_(this.filterVisibleCatalogIds_.size);
  }

  /**
   * Emphasizes installed catalog objects for a conjunction lens. Unknown ids,
   * duplicate ids, whitespace, and caller order cannot create distinct visual
   * states, so repeated selection of the same pair is a true no-op.
   */
  setHighlight(catalogIds: readonly string[]): void {
    const canonicalIds = this.canonicalHighlightIds_(catalogIds);
    const conjunctionHighlightActive = canonicalIds.size > 0;
    const activeChanged = conjunctionHighlightActive !== this.conjunctionHighlightActive_;

    this.conjunctionHighlightActive_ = conjunctionHighlightActive;
    const highlightChanged = this.replaceHighlightIds_(canonicalIds);

    if (activeChanged) {
      this.patchState_({ conjunctionHighlightActive }, false);
    }
    if (!highlightChanged) {
      if (activeChanged) {
        this.emit_();
      }

      return;
    }

    this.applyVisualState_(this.visibleCountWithHighlight_());
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
    if (this.conjunctionIdleHandle_ !== null) {
      this.cancelIdle_(this.conjunctionIdleHandle_);
      this.conjunctionIdleHandle_ = null;
    }
    if (this.conjunctionLoadTimeoutHandle_ !== null) {
      window.clearTimeout(this.conjunctionLoadTimeoutHandle_);
      this.conjunctionLoadTimeoutHandle_ = null;
    }
    this.conjunctionAbortController_?.abort();
    this.conjunctionAbortController_ = null;
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
    performance.mark('satglobe:hydrate-start');
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
      const conjunctions = this.conjunctionFeed_
        ? resolveConjunctionFeed(
          this.conjunctionFeed_,
          (catalogId) => this.objectsByCatalogId_.get(catalogId),
          new Date(),
        )
        : this.state_.conjunctions;
      const nextHighlights = this.conjunctionHighlightActive_ && conjunctions.status !== 'loading' && conjunctions.status !== 'unavailable'
        ? this.canonicalHighlightIds_(conjunctions.catalogIds)
        : this.canonicalHighlightIds_(this.highlightedCatalogIds_);

      const highlightChanged = this.replaceHighlightIds_(nextHighlights);

      this.rebuildFilterVisibility_();
      const newestEpochMs = this.objects_.reduce((newest, obj) => {
        const epoch = new Date(obj.epoch).getTime();

        return Number.isFinite(epoch) ? Math.max(newest, epoch) : newest;
      }, Number.NEGATIVE_INFINITY);

      this.patchState_({
        objectCount: this.objects_.length,
        visibleCount: this.visibleCountWithHighlight_(),
        conjunctionHighlightActive: this.conjunctionHighlightActive_,
        highlightedObjectCount: this.highlightedCatalogIds_.size,
        conjunctions,
        newestElementEpoch: Number.isFinite(newestEpochMs) ? new Date(newestEpochMs).toISOString() : '',
        ready: true,
        error: null,
      }, false);
      this.installColorScheme_();
      if (highlightChanged) {
        // CatalogLoader rebuilds color buffers before it emits catalogReloaded.
        // A retained conjunction lens may resolve to a different population in
        // this hydrate, so force exactly one post-resolution GPU recolor.
        this.applyVisualState_(this.visibleCountWithHighlight_());
      }
      this.poll_();
      this.scheduleConjunctionLoad_();
      performance.measure('satglobe:hydrate', 'satglobe:hydrate-start');
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
    // Public state represents the rendered pose, not the destination. Pointer
    // drags and authored transitions both move these current values; exposing
    // targets here made saved views and authoring captures silently stale and
    // let screenshot verification pass before the camera arrived.
    const pitch = Number(camera.camPitch);
    const yaw = Number(camera.camYaw);
    const zoom = camera.zoomLevel;
    const current = this.state_;
    const conjunctions = current.conjunctions.status === 'loading' || current.conjunctions.status === 'unavailable'
      ? current.conjunctions
      : refreshAvailableConjunctionState(current.conjunctions, new Date());
    const conjunctionsChanged = conjunctions !== current.conjunctions;
    const highlightChanged = conjunctionsChanged && this.conjunctionHighlightActive_
      ? this.replaceHighlightIds_(this.canonicalHighlightIds_(conjunctions.catalogIds))
      : false;
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
    if (timeChanged || cameraChanged || conjunctionsChanged) {
      this.patchState_({
        simulationTime: timeChanged ? simulationTimeIso : current.simulationTime,
        camera: cameraChanged ? { pitch, yaw, zoom } : current.camera,
        conjunctions,
      }, !highlightChanged);
      if (highlightChanged) {
        this.applyVisualState_(this.visibleCountWithHighlight_());
      }
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
      this.colorScheme_.setState(
        this.state_.filters,
        this.state_.encoding,
        this.highlightedCatalogIds_,
      );

      return;
    }
    const manager = ServiceLocator.getColorSchemeManager();

    this.colorScheme_ = new SatGlobeColorScheme(
      this.state_.filters,
      this.state_.encoding,
      this.highlightedCatalogIds_,
    );
    manager.registerScheme(this.colorScheme_);
    manager.setColorScheme(this.colorScheme_, true);
  }

  private applyVisualState_(visibleCount: number): void {
    this.colorScheme_?.setState(
      this.state_.filters,
      this.state_.encoding,
      this.highlightedCatalogIds_,
    );
    if (this.colorScheme_) {
      try {
        ServiceLocator.getColorSchemeManager().setColorScheme(this.colorScheme_, true);
      } catch (error) {
        // Color buffers may still be initializing; the next update applies the state.
        errorManagerInstance.log(`SatGlobe adapter: recolor deferred (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    this.patchState_({ visibleCount }, false);
    this.emit_();
  }

  /** Rebuilds the filter-only baseline; highlight clicks never enter this O(catalog) path. */
  private rebuildFilterVisibility_(): number {
    const matcher = prepareFilterMatcher(this.state_.filters);
    const visibleCatalogIds = new Set<string>();

    for (const obj of this.objects_) {
      if (matcher(obj)) {
        visibleCatalogIds.add(obj.catalogId);
      }
    }

    this.filterVisibleCatalogIds_ = visibleCatalogIds;

    return visibleCatalogIds.size;
  }

  /** Adds only the bounded highlight delta to the cached filter-visible baseline. */
  private visibleCountWithHighlight_(): number {
    let visibleCount = this.filterVisibleCatalogIds_.size;

    for (const catalogId of this.highlightedCatalogIds_) {
      if (!this.filterVisibleCatalogIds_.has(catalogId)) {
        visibleCount++;
      }
    }

    return visibleCount;
  }

  /** Normalizes the bounded public highlight API against the installed catalog. */
  private canonicalHighlightIds_(catalogIds: Iterable<string>): ReadonlySet<string> {
    const knownIds = new Set<string>();

    for (const candidate of catalogIds) {
      const catalogId = candidate.trim();

      if (this.objectsByCatalogId_.has(catalogId)) {
        knownIds.add(catalogId);
      }
    }

    return new Set(
      [...knownIds]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, SatGlobeEngineAdapter.MAX_HIGHLIGHTED_OBJECTS_),
    );
  }

  /** Replaces a canonical highlight set without recoloring or emitting. */
  private replaceHighlightIds_(catalogIds: ReadonlySet<string>): boolean {
    const unchanged = catalogIds.size === this.highlightedCatalogIds_.size &&
      [...catalogIds].every((catalogId) => this.highlightedCatalogIds_.has(catalogId));

    if (unchanged) {
      return false;
    }
    this.highlightedCatalogIds_ = catalogIds;
    this.patchState_({ highlightedObjectCount: catalogIds.size }, false);

    return true;
  }

  /** Schedules the optional screening feed only after the catalog is usable. */
  private scheduleConjunctionLoad_(): void {
    if (this.conjunctionLoadScheduled_ || this.disposed_) {
      return;
    }

    this.conjunctionLoadScheduled_ = true;
    this.conjunctionAbortController_ = new AbortController();
    try {
      this.conjunctionIdleHandle_ = this.scheduleIdle_(() => {
        this.conjunctionIdleHandle_ = null;
        this.loadConjunctions_().catch((error: unknown) => {
          // loadConjunctions_ owns expected request/parse failures. This final
          // guard prevents an unexpected programming error from becoming an
          // unhandled rejection in browsers.
          errorManagerInstance.log(`SatGlobe adapter: deferred conjunction load failed (${String(error)})`);
        });
      }, SatGlobeEngineAdapter.CONJUNCTION_IDLE_TIMEOUT_MS_);
    } catch (error) {
      this.conjunctionAbortController_?.abort();
      this.conjunctionAbortController_ = null;
      const message = `Conjunction screening data is unavailable: ${error instanceof Error ? error.message : String(error)}`;

      errorManagerInstance.log(`SatGlobe adapter: ${message}`);
      this.patchState_({ conjunctions: createUnavailableConjunctionState(message) });
    }
  }

  /** Resolves public feed ids against the installed catalog without making the feed boot-critical. */
  private async loadConjunctions_(): Promise<void> {
    const controller = this.conjunctionAbortController_;

    if (!controller || this.disposed_) {
      return;
    }

    this.conjunctionLoadTimeoutHandle_ = window.setTimeout(() => {
      this.conjunctionLoadTimeoutHandle_ = null;
      if (this.disposed_ || controller.signal.aborted) {
        return;
      }
      const message = 'Conjunction screening data is unavailable: the local feed load timed out after 2 seconds.';

      errorManagerInstance.log(`SatGlobe adapter: ${message}`);
      controller.abort();
      this.patchState_({ conjunctions: createUnavailableConjunctionState(message) });
    }, SatGlobeEngineAdapter.CONJUNCTION_LOAD_TIMEOUT_MS_);

    try {
      const feed = await this.loadConjunctionFeed_(controller.signal);

      if (controller.signal.aborted || this.disposed_) {
        return;
      }

      this.conjunctionFeed_ = feed;
      const conjunctions = resolveConjunctionFeed(
        feed,
        (catalogId) => this.objectsByCatalogId_.get(catalogId),
        new Date(),
      );

      this.patchState_({ conjunctions });
    } catch (error) {
      if (controller.signal.aborted || this.disposed_) {
        return;
      }

      const message = `Conjunction screening data is unavailable: ${error instanceof Error ? error.message : String(error)}`;

      errorManagerInstance.log(`SatGlobe adapter: ${message}`);
      this.patchState_({
        conjunctions: createUnavailableConjunctionState(message),
      });
    } finally {
      if (this.conjunctionLoadTimeoutHandle_ !== null) {
        window.clearTimeout(this.conjunctionLoadTimeoutHandle_);
        this.conjunctionLoadTimeoutHandle_ = null;
      }
      if (this.conjunctionAbortController_ === controller) {
        this.conjunctionAbortController_ = null;
      }
    }
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
