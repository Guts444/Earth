import * as THREE from 'three';
import { VOLCANOES, type VolcanoRecord } from './volcanoes';

const volcanoVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  uniform float uPixelRatio;

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = aSize * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 4.0, 16.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const volcanoFragment = /* glsl */ `
  varying vec3 vColor;
  uniform float uTime;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Caldera ring + volcanic core
    float ring = smoothstep(0.48, 0.36, d) * smoothstep(0.18, 0.28, d);
    float core = smoothstep(0.15, 0.04, d);
    float pulse = sin(uTime * 5.0) * 0.15 + 0.85;

    float alpha = (core * 0.95 + ring * 0.8) * pulse;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class VolcanoesScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    for (const v of VOLCANOES) {
      positions.push(v.x, v.y, v.z);

      if (v.alertLevel === 'WARNING') {
        colors.push(1.0, 0.1, 0.25); // Red warning
        sizes.push(1.8);
      } else if (v.alertLevel === 'WATCH') {
        colors.push(1.0, 0.55, 0.0); // Orange watch
        sizes.push(1.5);
      } else if (v.alertLevel === 'ADVISORY') {
        colors.push(1.0, 0.85, 0.1); // Yellow advisory
        sizes.push(1.3);
      } else {
        colors.push(0.3, 0.85, 0.4); // Green normal
        sizes.push(1.1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: volcanoVertex,
      fragmentShader: volcanoFragment,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.visible = false;
  }

  get list(): VolcanoRecord[] {
    return VOLCANOES;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.points.visible = visible;
  }

  highlight(_index: number): void {
    // highlight state
  }

  update(wallTimeSec: number): void {
    if (!this.isVisible) return;
    this.material.uniforms.uTime.value = wallTimeSec;
  }

  pick(raycaster: THREE.Raycaster, camera: THREE.Camera): number {
    if (!this.isVisible) return -1;
    const camDist = camera.position.length();
    raycaster.params.Points = { threshold: 0.04 * (camDist / 3) };
    const hits = raycaster.intersectObject(this.points, false);
    if (hits.length === 0) return -1;
    return hits[0].index ?? -1;
  }
}
