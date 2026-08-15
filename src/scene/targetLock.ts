import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface TargetLocation {
  x: number;
  y: number;
  z: number;
  label?: string;
  speedKmh?: number;
  altKm?: number;
}

export class TargetLockController {
  private reticleEl: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;
  private onChaseDisengaged?: () => void;

  private currentTarget: TargetLocation | null = null;
  private isChaseCamActive = false;
  private isTransitioning = false;
  private transitionStartCam = new THREE.Vector3();
  private transitionEndCam = new THREE.Vector3();
  private transitionProgress = 0;
  private transitionDuration = 0.8;

  constructor(
    reticleEl: HTMLElement,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    canvas: HTMLCanvasElement,
    onChaseDisengaged?: () => void,
  ) {
    this.reticleEl = reticleEl;
    this.camera = camera;
    this.controls = controls;
    this.canvas = canvas;
    this.onChaseDisengaged = onChaseDisengaged;

    // Controls must always orbit around the center of the Earth
    this.controls.target.set(0, 0, 0);

    // If user starts manual orbiting/panning, smoothly release chase cam
    this.controls.addEventListener('start', () => {
      if (this.isChaseCamActive) {
        this.isChaseCamActive = false;
        this.controls.target.set(0, 0, 0);
        this.onChaseDisengaged?.();
      }
      this.isTransitioning = false;
    });
  }

  setTarget(target: TargetLocation | null, flyTo = false): void {
    this.currentTarget = target;
    if (!target) {
      this.reticleEl.classList.add('hidden');
      this.setChaseCam(false);
      return;
    }

    this.reticleEl.classList.remove('hidden');
    const labelEl = this.reticleEl.querySelector('.reticle-label');
    if (labelEl && target.label) {
      labelEl.textContent = target.label;
    }

    if (flyTo) {
      this.flyToTarget(target);
    }
  }

  setChaseCam(active: boolean): void {
    this.isChaseCamActive = active;
    this.controls.target.set(0, 0, 0);
    if (!active) {
      this.onChaseDisengaged?.();
    }
  }

  get isChaseCam(): boolean {
    return this.isChaseCamActive;
  }

  flyToTarget(target: TargetLocation, duration = 0.8): void {
    const targetPos = new THREE.Vector3(target.x, target.y, target.z);
    const dir = targetPos.clone().normalize();
    const currentDist = this.camera.position.length();
    const desiredDist = Math.max(Math.min(currentDist, 2.8), 1.55);

    this.transitionStartCam.copy(this.camera.position);
    this.transitionEndCam.copy(dir.multiplyScalar(desiredDist));

    this.controls.target.set(0, 0, 0);
    this.transitionProgress = 0;
    this.transitionDuration = duration;
    this.isTransitioning = true;
  }

  flyToCoord(latDeg: number, lonDeg: number, altitudeUnits = 1.8, duration = 0.8): void {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;

    const clat = Math.cos(lat);
    const x = clat * Math.cos(lon);
    const y = Math.sin(lat);
    const z = -clat * Math.sin(lon);

    const dir = new THREE.Vector3(x, y, z).normalize();

    this.transitionStartCam.copy(this.camera.position);
    this.transitionEndCam.copy(dir.multiplyScalar(altitudeUnits));

    this.controls.target.set(0, 0, 0);
    this.transitionProgress = 0;
    this.transitionDuration = duration;
    this.isTransitioning = true;
  }

  update(dt: number): void {
    // 1. Camera Fly-To Transition
    if (this.isTransitioning) {
      this.transitionProgress += dt / this.transitionDuration;
      const t = Math.min(this.transitionProgress, 1.0);
      const ease = 1 - Math.pow(1 - t, 3); // smooth ease-out cubic

      this.camera.position.lerpVectors(this.transitionStartCam, this.transitionEndCam, ease);
      this.controls.target.set(0, 0, 0);

      if (t >= 1.0) {
        this.isTransitioning = false;
      }
    } else if (this.isChaseCamActive && this.currentTarget) {
      // 2. Smooth Chase-Cam: orbits with target while maintaining Earth-centered orientation
      const targetPos = new THREE.Vector3(
        this.currentTarget.x,
        this.currentTarget.y,
        this.currentTarget.z,
      );
      const dir = targetPos.clone().normalize();
      const currentDist = Math.max(this.camera.position.length(), 1.5);
      const desiredCamPos = dir.multiplyScalar(currentDist);

      this.camera.position.lerp(desiredCamPos, 0.08);
      this.controls.target.set(0, 0, 0);
    }

    // 3. Screen-Space Reticle Positioning
    if (this.currentTarget) {
      const pos = new THREE.Vector3(
        this.currentTarget.x,
        this.currentTarget.y,
        this.currentTarget.z,
      );

      // Check if target is facing camera (not obscured behind Earth sphere)
      const camDir = this.camera.position.clone().normalize();
      const targetDir = pos.clone().normalize();
      const facingCam = camDir.dot(targetDir) > 0.02;

      pos.project(this.camera);

      if (!facingCam || pos.z > 1.0) {
        this.reticleEl.style.opacity = '0.15';
      } else {
        this.reticleEl.style.opacity = '1.0';
      }

      const rect = this.canvas.getBoundingClientRect();
      const screenX = ((pos.x + 1) / 2) * rect.width + rect.left;
      const screenY = ((-pos.y + 1) / 2) * rect.height + rect.top;

      this.reticleEl.style.transform = `translate(${screenX}px, ${screenY}px)`;
    }
  }
}
