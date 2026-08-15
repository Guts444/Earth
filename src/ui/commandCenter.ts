import {
  FLIGHT_CATEGORIES,
  HOTSPOT_PRESETS,
  MARINE_CATEGORIES,
  SAT_GROUPS,
  THEMES,
  type DomainType,
  type FlightCategory,
  type HotspotPreset,
  type MarineCategory,
  type SatGroupId,
  type SelectedTarget,
  type ThemePreset,
} from '../config';

export type OverlayType =
  | 'clouds'
  | 'grid'
  | 'terminator'
  | 'orbits'
  | 'footprints'
  | 'daylight'
  | 'quakes'
  | 'volcanoes'
  | 'wildfires'
  | 'cyclones'
  | 'aurora'
  | 'dsn'
  | 'asteroids'
  | 'launches'
  | 'gpsjam'
  | 'cables'
  | 'nuclear';

export interface CommandCenterCallbacks {
  onSatelliteGroupToggle: (id: SatGroupId, checked: boolean) => void;
  onFlightCategoryToggle: (cat: FlightCategory, checked: boolean) => void;
  onMarineCategoryToggle: (cat: MarineCategory, checked: boolean) => void;
  onQuakeMagChange: (minMag: number) => void;
  onOverlayToggle: (overlay: OverlayType, checked: boolean) => void;
  onHotspotSelect: (hotspot: HotspotPreset) => void;
  onTargetSearchSelect: (target: { domain: DomainType; index: number; name: string }) => void;
  onChaseCamToggle: (active: boolean) => void;
  onFocusTarget: () => void;
  onTimeSpeedChange: (speed: number) => void;
  onTimeNow: () => void;
  onTimePause: () => boolean;
  onReloadSatellites: () => void;
}

export class CommandCenterUI {
  private callbacks: CommandCenterCallbacks;
  private currentTheme: ThemePreset = 'cyber-blue';
  private currentTab = 'orbital';
  private searchDebounceTimer = 0;

  get theme(): ThemePreset {
    return this.currentTheme;
  }

  get activeTab(): string {
    return this.currentTab;
  }

  // DOM elements cache
  private topCounters = {
    sats: document.querySelector<HTMLElement>('#count-sats')!,
    flights: document.querySelector<HTMLElement>('#count-flights')!,
    marine: document.querySelector<HTMLElement>('#count-marine')!,
    quakes: document.querySelector<HTMLElement>('#count-quakes')!,
  };
  private zuluClock = document.querySelector<HTMLElement>('#zulu-clock')!;
  private tickerStream = document.querySelector<HTMLElement>('#ticker-text')!;
  private searchInput = document.querySelector<HTMLInputElement>('#global-search')!;
  private searchResults = document.querySelector<HTMLElement>('#search-results')!;

  // Telemetry panel elements
  private targetCard = document.querySelector<HTMLElement>('#target-telemetry')!;
  private targetEmpty = document.querySelector<HTMLElement>('#target-empty')!;
  private targetName = document.querySelector<HTMLElement>('#target-name')!;
  private targetDomainBadge = document.querySelector<HTMLElement>('#target-domain-badge')!;
  private targetId = document.querySelector<HTMLElement>('#target-id')!;
  private targetLat = document.querySelector<HTMLElement>('#target-lat')!;
  private targetLon = document.querySelector<HTMLElement>('#target-lon')!;
  private targetAlt = document.querySelector<HTMLElement>('#target-alt')!;
  private targetSpeed = document.querySelector<HTMLElement>('#target-speed')!;
  private targetHeading = document.querySelector<HTMLElement>('#target-heading')!;
  private targetMeta = document.querySelector<HTMLElement>('#target-meta')!;
  private chaseBtn = document.querySelector<HTMLButtonElement>('#btn-chase')!;
  private focusBtn = document.querySelector<HTMLButtonElement>('#btn-focus')!;

