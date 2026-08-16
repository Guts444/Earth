import * as THREE from 'three';
import { pickPointsNearestCursor, type PickHit } from '../domains/pick';
import { WILDFIRE_CLUSTERS, type WildfireCluster } from './wildfires';

const fireVertex = /* glsl */ `
  attribute float aFRP;
  varying float vFRP;
  uniform float uPixelRatio;

  void main() {
    vFRP = aFRP;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = (10.0 + aFRP * 0.02) * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 4.0, 18.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fireFragment = /* glsl */ `
  varying float vFRP;
  uniform float uTime;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Thermal flicker
    float flicker = sin(uTime * 14.0 + vFRP) * 0.15 + 0.85;

    // Fiery heat gradient: yellow-white core -> bright orange -> dark crimson edge
    vec3 whiteHot = vec3(1.0, 0.95, 0.6);
    vec3 orangeFire = vec3(1.0, 0.35, 0.0);
    vec3 smokeEdge = vec3(0.6, 0.05, 0.02);

    vec3 col = mix(whiteHot, orangeFire, smoothstep(0.0, 0.25, d));
    col = mix(col, smokeEdge, smoothstep(0.25, 0.5, d));

    float alpha = smoothstep(0.5, 0.05, d) * flicker * 0.95;

    gl_FragColor = vec4(col, alpha);
  }
`;

export class WildfiresScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    const frps: number[] = [];

    for (const f of WILDFIRE_CLUSTERS) {
      positions.push(f.x, f.y, f.z);
      frps.push(f.frpMw);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aFRP', new THREE.Float32BufferAttribute(frps, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: fireVertex,
      fragmentShader: fireFragment,
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

  get list(): WildfireCluster[] {
    return WILDFIRE_CLUSTERS;
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

  pick(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointerNdc: THREE.Vector2,
  ): PickHit | null {
    if (!this.isVisible) return null;
    return pickPointsNearestCursor(raycaster, camera, pointerNdc, this.points);
  }
}
