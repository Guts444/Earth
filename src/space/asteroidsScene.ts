import * as THREE from 'three';
import { NEAR_EARTH_ASTEROIDS, type AsteroidRecord } from './asteroids';

const asteroidVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uPixelRatio;

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.2);
    gl_PointSize = aSize * uPixelRatio * (28.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 4.0, 20.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const asteroidFragment = /* glsl */ `
  varying vec3 vColor;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    // Rocky core + danger ring
    float ring = smoothstep(0.48, 0.38, d) * smoothstep(0.20, 0.30, d);
    float core = smoothstep(0.22, 0.05, d);
    float alpha = core * 0.95 + ring * 0.85;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class AsteroidsScene {
  readonly group = new THREE.Group();
  private pointsMesh: THREE.Points;
  private trajectoryLines: THREE.Line[] = [];
  private isVisible = false;

  constructor() {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    for (const a of NEAR_EARTH_ASTEROIDS) {
      positions.push(a.sceneX, a.sceneY, a.sceneZ);

      // Color by hazard
      if (a.hazardLevel === 'CRITICAL') {
        colors.push(1.0, 0.0, 0.35); // Crimson danger
      } else if (a.hazardLevel === 'MONITORED') {
        colors.push(1.0, 0.65, 0.0); // Amber
      } else {
        colors.push(0.4, 0.85, 1.0); // Cyan
      }

      sizes.push(a.hazardLevel === 'CRITICAL' ? 2.2 : 1.5);

      // Trajectory vector line connecting Earth to asteroid
      const trajGeo = new THREE.BufferGeometry();
      const origin = new THREE.Vector3(a.sceneX, a.sceneY, a.sceneZ);
      const velVec = origin.clone().normalize().multiplyScalar(0.8);
      const end = origin.clone().add(velVec);

      trajGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([origin.x, origin.y, origin.z, end.x, end.y, end.z], 3),
      );

      const trajMat = new THREE.LineBasicMaterial({
        color: a.hazardLevel === 'CRITICAL' ? 0xff0055 : 0xffaa00,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(trajGeo, trajMat);
      this.trajectoryLines.push(line);
      this.group.add(line);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: asteroidVertex,
      fragmentShader: asteroidFragment,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.pointsMesh = new THREE.Points(geo, mat);
    this.group.add(this.pointsMesh);

    this.group.visible = false;
  }

  get list(): AsteroidRecord[] {
    return NEAR_EARTH_ASTEROIDS;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.group.visible = visible;
  }

  highlight(index: number): void {
    const attr = this.pointsMesh.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    for (let i = 0; i < NEAR_EARTH_ASTEROIDS.length; i++) {
      const base = NEAR_EARTH_ASTEROIDS[i].hazardLevel === 'CRITICAL' ? 2.2 : 1.5;
      attr.setX(i, i === index ? base * 2.0 : base);
    }
    attr.needsUpdate = true;
  }

  pick(raycaster: THREE.Raycaster, camera: THREE.Camera): number {
    if (!this.isVisible) return -1;
    const camDist = camera.position.length();
    raycaster.params.Points = { threshold: 0.06 * (camDist / 3) };
    const hits = raycaster.intersectObject(this.pointsMesh, false);
    if (hits.length === 0) return -1;
    return hits[0].index ?? -1;
  }
}
