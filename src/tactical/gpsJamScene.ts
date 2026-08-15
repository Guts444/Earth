import * as THREE from 'three';
import { GPS_JAM_ZONES, type GpsJamZone } from './gpsJam';

const jamVertex = /* glsl */ `
  attribute float aInterference;
  varying float vInterference;
  uniform float uPixelRatio;

  void main() {
    vInterference = aInterference;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = (24.0 + aInterference * 0.15) * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 12.0, 48.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const jamFragment = /* glsl */ `
  varying float vInterference;
  uniform float uTime;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Hexagonal / radar sweep pattern
    float angle = atan(c.y, c.x);
    float scan = sin(angle * 6.0 + uTime * 3.0) * 0.5 + 0.5;

    // Hazard ring
    float ring1 = smoothstep(0.48, 0.40, d) * smoothstep(0.28, 0.36, d);
    float ring2 = smoothstep(0.24, 0.18, d) * smoothstep(0.08, 0.14, d);
    float centerDot = smoothstep(0.08, 0.02, d);

    // Hazard colors: Magenta EW denial
    vec3 jamCol = vec3(1.0, 0.0, 0.55);
    vec3 warningCol = vec3(1.0, 0.35, 0.0);
    vec3 col = mix(warningCol, jamCol, vInterference / 100.0);

    float pulse = sin(uTime * 4.0 + vInterference) * 0.2 + 0.8;
    float alpha = (ring1 * 0.85 + ring2 * 0.6 + centerDot * 0.95 + scan * 0.15) * pulse;

    gl_FragColor = vec4(col, alpha);
  }
`;

export class GpsJamScene {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    const interferences: number[] = [];

    for (const z of GPS_JAM_ZONES) {
      positions.push(z.x, z.y, z.z);
      interferences.push(z.interferencePct);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aInterference', new THREE.Float32BufferAttribute(interferences, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: jamVertex,
      fragmentShader: jamFragment,
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

  get list(): GpsJamZone[] {
    return GPS_JAM_ZONES;
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
