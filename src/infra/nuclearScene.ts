import * as THREE from 'three';
import { NUCLEAR_PLANTS, type NuclearPlantRecord } from './nuclear';

const atomVertex = /* glsl */ `
  attribute float aSize;
  varying vec3 vColor;
  uniform float uPixelRatio;

  void main() {
    vColor = vec3(0.95, 0.85, 0.2); // Warm atomic yellow
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = aSize * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 3.0, 14.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const atomFragment = /* glsl */ `
  varying vec3 vColor;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Trefoil / ring glow symbol
    float ring = smoothstep(0.48, 0.38, d) * smoothstep(0.20, 0.30, d);
    float core = smoothstep(0.18, 0.05, d);
    float alpha = core * 0.95 + ring * 0.85;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class NuclearScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    const sizes: number[] = [];

    for (const p of NUCLEAR_PLANTS) {
      positions.push(p.x, p.y, p.z);
      sizes.push(1.2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: atomVertex,
      fragmentShader: atomFragment,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.visible = false;
  }

  get list(): NuclearPlantRecord[] {
    return NUCLEAR_PLANTS;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.points.visible = visible;
  }

  highlight(index: number): void {
    const attr = this.points.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    for (let i = 0; i < NUCLEAR_PLANTS.length; i++) {
      attr.setX(i, i === index ? 2.5 : 1.2);
    }
    attr.needsUpdate = true;
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
