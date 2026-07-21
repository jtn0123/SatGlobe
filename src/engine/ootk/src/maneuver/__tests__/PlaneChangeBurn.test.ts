import { ClassicalElements, EpochUTC, Kilometers, Radians } from '../../main';
import { PlaneChangeBurn } from '../PlaneChangeBurn';

describe('PlaneChangeBurn', () => {
  const elements = new ClassicalElements({
    epoch: EpochUTC.fromDateTime(new Date('2026-01-01T00:00:00.000Z')),
    semimajorAxis: 7000 as Kilometers,
    eccentricity: 0.001,
    inclination: 0.5 as Radians,
    rightAscension: 0.1 as Radians,
    argPerigee: 0.2 as Radians,
    trueAnomaly: 0.3 as Radians,
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['ascending', 100, 200, 'ascending'],
    ['descending', 100, 200, 'descending'],
    ['nearest', 100, 200, 'ascending'],
    ['nearest', 200, 100, 'descending'],
  ] as const)('honors the %s node preference', (preference, ascending, descending, expectedNode) => {
    vi.spyOn(PlaneChangeBurn, 'timeToNodes').mockReturnValue({ ascending, descending });

    const result = PlaneChangeBurn.compute(elements, 0.6, 0, preference);
    const expectedTime = expectedNode === 'ascending' ? ascending : descending;

    expect(result.nodeType).toBe(expectedNode);
    expect(result.burnEpoch.posix).toBe(elements.epoch.roll(expectedTime).posix);
  });
});
