/**
 * SatGlobe's local-first profile. Network-backed plugins stay disabled at
 * runtime; catalog updates happen only through `npm run catalog:refresh`.
 */
const settingsOverride = {
  offlineMode: true,
  isAutoStart: true,
  isDisableOnboarding: true,
  isDisableTelemetry: true,
  isDisableSounds: true,
  isDisableToasts: true,
  isDisableServiceWorker: true,
  isShowSplashScreen: false,
  isShowLoadingHints: false,
  isShowPrimaryLogo: false,
  isShowSecondaryLogo: false,
  isDisableBottomMenu: true,
  isDisableSensors: true,
  isDisableLaunchSites: true,
  isDisableControlSites: true,
  isEnableJscCatalog: false,
  isDisableExtraCatalog: false,
  enableHoverOverlay: false,
  drawCameraWidget: false,
  isDrawAtmosphere: 1,
  isDrawAurora: true,
  isDrawMilkyWay: true,
  isDrawSun: true,
  isEarthAmbientLighting: true,
  isDrawPoliticalMap: false,
  earthNightBrightness: 1.35,
  isDrawSelectionGlow: true,
  // Snapshot export reads the completed frame inside Engine.draw_; no retained buffer is needed.
  isPreserveDrawingBuffer: false,
  isFocusOnSatelliteWhenSelected: false,
  noMeshManager: true,
  isDisablePlanets: true,
  isShowPayloads: true,
  isShowRocketBodies: false,
  isShowDebris: false,
  isDrawOrbits: true,
  enableConstantSelectedSatRedraw: true,
  defaultColorScheme: 'ObjectTypeColorScheme',
  selectedColor: [0.91, 0.79, 0.5, 1],
  selectedColorFallback: [0.91, 0.79, 0.5, 1],
  hoverColor: [0.54, 0.84, 0.81, 1],
  orbitSelectColor: [0.91, 0.79, 0.5, 0.92],
  orbitHoverColor: [0.54, 0.84, 0.81, 0.82],
  orbitInViewColor: [0.54, 0.84, 0.81, 0.38],
  searchLimit: 120,
  copyrightOveride: 'SatGlobe · orbital data is propagated, not live telemetry',
  /*
   * Offline contract, enforced at plugin level rather than by hiding UI: the
   * strict allowlist force-disables every optional plugin (remote fetchers like
   * the launch calendar, EPIC photos, reentry feed, transponder API, and catalog
   * browser included), so no URL parameter or future menu path can reach an
   * external service. alwaysEnabled infrastructure (SelectSatManager) is exempt;
   * SatGlobe's React overlay provides the product surface itself.
   */
  isStrictPluginList: true,
  plugins: {},
};

window.settingsOverride = settingsOverride;
