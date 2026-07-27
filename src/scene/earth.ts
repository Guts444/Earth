import * as THREE from 'three';
import { ATMOSPHERE_SCALE, EARTH_RADIUS } from '../config';

const EARTH_DAY =
  'https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg';
const EARTH_NIGHT =
  'https://unpkg.com/three-globe@2.31.1/example/img/earth-night.jpg';
const EARTH_SPEC =
  'https://unpkg.com/three-globe@2.31.1/example/img/earth-water.png';

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
  clouds: THREE.Mesh | null;
  atmosphere: THREE.Mesh;
  sun: THREE.DirectionalLight;
  setSunDirection(dir: THREE.Vector3): void;
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
  // The water mask is data, not color. Decoding it as sRGB washes out the
  // distinction between oceans and land and makes the globe look muddy.
  specMap.colorSpace = THREE.NoColorSpace;
  specMap.anisotropy = maxAniso;

  // Day/night terminator via custom shader
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      specMap: { value: specMap },
      sunDirection: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
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
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 n = normalize(vNormalW);
        float ndl = dot(n, normalize(sunDirection));
        float dayness = smoothstep(-0.16, 0.20, ndl);

        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb * 1.12;
        float water = texture2D(specMap, vUv).r;

        // Lift the intrinsically dark blue-marble source without bleaching it.
        day = pow(day, vec3(0.82));
        float daylight = mix(0.90, 1.18, smoothstep(0.0, 0.85, max(ndl, 0.0)));
        vec3 dayLit = day * daylight;
        dayLit += vec3(0.025, 0.04, 0.065) * water * dayness;
        vec3 color = mix(night, dayLit, dayness);

        // Specular glint on oceans (day side only)
        vec3 viewDir = normalize(cameraPosition - vPosW);
        vec3 halfDir = normalize(normalize(sunDirection) + viewDir);
        float spec = pow(max(dot(n, halfDir), 0.0), 48.0) * water * dayness;
        color += vec3(0.60, 0.76, 1.0) * spec * 0.24;

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

  const sun = new THREE.DirectionalLight(0xffffff, 0); // shading is in earth shader
  sun.position.set(5, 1, 2);

  return {
    group,
    earth,
    clouds: null,
    atmosphere,
    sun,
    setSunDirection(dir: THREE.Vector3) {
      (earth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(dir);
      sun.position.copy(dir).multiplyScalar(10);
    },
  };
}

export function createStarfield(count = 6000): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Uniform on sphere shell
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 40 + Math.random() * 60;
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
