/**
 * GeographicContext — the geographic/cartographic context subsystem facade.
 *
 * Owns country borders, admin-1 boundaries, and country/admin-1/city labels,
 * plus their distance-driven LOD. Exposes the small surface main.ts needs:
 *
 *   interface GeographicContext {
 *     group: THREE.Group;               // boundary lines (scene child)
 *     update(camera): void;             // per-frame LOD + label layout
 *     setVisible(v): void;              // master toggle
 *   }
 *
 * Data is static after load (bundled Natural Earth JSON — see data.ts); no
 * runtime polling, no geometry rebuilds. Labels render on a dedicated 2D
 * canvas (see labels.ts) that sits below the HUD panels.
 */
import * as THREE from 'three';
import { BoundaryLayers } from './boundaries';
import { loadGeoContextData, validateGeoData, type GeoContextData } from './data';
import { LabelLayer } from './labels';

export interface GeographicContext {
  group: THREE.Group;
  /** Per-frame update: boundary opacities + label layout (dirty-checked). */
  update(camera: THREE.PerspectiveCamera, sceneRotY: number): void;
  /** Master toggle — OFF hides borders and labels; ON resumes automatic LOD. */
  setVisible(v: boolean): void;
}

export class GeographicContextScene implements GeographicContext {
  readonly group = new THREE.Group();
  private boundaries: BoundaryLayers | null = null;
  private labels: LabelLayer;
  private wantVisible = true;
  private data: GeoContextData | null = null;

  /** Resolves true once the dataset is loaded and the scene is built. */
  readonly ready: Promise<boolean>;

  constructor(container: HTMLElement) {
    this.labels = new LabelLayer(container);
    this.ready = loadGeoContextData()
      .then((data) => {
        const errors = validateGeoData(data);
        if (errors.length > 0) {
          console.warn('Geographic context dataset looks broken:', errors);
          return false;
        }
        this.data = data;
        this.boundaries = new BoundaryLayers(data);
        this.group.add(this.boundaries.group);
        this.boundaries.setVisible(this.wantVisible);
        this.labels.build(data);
        return true;
      })
      .catch((err) => {
        console.warn('Geographic context unavailable — borders/labels disabled:', err);
        return false;
      });
  }

  update(camera: THREE.PerspectiveCamera, sceneRotY: number): void {
    if (!this.wantVisible || !this.boundaries) return;
    const camDist = camera.position.length();
    this.boundaries.update(camDist);
    this.labels.update(camera, sceneRotY, this.wantVisible);
  }

  setVisible(v: boolean): void {
    this.wantVisible = v;
    this.group.visible = v;
    this.boundaries?.setVisible(v);
    if (!v) this.labels.clear();
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.labels.resize(cssW, cssH, dpr);
  }

  /** Stats for diagnostics/verification. */
  get stats(): { countries: number; admin1: number; cities: number; segments: number } {
    return {
      countries: this.data?.countries.length ?? 0,
      admin1: this.data?.admin1.length ?? 0,
      cities: this.data?.cities.length ?? 0,
      segments: this.boundaries?.segmentCount ?? 0,
    };
  }

  /** Names placed in the last label layout pass (verification harness). */
  get lastPlacedLabels(): string[] {
    return this.labels.placedNames;
  }

  /** Names that survived the candidate filters (verification harness). */
  get lastCandidateLabels(): string[] {
    return this.labels.candidateNames;
  }

  /** Per-kind label pipeline counters (verification harness). */
  get labelDebug(): { entries: number[]; candidates: number[]; placed: number[] } {
    return this.labels.debugCounts;
  }
}
