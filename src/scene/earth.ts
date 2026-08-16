import * as THREE from 'three';
import { ATMOSPHERE_SCALE, EARTH_RADIUS } from '../config';
import { createClouds, type CloudSystem } from './clouds';

// Relative paths (not root-absolute) so textures resolve under any deploy
// base — dev server, /Earth/ on GitHub Pages, or file://.
const EARTH_DAY = 'textures/earth-blue-marble.jpg';
const EARTH_NIGHT = 'textures/earth-night.jpg';
const EARTH_SPEC = 'textures/earth-water.png';

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform vec3 glowColor;
  uniform float intensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.4);
    float alpha = fresnel * intensity;
    gl_FragColor = vec4(glowColor, alpha);
  }
`;

export interface EarthSystem {
  group: THREE.Group;
  earth: THREE.Mesh;
  clouds: CloudSystem | null;
  atmosphere: THREE.Mesh;
  sun: THREE.DirectionalLight;
  setSunDirection(dir: THREE.Vector3): void;
  setFullDaylight(active: boolean): void;
  update(dt: number): void;
}
export async function createEarth(renderer: THREE.WebGLRenderer): Promise<EarthSystem> {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';

  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const [dayMap, nightMap, specMap] = await Promise.all([
    loader.loadAsync(EARTH_DAY),
    loader.loadAsync(EARTH_NIGHT),
    loader.loadAsync(EARTH_SPEC),
  ]);

  for (const tex of [dayMap, nightMap]) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
  }
  specMap.colorSpace = THREE.NoColorSpace;
  specMap.anisotropy = maxAniso;

  const currentSunDir = new THREE.Vector3(1, 0.2, 0.4).normalize();

  // Day/night terminator via custom shader
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      specMap: { value: specMap },
      sunDirection: { value: currentSunDir.clone() },
      fullDaylight: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform sampler2D specMap;
      uniform vec3 sunDirection;
      uniform float fullDaylight;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 n = normalize(vNormalW);
        vec3 sunDir = normalize(sunDirection);
        float ndl = dot(n, sunDir);
        float rawDayness = smoothstep(-0.16, 0.20, ndl);
        float dayness = mix(rawDayness, 1.0, fullDaylight);

        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb * 1.25;
        float water = texture2D(specMap, vUv).r;

        // Lift dark blue marble without overexposing
        day = pow(day, vec3(0.82));
        float daylight = mix(0.90, 1.18, smoothstep(0.0, 0.85, max(ndl, 0.0)));
        daylight = mix(daylight, 1.12, fullDaylight);

        vec3 dayLit = day * daylight;
        dayLit += vec3(0.025, 0.04, 0.065) * water * dayness;
        vec3 color = mix(night, dayLit, dayness);

        // Ocean specular glint on day side
        vec3 viewDir = normalize(cameraPosition - vPosW);
        vec3 halfDir = normalize(sunDir + viewDir);
        float spec = pow(max(dot(n, halfDir), 0.0), 48.0) * water * dayness;
        color += vec3(0.60, 0.76, 1.0) * spec * 0.25;

        // Soft limb darkening
        float limb = pow(max(dot(n, viewDir), 0.0), 0.35);
        color *= mix(0.82, 1.0, limb);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 96, 96),
    earthMat,
  );
  group.add(earth);

  // Dynamic cloud layer
  let clouds: CloudSystem | null = null;
  try {
    clouds = await createClouds();
    group.add(clouds.mesh);
  } catch (err) {
    console.warn('Could not initialize clouds:', err);
  }

  // Inner atmosphere glow
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * ATMOSPHERE_SCALE, 64, 64),
    new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        glowColor: { value: new THREE.Color(0.35, 0.65, 1.0) },
        intensity: { value: 1.15 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(atmosphere);

  // Thin outer halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.04, 48, 48),
    new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        glowColor: { value: new THREE.Color(0.2, 0.45, 1.0) },
        intensity: { value: 0.45 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(halo);

  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.set(5, 1, 2);

  return {
    group,
    earth,
    clouds,
    atmosphere,
    sun,
    setSunDirection(dir: THREE.Vector3) {
      currentSunDir.copy(dir);
      (earth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(dir);
      sun.position.copy(dir).multiplyScalar(10);
    },
    setFullDaylight(active: boolean) {
      (earth.material as THREE.ShaderMaterial).uniforms.fullDaylight.value = active ? 1.0 : 0.0;
      if (clouds) {
        clouds.setFullDaylight(active);
      }
    },
    update(dt: number) {
      if (clouds) {
        clouds.update(dt, currentSunDir);
      }
    },
  };
}

export function createStarfield(count = 7500): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 45 + Math.random() * 65;
    const i3 = i * 3;
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = r * Math.cos(phi);

    const temp = 0.7 + Math.random() * 0.3;
    color.setHSL(0.55 + Math.random() * 0.1, 0.2, temp);
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.06,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  return new THREE.Points(geo, mat);
}
