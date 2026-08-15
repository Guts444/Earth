import * as THREE from 'three';
import { EARTH_RADIUS } from '../config';

const CLOUDS_TEXTURE = '/textures/earth-clouds.png';

const cloudsVertex = /* glsl */ `
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
`;

const cloudsFragment = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec3 sunDirection;
  uniform float opacity;
  uniform float fullDaylight;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec4 sampleVal = texture2D(cloudMap, vUv);
    float density = sampleVal.r;

    // Discard clear sky so continents & oceans are 100% visible
    if (density < 0.08) discard;

    vec3 n = normalize(vNormalW);
    float ndl = dot(n, normalize(sunDirection));
    float dayness = mix(smoothstep(-0.2, 0.25, ndl), 1.0, fullDaylight);

    // Warm white in daylight, dark deep blue in night shadow
    vec3 dayColor = vec3(0.96, 0.98, 1.0);
    vec3 nightColor = vec3(0.015, 0.025, 0.05);
    vec3 col = mix(nightColor, dayColor, dayness);

    // Subtle cloud opacity
    float alpha = density * opacity * (0.15 + 0.65 * dayness);

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface CloudSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update(dt: number, sunDir: THREE.Vector3): void;
  setVisible(visible: boolean): void;
  setFullDaylight(active: boolean): void;
}

export async function createClouds(): Promise<CloudSystem> {
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';

  const cloudTex = await loader.loadAsync(CLOUDS_TEXTURE);
  cloudTex.wrapS = THREE.RepeatWrapping;

  const mat = new THREE.ShaderMaterial({
    vertexShader: cloudsVertex,
    fragmentShader: cloudsFragment,
    uniforms: {
      cloudMap: { value: cloudTex },
      sunDirection: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
      opacity: { value: 0.45 },
      fullDaylight: { value: 0.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const geo = new THREE.SphereGeometry(EARTH_RADIUS * 1.004, 72, 72);
  const mesh = new THREE.Mesh(geo, mat);

  return {
    mesh,
    material: mat,
    update(dt: number, sunDir: THREE.Vector3) {
      mesh.rotation.y += dt * 0.0005;
      mat.uniforms.sunDirection.value.copy(sunDir);
    },
    setVisible(visible: boolean) {
      mesh.visible = visible;
    },
    setFullDaylight(active: boolean) {
      mat.uniforms.fullDaylight.value = active ? 1.0 : 0.0;
    },
  };
}
