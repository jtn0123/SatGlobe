
import { LaunchSite } from '@app/app/data/catalog-manager/LaunchFacility';
import { GetSatType, ToastMsgType } from '@app/engine/core/interfaces';
import { PluginRegistry } from '@app/engine/core/plugin-registry';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { openColorbox } from '@app/engine/utils/colorbox';
import { html } from '@app/engine/utils/development/formatter';
import { errorManagerInstance } from '@app/engine/utils/errorManager';
import { hideEl, showEl } from '@app/engine/utils/get-el';
import { t7e } from '@app/locales/keys';
import { Satellite, eci2lla } from '@ootk/src/main';
import { DetailedSensor } from '@app/app/sensors/DetailedSensor';
import { KeepTrackPlugin } from '../../engine/plugins/base-plugin';
import { SelectSatManager } from '../select-sat-manager/select-sat-manager';
import { SensorInfoPlugin } from '../sensor/sensor-info-plugin';

export class ViewInfoRmbPlugin extends KeepTrackPlugin {
  readonly id = 'ViewInfoRmbPlugin';
  dependencies_ = [];

  private t_(key: string): string {
    return t7e(`plugins.ViewInfoRmbPlugin.${key}` as Parameters<typeof t7e>[0]);
  }

  rmbL1ElementName = 'view-rmb';
  rmbL1Html = this.buildRmbL1Html_();
  rmbL2ElementName = 'view-rmb-menu';
  rmbL2Html = this.buildRmbL2Html_();

  private buildRmbL1Html_(): string {
    return html`<li class="rmb-menu-item" id="view-rmb"><a href="#">${this.t_('rmbMenu.title')} &#x27A4;</a></li>`;
  }

  private buildRmbL2Html_(): string {
    const m = (key: string) => this.t_(`rmbMenu.${key}`);

    return html`
    <ul class='dropdown-contents'>
      <li id="view-info-rmb"><a href="#">${m('earthInfo')}</a></li>
      <li id="view-sensor-info-rmb"><a href="#">${m('sensorInfo')}</a></li>
      <li id="view-launchsite-info-rmb"><a href="#">${m('launchSiteInfo')}</a></li>
      <li id="view-sat-info-rmb"><a href="#">${m('satelliteInfo')}</a></li>
      <li id="view-related-sats-rmb"><a href="#">${m('relatedSatellites')}</a></li>
    </ul>
    `;
  }
  rmbMenuOrder = 1;
  isRmbOnEarth = true;
  isRmbOffEarth = true;
  isRmbOnSat = true;

  rmbCallback = (targetId: string, clickedSat?: number): void => {
    switch (targetId) {
      case 'view-info-rmb':
        {
          let latLon = ServiceLocator.getInputManager().mouse.latLon;
          const dragPosition = ServiceLocator.getInputManager().mouse.dragPosition;

          if (latLon === undefined || Number.isNaN(latLon.lat) || Number.isNaN(latLon.lon)) {
            errorManagerInstance.debug('latLon undefined!');
            const gmst = ServiceLocator.getTimeManager().gmst;

            latLon = eci2lla({ x: dragPosition[0], y: dragPosition[1], z: dragPosition[2] }, gmst);
          }
          ServiceLocator.getUiManager().toast(`Lat: ${latLon.lat.toFixed(3)}<br>Lon: ${latLon.lon.toFixed(3)}`, ToastMsgType.normal, true);
        }
        break;
      case 'view-sat-info-rmb':
        PluginRegistry.getPlugin(SelectSatManager)?.selectSat(clickedSat ?? -1);
        break;
      case 'view-sensor-info-rmb':
        this.viewSensorInfoRmb(clickedSat);
        break;
      case 'view-launchsite-info-rmb':
        {
          const launchSite = ServiceLocator.getCatalogManager().getObject(clickedSat) as LaunchSite;

          if (launchSite === undefined || launchSite === null) {
            errorManagerInstance.warn(this.t_('errorMsgs.launchSiteNotFound'));

            return;
          }

          if (launchSite.wikiUrl) {
            openColorbox(launchSite.wikiUrl);
          }
        }
        break;
      case 'view-related-sats-rmb':
        {
          const intldes = ServiceLocator.getCatalogManager().getSat(clickedSat ?? -1, GetSatType.EXTRA_ONLY)?.intlDes;

          if (!intldes) {
            ServiceLocator.getUiManager().toast(this.t_('errorMsgs.noRelatedSats'), ToastMsgType.serious);
          }
          const searchStr = intldes?.slice(0, 8) ?? '';

          ServiceLocator.getUiManager().doSearch(searchStr);
        }
        break;
      default:
        break;
    }
  };

  addJs() {
    super.addJs();

    EventBus.getInstance().on(EventBusEvent.rightBtnMenuOpen, (_isEarth, clickedSatId) => {
      if (clickedSatId === undefined) {
        return;
      }
      const sat = ServiceLocator.getCatalogManager().getObject(clickedSatId);

      if (sat instanceof Satellite === false) {
        hideEl('view-sat-info-rmb');
        hideEl('view-related-sats-rmb');
      } else {
        showEl('view-sat-info-rmb');
        showEl('view-related-sats-rmb');
      }

      if (sat instanceof DetailedSensor === false) {
        hideEl('view-sensor-info-rmb');
      } else {
        showEl('view-sensor-info-rmb');
      }

      if (sat instanceof LaunchSite === false) {
        hideEl('view-launchsite-info-rmb');
      } else {
        showEl('view-launchsite-info-rmb');
      }
    });
  }

  viewSensorInfoRmb(clickedSat = -1): void {
    PluginRegistry.getPlugin(SelectSatManager)?.selectSat(clickedSat);

    const sensorInfoPluginInstance = PluginRegistry.getPlugin(SensorInfoPlugin);

    if (!sensorInfoPluginInstance || clickedSat < 0) {
      return;
    }

    const firstSensor = ServiceLocator.getSensorManager().currentSensors[0];

    if (!firstSensor) {
      errorManagerInstance.warn(this.t_('errorMsgs.sensorNotFound'));

      return;
    }

    if (!sensorInfoPluginInstance.isMenuButtonActive) {
      sensorInfoPluginInstance.setBottomIconToSelected();
      sensorInfoPluginInstance.openSideMenu();
    }

    sensorInfoPluginInstance.getSensorInfo();
  }
}
