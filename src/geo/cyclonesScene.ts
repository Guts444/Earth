import * as THREE from 'three';
import { CYCLONES, type CycloneRecord } from './cyclones';

const stormVertex = /* glsl */ `
  attribute float aCat;
  varying float vCat;
  uniform float uPixelRatio;

  void main() {
    vCat = aCat;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = (18.0 + aCat * 4.0) * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 8.0, 36.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const stormFragment = /* glsl */ `
  varying float vCat;
  uniform float uTime;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Spiraling vortex angle
    float angle = atan(c.y, c.x);
    float spiral = sin(angle * 3.0 - d * 20.0 + uTime * 4.0) * 0.5 + 0.5;

    // Eye of hurricane (clear center)
    float eye = smoothstep(0.08, 0.16, d);
    float eyewall = smoothstep(0.12, 0.25, d) * smoothstep(0.48, 0.25, d);

    // Cyan/white hurricane cloud with violet core
    vec3 cloudCol = vec3(0.85, 0.95, 1.0);
    vec3 vortexCol = vec3(0.0, 0.85, 0.95);
    vec3 col = mix(cloudCol, vortexCol, spiral * 0.4);

    float alpha = eye * eyewall * (0.5 + 0.5 * spiral) * 0.9;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class CyclonesScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    const cats: number[] = [];

    for (const c of CYCLONES) {
      positions.push(c.x, c.y, c.z);
      cats.push(c.category);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aCat', new THREE.Float32BufferAttribute(cats, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: stormVertex,
      fragmentShader: stormFragment,
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

  get list(): CycloneRecord[] {
    return CYCLONES;
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
    raycaster.params.Points = { threshold: 0.05 * (camDist / 3) };
    const hits = raycaster.intersectObject(this.points, false);
    if (hits.length === 0) return -1;
    return hits[0].index ?? -1;
  }
}
