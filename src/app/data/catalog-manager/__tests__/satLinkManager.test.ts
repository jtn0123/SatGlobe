import { SatLinkManager, SatConstellationString } from '@app/app/data/catalog-manager/satLinkManager';
import { Container } from '@app/engine/core/container';
import { Singletons } from '@app/engine/core/interfaces';
import { TimeManager } from '@app/engine/core/time-manager';
import { LineManager } from '@app/engine/rendering/line-manager';
import type { Satellite } from '@ootk/src/main';

describe('SatLinkManager', () => {
  let satLinkManager: SatLinkManager;

  beforeEach(() => {
    satLinkManager = new SatLinkManager();
  });

  it('should be process showLinks for all SatConstellationString', () => {
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Aehf, new TimeManager())).not.toThrow();
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Dscs, new TimeManager())).not.toThrow();
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Galileo, new TimeManager())).not.toThrow();
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Iridium, new TimeManager())).not.toThrow();
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Sbirs, new TimeManager())).not.toThrow();
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Starlink, new TimeManager())).not.toThrow();
    expect(() => satLinkManager.showLinks(new LineManager(), SatConstellationString.Wgs, new TimeManager())).not.toThrow();
  });

  it('preserves the established Earth-clearance angle for satellite crosslinks', () => {
    satLinkManager.dscs = [1, 2];

    const satellites = new Map([
      [1, { position: { x: 7000, y: 0, z: 0 } }],
      [2, { position: { x: 0, y: 7000, z: 0 } }],
    ]);

    Container.getInstance().registerSingleton(Singletons.CatalogManager, { getSat: (id: number) => satellites.get(id) as Satellite });
    const lineManager = new LineManager();
    const createLinkSpy = vi.spyOn(lineManager, 'createObjToObj').mockImplementation(() => undefined);

    satLinkManager.showLinks(lineManager, SatConstellationString.Dscs, new TimeManager());

    expect(createLinkSpy).toHaveBeenCalledTimes(2);
  });

  it('does not draw crosslinks for non-finite position data', () => {
    satLinkManager.dscs = [1, 2];

    const satellites = new Map([
      [1, { position: { x: 7000, y: 0, z: 0 } }],
      [2, { position: { x: Number.NaN, y: 7000, z: 0 } }],
    ]);

    Container.getInstance().registerSingleton(Singletons.CatalogManager, { getSat: (id: number) => satellites.get(id) as Satellite });
    const lineManager = new LineManager();
    const createLinkSpy = vi.spyOn(lineManager, 'createObjToObj').mockImplementation(() => undefined);

    satLinkManager.showLinks(lineManager, SatConstellationString.Dscs, new TimeManager());

    expect(createLinkSpy).not.toHaveBeenCalled();
  });
});