  constructor(callbacks: CommandCenterCallbacks) {
    this.callbacks = callbacks;
    this.initTabs();
    this.initGroupCheckboxes();
    this.initHotspots();
    this.initThemeSelector();
    this.initSearch();
    this.initActionButtons();
    this.startEventTicker();
  }

  private initTabs(): void {
    const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-content');

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        if (!tabId) return;

        tabBtns.forEach((b) => b.classList.remove('active'));
        tabPanels.forEach((p) => p.classList.remove('active'));

        btn.classList.add('active');
        document.querySelector(`.tab-content[data-tab="${tabId}"]`)?.classList.add('active');
        this.currentTab = tabId;
      });
    });
  }

  private initGroupCheckboxes(): void {
    // 1. Satellites
    const satContainer = document.querySelector<HTMLElement>('#sat-group-list');
    if (satContainer) {
      satContainer.innerHTML = '';
      for (const g of SAT_GROUPS) {
        const item = document.createElement('label');
        item.className = 'hud-checkbox-row';
        item.innerHTML = `
          <input type="checkbox" data-sat-group="${g.id}" ${g.defaultOn ? 'checked' : ''} />
          <span class="swatch" style="background:${g.color}; box-shadow: 0 0 6px ${g.color}"></span>
          <span class="hud-label">${g.label}</span>
        `;
        const cb = item.querySelector('input')!;
        cb.addEventListener('change', () => {
          this.callbacks.onSatelliteGroupToggle(g.id, cb.checked);
        });
        satContainer.appendChild(item);
      }
    }

    // 2. Flights
    const flightContainer = document.querySelector<HTMLElement>('#flight-category-list');
    if (flightContainer) {
      flightContainer.innerHTML = '';
      for (const f of FLIGHT_CATEGORIES) {
        const item = document.createElement('label');
        item.className = 'hud-checkbox-row';
        item.innerHTML = `
          <input type="checkbox" data-flight-cat="${f.id}" ${f.defaultOn ? 'checked' : ''} />
          <span class="swatch" style="background:${f.color}; box-shadow: 0 0 6px ${f.color}"></span>
          <span class="hud-label">${f.label}</span>
        `;
        const cb = item.querySelector('input')!;
        cb.addEventListener('change', () => {
          this.callbacks.onFlightCategoryToggle(f.id, cb.checked);
        });
        flightContainer.appendChild(item);
      }
    }

    // 3. Marine
    const marineContainer = document.querySelector<HTMLElement>('#marine-category-list');
    if (marineContainer) {
      marineContainer.innerHTML = '';
      for (const m of MARINE_CATEGORIES) {
        const item = document.createElement('label');
        item.className = 'hud-checkbox-row';
        item.innerHTML = `
          <input type="checkbox" data-marine-cat="${m.id}" ${m.defaultOn ? 'checked' : ''} />
          <span class="swatch" style="background:${m.color}; box-shadow: 0 0 6px ${m.color}"></span>
          <span class="hud-label">${m.label}</span>
        `;
        const cb = item.querySelector('input')!;
        cb.addEventListener('change', () => {
          this.callbacks.onMarineCategoryToggle(m.id, cb.checked);
        });
        marineContainer.appendChild(item);
      }
    }

    // 4. All Overlays and Signal Layers
    const overlayInputs: Array<{ id: string; key: OverlayType }> = [
      { id: 'toggle-full-daylight', key: 'daylight' },
      { id: 'toggle-clouds', key: 'clouds' },
      { id: 'toggle-grid', key: 'grid' },
      { id: 'toggle-terminator', key: 'terminator' },
      { id: 'toggle-orbits', key: 'orbits' },
      { id: 'toggle-footprints', key: 'footprints' },
      { id: 'toggle-quakes', key: 'quakes' },
      { id: 'toggle-volcanoes', key: 'volcanoes' },
      { id: 'toggle-wildfires', key: 'wildfires' },
      { id: 'toggle-cyclones', key: 'cyclones' },
      { id: 'toggle-aurora', key: 'aurora' },
      { id: 'toggle-dsn', key: 'dsn' },
      { id: 'toggle-asteroids', key: 'asteroids' },
      { id: 'toggle-launches', key: 'launches' },
      { id: 'toggle-gpsjam', key: 'gpsjam' },
      { id: 'toggle-cables', key: 'cables' },
      { id: 'toggle-nuclear', key: 'nuclear' },
    ];

    overlayInputs.forEach(({ id, key }) => {
      const el = document.querySelector<HTMLInputElement>(`#${id}`);
      el?.addEventListener('change', () => {
        this.callbacks.onOverlayToggle(key, el.checked);
      });
    });

    // 5. Quake filter
    const quakeSlider = document.querySelector<HTMLInputElement>('#quake-mag-slider');
    const quakeVal = document.querySelector<HTMLElement>('#quake-mag-val');
    quakeSlider?.addEventListener('input', () => {
      const mag = parseFloat(quakeSlider.value);
      if (quakeVal) quakeVal.textContent = `M${mag.toFixed(1)}+`;
      this.callbacks.onQuakeMagChange(mag);
    });
  }

  private initHotspots(): void {
    const list = document.querySelector<HTMLElement>('#hotspots-list');
    if (!list) return;
    list.innerHTML = '';

    for (const h of HOTSPOT_PRESETS) {
      const card = document.createElement('div');
      card.className = 'hotspot-item';
      card.innerHTML = `
        <div class="hotspot-head">
          <span class="hotspot-title">${h.name}</span>
          <span class="hotspot-badge">${h.category}</span>
        </div>
        <p class="hotspot-desc">${h.description}</p>
      `;
      card.addEventListener('click', () => {
        this.callbacks.onHotspotSelect(h);
      });
      list.appendChild(card);
    }
  }

  private initThemeSelector(): void {
    const sel = document.querySelector<HTMLSelectElement>('#theme-select');
    if (!sel) return;

    sel.value = this.currentTheme;
    sel.addEventListener('change', () => {
      const t = sel.value as ThemePreset;
      if (THEMES[t]) {
        this.setTheme(t);
      }
    });
  }

  setTheme(theme: ThemePreset): void {
    this.currentTheme = theme;
    const def = THEMES[theme];
    const root = document.documentElement;
    root.style.setProperty('--accent', def.accent);
    root.style.setProperty('--panel-bg', def.panelBg);
    root.style.setProperty('--glow', def.glow);
  }

  private initSearch(): void {
    this.searchInput?.addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim();
      clearTimeout(this.searchDebounceTimer);

      if (q.length < 2) {
        this.searchResults?.classList.add('hidden');
        return;
      }

      this.searchDebounceTimer = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('commandcenter:search', { detail: { query: q } }));
      }, 150);
    });

    document.addEventListener('click', (e) => {
      if (!this.searchInput?.contains(e.target as Node) && !this.searchResults?.contains(e.target as Node)) {
        this.searchResults?.classList.add('hidden');
      }
    });
  }

  renderSearchResults(
    results: Array<{ domain: DomainType; index: number; name: string; extra: string }>,
  ): void {
    if (results.length === 0) {
      this.searchResults.innerHTML = '<div class="search-empty">No matching telemetry targets found</div>';
      this.searchResults.classList.remove('hidden');
      return;
    }

    this.searchResults.innerHTML = '';
    for (const r of results.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'search-row';
      const iconMap: Record<string, string> = {
        satellite: '🛰️',
        flight: '✈️',
        marine: '🚢',
        earthquake: '🌋',
        cable: '🌊',
        nuclear: '⚛️',
        dsn: '📡',
        asteroid: '☄️',
        launch: '🚀',
        volcano: '🌋',
        wildfire: '🔥',
        cyclone: '🌀',
        gpsjam: '⚠️',
      };
      const icon = iconMap[r.domain] || '🎯';
      row.innerHTML = `
        <span class="search-icon">${icon}</span>
        <span class="search-name">${r.name}</span>
        <span class="search-meta">${r.extra}</span>
      `;
      row.addEventListener('click', () => {
        this.searchResults.classList.add('hidden');
        this.searchInput.value = r.name;
        this.callbacks.onTargetSearchSelect({ domain: r.domain, index: r.index, name: r.name });
      });
      this.searchResults.appendChild(row);
    }
    this.searchResults.classList.remove('hidden');
  }

  setChaseButtonState(active: boolean): void {
    if (!this.chaseBtn) return;
    if (active) {
      this.chaseBtn.classList.add('active');
      this.chaseBtn.textContent = 'Tracking Active';
    } else {
      this.chaseBtn.classList.remove('active');
      this.chaseBtn.textContent = 'Chase Cam';
    }
  }

  private initActionButtons(): void {
    this.chaseBtn?.addEventListener('click', () => {
      const active = this.chaseBtn.classList.toggle('active');
      this.chaseBtn.textContent = active ? 'Tracking Active' : 'Chase Cam';
      this.callbacks.onChaseCamToggle(active);
    });

    this.focusBtn?.addEventListener('click', () => {
      this.callbacks.onFocusTarget();
    });

    // Time controls
    const speedSlider = document.querySelector<HTMLInputElement>('#time-speed-slider');
    const speedLabel = document.querySelector<HTMLElement>('#time-speed-val');
    speedSlider?.addEventListener('input', () => {
      const speed = parseFloat(speedSlider.value);
      if (speedLabel) speedLabel.textContent = speed === 0 ? 'PAUSED' : `${speed}×`;
      this.callbacks.onTimeSpeedChange(speed);
    });

    document.querySelector('#btn-time-now')?.addEventListener('click', () => {
      this.callbacks.onTimeNow();
    });

    const pauseBtn = document.querySelector<HTMLButtonElement>('#btn-time-pause');
    pauseBtn?.addEventListener('click', () => {
      const isPaused = this.callbacks.onTimePause();
      if (pauseBtn) pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    });

    document.querySelector('#btn-reload-sats')?.addEventListener('click', () => {
      this.callbacks.onReloadSatellites();
    });
  }

  updateCounters(sats: number, flights: number, marine: number, quakes: number): void {
    if (this.topCounters.sats) this.topCounters.sats.textContent = sats.toLocaleString();
    if (this.topCounters.flights) this.topCounters.flights.textContent = flights.toLocaleString();
    if (this.topCounters.marine) this.topCounters.marine.textContent = marine.toLocaleString();
    if (this.topCounters.quakes) this.topCounters.quakes.textContent = quakes.toLocaleString();
  }

  updateClock(simTimeMs: number): void {
    const d = new Date(simTimeMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    if (this.zuluClock) {
      this.zuluClock.textContent = `${y}-${m}-${day} ${h}:${mi}:${s} UTC`;
    }
  }

  showTarget(target: SelectedTarget | null): void {
    if (!target) {
      this.targetCard?.classList.add('hidden');
      this.targetEmpty?.classList.remove('hidden');
      this.chaseBtn?.classList.remove('active');
      if (this.chaseBtn) this.chaseBtn.textContent = 'Chase Cam';
      this.lastMetaHtml = '';
      return;
    }

    this.targetEmpty?.classList.add('hidden');
    this.targetCard?.classList.remove('hidden');

    this.setText(this.targetName, 'name', target.name);
    if (this.targetDomainBadge) {
      const badgeClass = `badge domain-${target.domain}`;
      if (this.lastBadgeClass !== badgeClass) {
        this.lastBadgeClass = badgeClass;
        this.targetDomainBadge.className = badgeClass;
      }
      this.setText(this.targetDomainBadge, 'badge', target.domain.toUpperCase());
    }
    this.setText(this.targetId, 'id', target.id);
    this.setText(this.targetLat, 'lat', `${target.lat.toFixed(3)}°`);
    this.setText(this.targetLon, 'lon', `${target.lon.toFixed(3)}°`);
    this.setText(this.targetAlt, 'alt', `${target.altKm.toFixed(1)} km`);
    this.setText(this.targetSpeed, 'speed', `${Math.round(target.speedKmh)} km/h`);
    if (this.targetHeading) {
      this.setText(this.targetHeading, 'heading', target.heading != null ? `${Math.round(target.heading)}°` : '—');
    }

    if (this.targetMeta) {
      let metaHtml = '';
      if (target.origin && target.destination) {
        metaHtml += `<div><span class="dt">Route</span><span class="dd">${target.origin} → ${target.destination}</span></div>`;
      }
      if (target.country) {
        metaHtml += `<div><span class="dt">Country / Region</span><span class="dd">${target.country}</span></div>`;
      }
      if (target.operator) {
        metaHtml += `<div><span class="dt">Operator</span><span class="dd">${target.operator}</span></div>`;
      }
      if (target.subType) {
        metaHtml += `<div><span class="dt">Type / Class</span><span class="dd">${target.subType}</span></div>`;
      }
      if (target.extra) {
        for (const [k, v] of Object.entries(target.extra)) {
          metaHtml += `<div><span class="dt">${k}</span><span class="dd">${v}</span></div>`;
        }
      }
      if (this.lastMetaHtml !== metaHtml) {
        this.lastMetaHtml = metaHtml;
        this.targetMeta.innerHTML = metaHtml;
      }
    }
  }

  private lastMetaHtml = '';
  private lastBadgeClass = '';

  /** Writes textContent only when the value actually changed (showTarget runs every frame). */
  private setText(el: HTMLElement | null, key: string, value: string): void {
    if (!el || this.lastValues.get(key) === value) return;
    this.lastValues.set(key, value);
    el.textContent = value;
  }

  private lastValues = new Map<string, string>();

  private startEventTicker(): void {
    const SAMPLE_EVENTS = [
      'ISS (ZARYA) entering orbital daybreak over South Pacific',
      'OpenSky ADS-B live stream: 7,800+ global aircraft positions refreshed',
      'USGS Seismic Alert: M5.1 earthquake recorded offshore Indonesia (depth 10km)',
      'Starlink G7-18 constellation node passing orbital apex FL550',
      'Vessel EVER GIVEN approaching Suez Canal transit convoy',
      'NOAA SWPC: Aurora Oval expanded under Kp 3.3 solar wind excitation',
      'NASA DSN Goldstone DSS-14 lock: Voyager 1 telemetry downlink active at 163.5 AU',
      'NASA JPL Near-Earth Asteroid Apophis tracking: nominal trajectory at 0.08 LD',
      'NASA FIRMS: Thermal anomaly cluster active in Amazon southern basin',
      'Smithsonian GVP: Mount Etna SE Crater explosive Strombolian activity detected',
      'Super Typhoon MAN-YI (Pepito) sustained 145 kts in Philippine Sea',
      'Baltic Sea EW corridor: 92% GNSS denial / spoofing detected',
      'Cape Canaveral SLC-40 Falcon 9 launch countdown T-3h 56m',
      'Submarine Fiber MAREA 200 Tbps transatlantic operational link nominal',
    ];

    let idx = 0;
    setInterval(() => {
      // Real events (from live feeds) take priority over the curated samples.
      const text = this.tickerQueue.length
        ? this.tickerQueue.shift()!
        : SAMPLE_EVENTS[idx];
      idx = (idx + 1) % SAMPLE_EVENTS.length;
      this.showTicker(text);
    }, 4000);
  }

  /** Show a real event in the ticker immediately (also queued for rotation). */
  pushEvent(text: string): void {
    this.tickerQueue.push(text);
    this.showTicker(text);
  }

  private tickerQueue: string[] = [];
  private lastTickerText = '';

  private showTicker(text: string): void {
    if (!this.tickerStream || text === this.lastTickerText) return;
    this.lastTickerText = text;
    this.tickerStream.style.opacity = '0';
    setTimeout(() => {
      if (!this.tickerStream) return;
      this.tickerStream.textContent = text;
      this.tickerStream.style.opacity = '1';
    }, 300);
  }
}
