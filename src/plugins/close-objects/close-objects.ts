/**
 * /////////////////////////////////////////////////////////////////////////////
 *
 * close-objects.ts finds satellites and debris within close proximity using a
 * two-phase spatial search algorithm.
 *
 * https://keeptrack.space
 *
 * @Copyright (C) 2025 Kruczek Labs LLC
 *
 * KeepTrack is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * KeepTrack is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with
 * KeepTrack. If not, see <http://www.gnu.org/licenses/>.
 *
 * /////////////////////////////////////////////////////////////////////////////
 */

import { SatMath } from '@app/app/analysis/sat-math';
import { CloseObjectsThreadManager } from '@app/app/threads/close-objects-thread-manager';
import { MenuMode } from '@app/engine/core/interfaces';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import {
  IBottomIconConfig,
  IHelpConfig,
  ISideMenuConfig,
} from '@app/engine/plugins/core/plugin-capabilities';
import { html } from '@app/engine/utils/development/formatter';
import { errorManagerInstance } from '@app/engine/utils/errorManager';
import { getEl } from '@app/engine/utils/get-el';
import { getUnique } from '@app/engine/utils/get-unique';
import { hideLoading, showLoading } from '@app/engine/utils/showLoading';
import { KeepTrack } from '@app/keeptrack';
import { t7e } from '@app/locales/keys';
import type { CoSatelliteData } from '@app/webworker/close-objects-messages';
import { Kilometers, Satellite, TemeVec3 } from '@ootk/src/main';
import scatterPlotPng from '@public/img/icons/scatter-plot.png';

export class CloseObjectsPlugin extends KeepTrackPlugin {
  readonly id = 'CloseObjectsPlugin';
  dependencies_ = [];

  protected searchRadius_ = 50; // km - overridable by Pro
  protected closeObjectSearchStrCache_: string | null = null;
  protected threadManager_: CloseObjectsThreadManager | null = null;
  protected watchdog_: number | null = null;

  /** Matches the legacy synchronous pipeline's +30 min verification pass. */
  protected static readonly VERIFY_OFFSET_MS_ = 30 * 60 * 1000;
  /** Pairs closer than this at verification are duplicate TLEs, not conjunctions. */
  protected static readonly MIN_MISS_DISTANCE_KM_ = 0.05;
  /** Hides the loading overlay if the worker never reports back. */
  protected static readonly WORKER_TIMEOUT_MS_ = 60_000;

  // =========================================================================
  // Composition-based configuration methods
  // =========================================================================

  getBottomIconConfig(): IBottomIconConfig {
    return {
      elementName: 'conjunction-nearby-icon',
      label: t7e('plugins.CloseObjectsPlugin.bottomIconLabel' as Parameters<typeof t7e>[0]),
      image: scatterPlotPng,
      menuMode: [MenuMode.CONJUNCTIONS, MenuMode.ALL],
    };
  }

  onBottomIconClick(): void {
    // No special behavior on click
  }

  bottomIconCallback = (): void => {
    this.onBottomIconClick();
  };

  getSideMenuConfig(): ISideMenuConfig {
    return {
      elementName: 'close-objects-menu',
      title: t7e('plugins.CloseObjectsPlugin.title' as Parameters<typeof t7e>[0]),
      html: this.buildSideMenuHtml_(),
    };
  }

  getHelpConfig(): IHelpConfig {
    return {
      title: t7e('plugins.CloseObjectsPlugin.title'),
      sections: [
        {
          heading: t7e('help.overview'),
          content: t7e('plugins.CloseObjectsPlugin.help.overview'),
          image: {
            src: 'img/help/close-objects/close-objects-menu.png',
            alt: t7e('plugins.CloseObjectsPlugin.help.imgAlt'),
            caption: t7e('plugins.CloseObjectsPlugin.help.imgCaption'),
          },
        },
        {
          heading: t7e('plugins.CloseObjectsPlugin.help.methodHeading'),
          content: t7e('plugins.CloseObjectsPlugin.help.method'),
        },
        {
          heading: t7e('help.howToUse'),
          content: t7e('plugins.CloseObjectsPlugin.help.howToUse'),
        },
      ],
      tips: [
        t7e('plugins.CloseObjectsPlugin.help.tip1'),
        t7e('plugins.CloseObjectsPlugin.help.tip2'),
      ],
    };
  }

  // =========================================================================
  // Side menu HTML
  // =========================================================================

