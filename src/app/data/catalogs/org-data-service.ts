/**
 * Lazy-loading service for GCAT organization data.
 *
 * On first access, fetches the full org database from R2 (with local fallback)
 * and provides code→name lookups for both owners and manufacturers.
 * Until the data loads, falls back to the bundled static maps.
 */
import { errorManagerInstance } from '../../../engine/utils/errorManager';

interface GcatOrg {
  code: string;
  uCode: string;
  stateCode: string;
  type: string;
  class: string;
  tStart: string;
  tStop: string;
  shortName: string;
  name: string;
  location: string;
  longitude: number | null;
  latitude: number | null;
  error: number | null;
  parent: string;
  shortEName: string;
  eName: string;
  uName: string;
}

interface OrgDatabase {
  fetchedAt: string;
  source: string;
  count: number;
  ownerCodeMap: Record<string, string>;
  orgs: Record<string, GcatOrg>;
}

class OrgDataService {
  private db_: OrgDatabase | null = null;
  private loadPromise_: Promise<void> | null = null;
  private loaded_ = false;

  /**
   * Kick off the fetch. Safe to call multiple times — only fetches once.
   */
  init(): void {
    // Offline profiles rely on the bundled owner-code maps. Do not issue a
    // speculative remote request merely to improve display names.
    if (window.settingsManager?.offlineMode || this.loadPromise_) {
      return;
    }
    this.loadPromise_ = this.fetchOrgData_();
  }

  /**
   * Look up an org code and return its display name.
   * Works for both owner and manufacturer codes since GCAT covers all orgs.
   * Falls back to the bundled static maps if R2 data hasn't loaded yet.
   */
  resolveCode(code: string, fallbackMap: Record<string, string>): string | undefined {
    if (this.loaded_ && this.db_) {
      return this.db_.ownerCodeMap[code];
    }

    return fallbackMap[code];
  }

  /**
   * Get the full org record for a code, or undefined if not found / not loaded.
   */
  getOrg(code: string): GcatOrg | undefined {
    return this.db_?.orgs[code];
  }

  get isLoaded(): boolean {
    return this.loaded_;
  }

  private async fetchOrgData_(): Promise<void> {
    const settingsManager = window.settingsManager;
    const url = settingsManager.dataSources.orgs;

    try {
      const response = await fetch(url);

      if (response.ok) {
        this.db_ = await response.json();
        this.loaded_ = true;
        errorManagerInstance.debug(`Loaded ${this.db_!.count} org records from R2`);

        return;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch {
      errorManagerInstance.debug('Failed to fetch org data from R2, using bundled fallback');
    }
  }
}

export const orgDataService = new OrgDataService();
export type { GcatOrg, OrgDatabase };
