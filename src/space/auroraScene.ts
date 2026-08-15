import * as THREE from 'three';
import { EARTH_RADIUS } from '../config';

const auroraVertex = /* glsl */ `
  attribute float aAlt;
  varying vec2 vUv;
  varying float vAlt;
  uniform float uTime;

  void main() {
    vUv = uv;
    vAlt = aAlt;

    // Subtle wave undulating in solar wind
    float wave = sin(position.x * 12.0 + uTime * 1.5) * cos(position.z * 12.0 + uTime * 1.2) * 0.003;
    vec3 pos = position + normal * (aAlt * 0.035 + wave);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const auroraFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vAlt;
  uniform float uTime;
  uniform float uBrightness;

  void main() {
    // Dynamic curtain folds
    float curtain = sin(vUv.x * 48.0 + uTime * 2.0) * 0.5 + 0.5;
    curtain = pow(curtain, 2.0) * 0.7 + 0.3;

    // Emission colors: 557.7nm green oxygen at base, violet/magenta nitrogen at top
    vec3 greenO2 = vec3(0.15, 0.95, 0.45);
    vec3 purpleN2 = vec3(0.85, 0.15, 0.80);
    vec3 col = mix(greenO2, purpleN2, smoothstep(0.3, 0.95, vAlt));

    // Vertical altitude fade
    float alpha = sin(vAlt * 3.14159) * curtain * uBrightness * 0.65;

    gl_FragColor = vec4(col, alpha);
  }
`;

export class AuroraScene {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private isVisible = false;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: auroraVertex,
      fragmentShader: auroraFragment,
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 0.85 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    // 1. North Magnetic Auroral Oval Ribbon (~72-78° geomagnetic latitude)
    const northMesh = this.createOvalRibbon(70, 78, 128);
    northMesh.rotation.x = THREE.MathUtils.degToRad(-11); // Tilt to magnetic pole
    northMesh.rotation.y = THREE.MathUtils.degToRad(75);
    this.group.add(northMesh);

    // 2. South Magnetic Auroral Oval Ribbon (~65-72° south)
    const southMesh = this.createOvalRibbon(-66, -74, 128);
    southMesh.rotation.x = THREE.MathUtils.degToRad(14);
    southMesh.rotation.y = THREE.MathUtils.degToRad(-110);
    this.group.add(southMesh);

    this.group.visible = false;
  }

  private createOvalRibbon(minLatDeg: number, maxLatDeg: number, segments = 96): THREE.Mesh {
    const minLat = THREE.MathUtils.degToRad(minLatDeg);
    const maxLat = THREE.MathUtils.degToRad(maxLatDeg);
    const r = EARTH_RADIUS * 1.008;

    const positions: number[] = [];
    const uvs: number[] = [];
    const alts: number[] = [];
    const indices: number[] = [];

    const rings = 8;
    for (let rIdx = 0; rIdx <= rings; rIdx++) {
      const altFrac = rIdx / rings;
      const lat = minLat + (maxLat - minLat) * 0.5;
      const clat = Math.cos(lat);
      const slat = Math.sin(lat);

      for (let sIdx = 0; sIdx <= segments; sIdx++) {
        const u = sIdx / segments;
        const lon = u * Math.PI * 2;

        const x = r * clat * Math.cos(lon);
        const y = r * slat;
        const z = -r * clat * Math.sin(lon);

        positions.push(x, y, z);
        uvs.push(u, altFrac);
        alts.push(altFrac);
      }
    }

    for (let rIdx = 0; rIdx < rings; rIdx++) {
      for (let sIdx = 0; sIdx < segments; sIdx++) {
        const i0 = rIdx * (segments + 1) + sIdx;
        const i1 = i0 + 1;
        const i2 = (rIdx + 1) * (segments + 1) + sIdx;
        const i3 = i2 + 1;

        indices.push(i0, i2, i1);
        indices.push(i1, i2, i3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aAlt', new THREE.Float32BufferAttribute(alts, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return new THREE.Mesh(geo, this.material);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.group.visible = visible;
  }

  setBrightness(val: number): void {
    this.material.uniforms.uBrightness.value = val;
  }

  update(wallTimeSec: number): void {
    if (!this.isVisible) return;
    this.material.uniforms.uTime.value = wallTimeSec;
  }
}