  protected buildSideMenuHtml_(): string {
    const innerHtml = html`
      <div class="row">
        <center>
          <button id="co-find-btn" class="btn btn-ui waves-effect waves-light">
            ${t7e('plugins.CloseObjectsPlugin.findBtn' as Parameters<typeof t7e>[0])} &#9658;
          </button>
        </center>
      </div>
    `;

    // Pro adds getSecondaryMenuConfig() - generateSideMenuHtml_() auto-wraps with title bar
    if ('getSecondaryMenuConfig' in this) {
      return innerHtml;
    }

    // OSS: must include full wrapper + title since addHtml() inserts as-is
    const title = t7e('plugins.CloseObjectsPlugin.title' as Parameters<typeof t7e>[0]);

    return html`
      <div id="close-objects-menu" class="side-menu-parent start-hidden">
        <div class="side-menu">
          <div class="row" style="margin: 5px 1rem 0; display: flex; justify-content: center; align-items: center;">
            <h5 class="center-align" style="margin: 0px auto">${title}</h5>
          </div>
          <li class="divider" style="padding: 2px !important;"></li>
          <div class="row"></div>
          ${innerHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  addJs(): void {
    super.addJs();

    EventBus.getInstance().on(
      EventBusEvent.uiManagerFinal,
      this.uiManagerFinal_.bind(this),
    );
  }

  protected uiManagerFinal_() {
    getEl('co-find-btn')?.addEventListener('click', () => {
      // -1 keeps the overlay up until the async search hides it itself.
      showLoading(() => this.findCsoBtnClick_(), -1);
    });
  }

  // =========================================================================
  // Close object search algorithm
  // =========================================================================

  protected findCsoBtnClick_() {
    /*
     * startSearch supersedes any in-flight run (its callbacks never fire), so
     * a stale watchdog from a superseded run must not hide the overlay while
     * a newer search is still working.
     */
    this.clearWatchdog_();

    if (this.closeObjectSearchStrCache_ !== null) {
      this.finishSearch_(this.closeObjectSearchStrCache_);

      return;
    }

    /*
     * The broad phase stays on the main thread: positions are already in
     * memory and the sorted sweep is cheap. The SGP4-heavy verification runs
     * in the dedicated worker so a 20k+ catalog no longer freezes the UI.
     */
    let satList = CloseObjectsPlugin.getValidSats_();

    satList = getUnique(satList);
    satList.sort((a, b) => a.position.x - b.position.x);
    const candidates = CloseObjectsPlugin.getPossibleCSOs_(satList, this.searchRadius_);

    if (candidates.length === 0) {
      this.finishSearch_('');

      return;
    }

    const satIndex = new Map<Satellite, number>();
    const sats: CoSatelliteData[] = [];
    const pairs: [number, number][] = [];

    for (const { sat1, sat2 } of candidates) {
      for (const sat of [sat1, sat2]) {
        if (!satIndex.has(sat)) {
          satIndex.set(sat, sats.length);
          sats.push({ tle1: sat.tle1, tle2: sat.tle2, sccNum: sat.sccNum, name: sat.name ?? '', perigee: sat.perigee, apogee: sat.apogee });
        }
      }
      pairs.push([satIndex.get(sat1)!, satIndex.get(sat2)!]);
    }

    if (!this.threadManager_) {
      this.threadManager_ = new CloseObjectsThreadManager(KeepTrack.getInstance().threads);
      this.threadManager_.init();
    }

    this.watchdog_ = window.setTimeout(() => {
      this.watchdog_ = null;
      errorManagerInstance.warn('Close objects search timed out waiting on the worker.');
      hideLoading();
    }, CloseObjectsPlugin.WORKER_TIMEOUT_MS_);

    this.threadManager_.startSearch(
      {
        sats,
        pairs,
        searchRadiusKm: this.searchRadius_,
        minMissDistanceKm: CloseObjectsPlugin.MIN_MISS_DISTANCE_KM_,
        simEpochMs: ServiceLocator.getTimeManager()?.simulationTimeObj?.getTime() ?? Date.now(),
        verifyOffsetMs: CloseObjectsPlugin.VERIFY_OFFSET_MS_,
        // The OSS side menu only needs the verified pair list - skip the TCA phase.
        tcaWindowMs: 60 * 60 * 1000,
        coarseStepMs: 30_000,
        tolMs: 1000,
        maxTcaPairs: 0,
      },
      {
        onVerified: (results) => {
          this.clearWatchdog_();
          const sccNums = new Set<string>();

          for (const row of results) {
            sccNums.add(row.sat1Scc);
            sccNums.add(row.sat2Scc);
          }
          const searchStr = Array.from(sccNums).join(',');

          this.closeObjectSearchStrCache_ = searchStr;
          this.finishSearch_(searchStr);
        },
        onTcaChunk: () => {
          // TCA details are a Pro-table concern; the OSS menu ignores them.
        },
        onComplete: () => {
          // The verified list already resolved this run.
        },
        onError: (message) => {
          this.clearWatchdog_();
          errorManagerInstance.warn(`Close objects search failed: ${message}`);
          hideLoading();
        },
      },
    );
  }

  /** Cancels the pending worker watchdog, if any. */
  protected clearWatchdog_(): void {
    if (this.watchdog_ !== null) {
      window.clearTimeout(this.watchdog_);
      this.watchdog_ = null;
    }
  }

  /** Hides the loading overlay and hands the result to the search bar. */
  protected finishSearch_(searchStr: string): void {
    hideLoading();
    ServiceLocator.getUiManager().doSearch(searchStr);
  }

  protected findCloseObjects_(): string {
    if (this.closeObjectSearchStrCache_) {
      return this.closeObjectSearchStrCache_;
    }

    let satList = CloseObjectsPlugin.getValidSats_();

    satList = getUnique(satList);
    satList.sort((a, b) => a.position.x - b.position.x);

    // The forward-only sweep emits each pair once, so no dedupe pass is needed.
    const csoList = CloseObjectsPlugin.getPossibleCSOs_(satList, this.searchRadius_);
    const csoStrArr = CloseObjectsPlugin.getActualCSOs_(csoList, this.searchRadius_);

    const csoListUniqueArr = Array.from(new Set(csoStrArr));
    const searchStr = csoListUniqueArr.join(',');

    this.closeObjectSearchStrCache_ = searchStr;

    return searchStr;
  }

  protected static getValidSats_(): Satellite[] {
    const satList = <Satellite[]>[];

    for (let i = 0; i < ServiceLocator.getCatalogManager().orbitalSats; i++) {
      const sat = ServiceLocator.getCatalogManager().getSat(i);

      if (!sat) {
        continue;
      }

      if (typeof sat.position === 'undefined') {
        sat.position = <TemeVec3>SatMath.getEci(sat, new Date()).position || { x: <Kilometers>0, y: <Kilometers>0, z: <Kilometers>0 };
      }

      if (Number.isNaN(sat.position.x) || Number.isNaN(sat.position.y) || Number.isNaN(sat.position.z)) {
        continue;
      }
      if (sat.position && typeof sat.position !== 'boolean' && sat.position.x === 0 && sat.position.y === 0 && sat.position.z === 0) {
        continue;
      }

      satList.push(sat);
    }

    return satList;
  }

  protected static getPossibleCSOs_(satList: Satellite[], searchRadius: number): { sat1: Satellite; sat2: Satellite }[] {
    const csoList = [] as { sat1: Satellite; sat2: Satellite }[];

    for (let i = 0; i < satList.length; i++) {
      const sat1 = satList[i];
      const pos1 = sat1.position;

      const posXmin = pos1.x - searchRadius;
      const posXmax = pos1.x + searchRadius;
      const posYmin = pos1.y - searchRadius;
      const posYmax = pos1.y + searchRadius;
      const posZmin = pos1.z - searchRadius;
      const posZmax = pos1.z + searchRadius;

      /*
       * satList is sorted by position.x, so a forward-only sweep from i + 1
       * visits every unordered pair exactly once and the posXmax break stays
       * valid. (The previous "start 200 behind" lookback added ~200·n wasted
       * iterations and emitted reversed duplicate pairs.)
       */
      for (let j = i + 1; j < satList.length; j++) {
        const sat2 = satList[j];
        const pos2 = sat2.position;

        if (pos2.x > posXmax) {
          break;
        }
        if (pos2.x < posXmax && pos2.x > posXmin && pos2.y < posYmax && pos2.y > posYmin && pos2.z < posZmax && pos2.z > posZmin) {
          csoList.push({ sat1, sat2 });
        }
      }
    }

    return csoList;
  }

  protected static getActualCSOs_(csoListUnique: { sat1: Satellite; sat2: Satellite }[], searchRadius: number): string[] {
    const csoStrArr = [] as string[];

    // Re-propagate to 30 minutes in the future for verification
    for (const posCso of csoListUnique) {
      let sat = posCso.sat1;
      let eci = SatMath.getEci(sat, new Date(Date.now() + 1000 * 60 * 30));

      if (eci.position && typeof eci.position !== 'boolean' && eci.position.x === 0 && eci.position.y === 0 && eci.position.z === 0) {
        continue;
      }
      posCso.sat1.position = eci.position as TemeVec3;

      sat = posCso.sat2;
      eci = SatMath.getEci(sat, new Date(Date.now() + 1000 * 60 * 30));
      if (eci.position && typeof eci.position !== 'boolean' && eci.position.x === 0 && eci.position.y === 0 && eci.position.z === 0) {
        continue;
      }
      posCso.sat2.position = eci.position as TemeVec3;
    }

    for (const posCso of csoListUnique) {
      const pos1 = posCso.sat1.position;

      if (typeof pos1 === 'undefined') {
        continue;
      }

      const posXmin = pos1.x - searchRadius;
      const posXmax = pos1.x + searchRadius;
      const posYmin = pos1.y - searchRadius;
      const posYmax = pos1.y + searchRadius;
      const posZmin = pos1.z - searchRadius;
      const posZmax = pos1.z + searchRadius;

      const pos2 = posCso.sat2.position;

      if (typeof pos2 === 'undefined') {
        continue;
      }

      if (pos2.x < posXmax && pos2.x > posXmin && pos2.y < posYmax && pos2.y > posYmin && pos2.z < posZmax && pos2.z > posZmin) {
        csoStrArr.push(posCso.sat1.sccNum);
        csoStrArr.push(posCso.sat2.sccNum);
      }
    }

    return csoStrArr;
  }
}
