// @ts-nocheck
import * as THREE from 'three';
import { OreKind, RockConfig, TreeConfig } from '../types';
import { resolvePixelTextureParams } from './pixelArtTextureSystem';

type OreShape = 'nodule' | 'crystal' | 'gem' | 'prism' | 'block' | 'plate' | 'shard';
export const ORE_STYLES: Record<OreKind, { name: string; description: string; colors: string[]; shape: OreShape; scale?: [number, number, number] }> = {
  iron: { name: 'Ferro', shape: 'nodule', description: 'Nódulos cinzentos e veios escuros com reflexos claros.', colors: ['#28323d', '#47525d', '#69767f', '#8d9b9e', '#bac4bf', '#ddd7bf'] },
  copper: { name: 'Cobre', shape: 'nodule', description: 'Fragmentos ocres e alaranjados com pequenos trechos de oxidação verde.', colors: ['#493b35', '#75503a', '#a97043', '#c68e56', '#dfb677', '#eee0aa'] },
  quartz: { name: 'Quartzo', shape: 'crystal', description: 'Cristais curtos e irregulares, claros, com sombras azuladas.', colors: ['#53677b', '#7d94a6', '#a7bac3', '#cbd8d9', '#e6e8dd', '#f5efda'] },
  gold: { name: 'Ouro', shape: 'nodule', scale: [1, 0.85, 0.9], description: 'Pepitas douradas e veios quentes com reflexos amarelos claros.', colors: ['#463520', '#735122', '#a7792c', '#caa23e', '#e7c767', '#f8e8a3'] },
  diamond: { name: 'Diamante', shape: 'gem', description: 'Cristais compactos de faces triangulares, claros e azulados.', colors: ['#415e7b', '#6d97b5', '#9bc5d4', '#c8e4e8', '#e5f4f0', '#fcfaf0'] },
  mithril: { name: 'Mithril', shape: 'plate', description: 'Lamelas azul-prateadas com tons de turquesa e reflexos frios.', colors: ['#203b4c', '#365f73', '#518a9c', '#77b3bf', '#afe0df', '#def5ed'] },
  orichalcum: { name: 'Oricalcum', shape: 'block', description: 'Fragmentos de metal rosado com veios de bronze e reflexos âmbar.', colors: ['#46303b', '#754348', '#a45d4f', '#ce865c', '#e9b47b', '#f6dda7'] },
  lead: { name: 'Chumbo', shape: 'nodule', scale: [1.1, 0.65, 1], description: 'Nódulos baixos de cinza escuro, com sombras azuladas e brilho discreto.', colors: ['#202833', '#333c4a', '#4b5564', '#677181', '#87909e', '#afb6be'] },
  coal: { name: 'Carvão', shape: 'shard', description: 'Fragmentos pretos quebrados, irregulares e de brilho contido.', colors: ['#101519', '#1a2125', '#293034', '#3a4144', '#4c5456', '#67716e'] },
  tin: { name: 'Estanho', shape: 'block', scale: [0.9, 0.8, 0.9], description: 'Pequenos blocos acinzentados com reflexos suaves e ligeiramente quentes.', colors: ['#353b36', '#535b53', '#758072', '#9ba493', '#c4c9b6', '#e3e3ce'] },
  silver: { name: 'Prata', shape: 'plate', description: 'Lâminas metálicas claras e veios prateados, com sombras frias.', colors: ['#38424f', '#5c6b7b', '#8397a7', '#b3c1ca', '#dce1e1', '#f2efe7'] },
  amethyst: { name: 'Ametista', shape: 'crystal', scale: [0.9, 0.85, 0.9], description: 'Grupos de cristais violetas, com pontas claras e bases escuras.', colors: ['#352743', '#57375f', '#80528d', '#aa7bb4', '#d1add5', '#eddaeb'] },
  ruby: { name: 'Rubi', shape: 'gem', scale: [1, 0.8, 0.9], description: 'Cristais compactos vermelhos com faces vinho e reflexos rosados.', colors: ['#422032', '#702a40', '#a1394d', '#cd5965', '#e99597', '#f5c5b6'] },
  emerald: { name: 'Esmeralda', shape: 'prism', description: 'Prismas verdes de topo achatado, com faces escuras e reflexos claros.', colors: ['#183e35', '#21634c', '#329068', '#5abb87', '#95d8ae', '#d5edcc'] },
  sapphire: { name: 'Safira', shape: 'gem', scale: [0.9, 1.1, 0.9], description: 'Cristais azuis com faces triangulares, sombras profundas e reflexos celestes.', colors: ['#202e50', '#304e7c', '#426fb0', '#6b9ad0', '#a2c7e6', '#d7e6ee'] },
};

// Richer fragment paint is independent of the veins painted on the stone.
const FRAGMENT_PALETTES: Partial<Record<OreKind, string[]>> = {
  iron: ['#151d2d', '#293248', '#46536a', '#728594', '#a8c4cc', '#e0f2ee'],
  mithril: ['#102d46', '#174b69', '#237796', '#46a9bc', '#8bdae0', '#e4fff1'],
  orichalcum: ['#351a3f', '#6b284c', '#a74853', '#d77963', '#f5b280', '#ffe1ae'],
  lead: ['#16172a', '#29283e', '#494356', '#726777', '#a798aa', '#d6c9d8'],
  coal: ['#0b111a', '#141e2a', '#26323c', '#3f4a53', '#5b6970', '#92a29f'],
  tin: ['#242c2d', '#404c45', '#687762', '#95a67f', '#cbd3a7', '#f1efcd'],
  silver: ['#1f233e', '#3c4565', '#6c80a0', '#a8c3d5', '#d9edf2', '#ffffff'],
  copper: ['#351e36', '#652d37', '#a44727', '#cd702b', '#eea447', '#ffda79'],
  gold: ['#3d2637', '#70402d', '#ac6922', '#d99b28', '#f6ca4e', '#fff1a1'],
  amethyst: ['#281c45', '#492565', '#70359d', '#9d51ca', '#c881ec', '#efd0ff'],
  emerald: ['#092f39', '#07554b', '#08765c', '#139e73', '#55cfa0', '#b0eed0'],
  ruby: ['#321c3c', '#642342', '#9b2648', '#c9415a', '#ed7b88', '#ffc5c4'],
  sapphire: ['#182347', '#20396d', '#2856a0', '#377ed0', '#72b2ef', '#c4e9ff'],
};

export function orePalette(kind: OreKind, painted = false) {
  const data = new Uint8Array(6 * 4);
  (painted ? FRAGMENT_PALETTES[kind] ?? ORE_STYLES[kind].colors : ORE_STYLES[kind].colors).forEach((hex, i) => {
    const c = new THREE.Color(hex).convertLinearToSRGB();
    data.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], i * 4);
  });
  const texture = new THREE.DataTexture(data, 6, 1);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

export function sparkleTexture() {
  const pixels = new Uint8Array(9 * 9 * 4);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const dx = Math.abs(x - 4), dy = Math.abs(y - 4);
    const centre = dx <= 1 && dy <= 1;
    const arm = dx === 0 || dy === 0;
    if (!centre && !arm) continue;
    const tip = Math.max(dx, dy) >= 3;
    pixels.set([255, tip ? 232 : 252, tip ? 179 : 237, 255], (y * 9 + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, 9, 9);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export const oreVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;
  varying float vPixelScale;
  attribute float oreHeight;
  void main() {
    vHeight = oreHeight;
    vLocalPos = position;
    vLocalNormal = normal;
    vPixelScale = length(modelMatrix[0].xyz);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
export const oreFragment = /* glsl */ `
  uniform sampler2D uOrePalette;
  uniform vec3 uLight;
  uniform float uDensity;
  uniform float uCopper;
  uniform float uSteps;
  uniform vec3 uShine;
  uniform float uCrystalPaint;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;
  varying float vPixelScale;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 cell = floor(vWorldPos * uDensity);
    float lighting = dot(n, normalize(uLight));
    float idx = floor(2.2 + lighting * 2.2);
    if (vHeight < 0.28) idx -= 1.0;
    if (vHeight < 0.12) idx = min(idx, 1.0);
    // Paint coherent bands in the fragment's own axes, at the existing pixel
    // size. No scattered confetti: the long highlight follows crystal growth.
    float resolution = max(1.0, uDensity * vPixelScale);
    vec3 paintedPos = (floor(vLocalPos * resolution) + 0.5) / resolution;
    vec3 localN = normalize(vLocalNormal);
    vec3 acrossFace = cross(vec3(0.0, 1.0, 0.0), localN);
    if (length(acrossFace) < 0.1) acrossFace = vec3(1.0, 0.0, 0.0);
    acrossFace = normalize(acrossFace);
    float stripe = dot(paintedPos, acrossFace) + 0.045;
    float stripeWidth = 0.045 + floor(vHeight * 5.0) * 0.008;
    if (uCrystalPaint > 0.5) {
      if (abs(stripe) < stripeWidth && vHeight > 0.3 && lighting > -0.15) idx = vHeight > 0.65 ? 5.0 : 4.0;
      else if (stripe < -stripeWidth && stripe > -stripeWidth - 0.055) idx -= 1.0;
      if (vHeight > 0.82 && lighting > 0.35) idx = max(idx, 4.0);
    } else {
      // Metal paint uses large light/shadow masses and a stepped bright edge,
      // rather than the stone-like speckling used by the original material.
      float pigment = hash(floor(paintedPos * 5.0));
      idx = floor(1.5 + lighting * 3.0);
      if (vHeight < 0.25) idx = min(idx, 1.0);
      if (vHeight > 0.5 && lighting > 0.2) idx = max(idx, 3.0);
      float brushEdge = 0.035 + floor(vHeight * 4.0) * 0.008;
      if (abs(stripe) < brushEdge && vHeight > 0.35 && lighting > 0.2) idx = vHeight > 0.85 && lighting > 0.55 ? 5.0 : 4.0;
      else if (stripe < -brushEdge && stripe > -brushEdge - 0.08) idx -= 1.0;
      if (pigment > 0.78 && vHeight > 0.55 && lighting > 0.35) idx = max(idx, 4.0);
    }
    vec3 color = texture2D(uOrePalette, vec2((clamp(idx, 0.0, uSteps - 1.0) + 0.5) / uSteps, 0.5)).rgb;
    if (uCopper > 0.5 && hash(floor(cell / 3.0) + 31.0) < 0.16) color = idx > 2.0 ? vec3(0.34, 0.53, 0.42) : vec3(0.18, 0.35, 0.3);
    // Sample reflections at pixel centres so highlights keep the same grid
    // as the texture, while moving naturally when the camera turns.
    vec3 pixelPos = (cell + 0.5) / uDensity;
    vec3 view = normalize(cameraPosition - pixelPos);
    vec3 light = normalize(uLight);
    vec3 halfway = normalize(light + view);
    float specular = pow(max(dot(n, halfway), 0.0), uShine.y);
    float reflection = step(0.12, specular) * 0.22
      + step(0.35, specular) * 0.33 + step(0.68, specular) * 0.45;
    float lit = smoothstep(-0.1, 0.35, dot(n, light));
    vec3 pale = texture2D(uOrePalette, vec2(5.5 / uSteps, 0.5)).rgb;
    vec3 shineColor = mix(pale, vec3(1.0, 0.99, 0.96), uShine.z);
    color = mix(color, shineColor, reflection * lit * uShine.x * 0.5);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function crystalGeometry(rnd: () => number, flatTop = false) {
  const sides = flatTop ? 6 : 5 + Math.floor(rnd() * 2), vertices: number[] = [];
  const rings: THREE.Vector3[][] = [[], []];
  const offset = rnd() * Math.PI;
  for (let i = 0; i < sides; i++) {
    const angle = offset + i / sides * Math.PI * 2;
    const radius = 0.24 + rnd() * 0.09;
    rings[0].push(new THREE.Vector3(Math.cos(angle) * radius, -0.22, Math.sin(angle) * radius));
    rings[1].push(new THREE.Vector3(Math.cos(angle) * radius * 0.85, flatTop ? 0.65 : 0.45 + rnd() * 0.17, Math.sin(angle) * radius * 0.85));
  }
  const tip = new THREE.Vector3((rnd() - 0.5) * 0.16, 0.85 + rnd() * 0.25, (rnd() - 0.5) * 0.16);
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    triangle(rings[0][i], rings[1][i], rings[1][j]);
    triangle(rings[0][i], rings[1][j], rings[0][j]);
    triangle(rings[1][i], flatTop ? new THREE.Vector3(0, 0.65, 0) : tip, rings[1][j]);
    triangle(rings[0][i], rings[0][j], new THREE.Vector3(0, -0.22, 0));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function mineralGeometry(kind: OreKind, rnd: () => number): THREE.BufferGeometry {
  const style = ORE_STYLES[kind];
  let geometry: THREE.BufferGeometry;
  if (style.shape === 'crystal' || style.shape === 'prism') geometry = crystalGeometry(rnd, style.shape === 'prism');
  else if (style.shape === 'gem') {
    geometry = new THREE.OctahedronGeometry(0.5, 0);
    geometry.scale(1, 0.9, 1); geometry.translate(0, 0.12, 0);
  } else if (style.shape === 'block') {
    geometry = new THREE.BoxGeometry(0.65, 0.4, 0.5).toNonIndexed();
    geometry.translate(0, 0.08, 0);
  } else {
    geometry = new THREE.DodecahedronGeometry(0.48, 0);
    geometry.scale(1, style.shape === 'plate' ? 0.25 : 0.62, 0.85);
    geometry.translate(0, 0.04, 0);
    if (style.shape === 'shard') {
      // One displacement per shared corner keeps the solid closed while
      // breaking up the regular polyhedron into chipped charcoal fragments.
      const positions = geometry.attributes.position;
      const factors = new Map<string, number>();
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i);
        const key = p.toArray().map(v => v.toFixed(5)).join(',');
        if (!factors.has(key)) factors.set(key, 0.7 + rnd() * 0.65);
        p.multiplyScalar(factors.get(key)!);
        positions.setXYZ(i, p.x, p.y, p.z);
      }
      geometry.computeVertexNormals();
    }
  }
  if (style.scale) geometry.scale(...style.scale);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const positions = geometry.attributes.position;
  const heights = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) heights[i] = (positions.getY(i) - bounds.min.y) / Math.max(0.001, bounds.max.y - bounds.min.y);
  geometry.setAttribute('oreHeight', new THREE.BufferAttribute(heights, 1));
  return geometry;
}

/** Separate seed stream: ore controls never change the underlying rock. */
export function addRockOre(asset: THREE.Group, config: TreeConfig, settings: RockConfig, stoneMaterial: THREE.ShaderMaterial) {
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  if (!settings.ore || (settings.oreCount ?? 6) <= 0) return { geometries, materials, textures };
  const kind = settings.ore;
  const shape = ORE_STYLES[kind].shape;
  const isCrystal = shape === 'crystal' || shape === 'prism';
  const count = THREE.MathUtils.clamp(Math.round(settings.oreCount ?? 6), 1, 24);
  const size = THREE.MathUtils.clamp(settings.oreSize ?? 0.3, 0.1, 0.8);
  let state = ((Math.floor(config.seed) * 43 + 9017) % 233280 + 233280) % 233280;
  const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const stones = asset.children.filter(o => o instanceof THREE.Mesh) as THREE.Mesh[];
  asset.updateWorldMatrix(true, true);
  const bounds = stones.map(stone => new THREE.Box3().setFromObject(stone));
  const deposits = new THREE.Group(); deposits.name = 'OreDeposits';
  const centers: THREE.Vector4[] = [], ray = new THREE.Raycaster();
  const patches: THREE.Vector4[] = [];
  const palette = orePalette(kind); textures.push(palette);
  const fragmentPalette = orePalette(kind, true); textures.push(fragmentPalette);
  const sparkleMap = kind === 'coal' ? undefined : sparkleTexture();
  if (sparkleMap) textures.push(sparkleMap);
  const material = new THREE.ShaderMaterial({
    vertexShader: oreVertex, fragmentShader: oreFragment,
    uniforms: {
      uOrePalette: { value: fragmentPalette }, uLight: stoneMaterial.uniforms.uTexLightDir,
      uCrystalPaint: { value: isCrystal || shape === 'gem' ? 1 : 0 },
      uDensity: { value: resolvePixelTextureParams(config).barkTexelsPerMetre * 2.8 },
      uCopper: { value: kind === 'copper' ? 1 : 0 },
      uSteps: { value: 6 },
      uShine: { value: new THREE.Vector3(
        kind === 'coal' ? 0.22 : kind === 'lead' ? 0.65 : 0.95,
        isCrystal || shape === 'gem' ? 24 : 12,
        isCrystal || shape === 'gem' ? 0.65 : 0.12,
      ) },
    },
  });
  materials.push(material);
  for (let attempt = 0; attempt < count * 100 && centers.length < count; attempt++) {
    const index = Math.floor(rnd() * stones.length), box = bounds[index];
    const middle = box.getCenter(new THREE.Vector3());
    const angle = attempt * 2.39996 + rnd() * 0.4;
    const direction = new THREE.Vector3(Math.cos(angle), 0.1 + rnd() * 0.9, Math.sin(angle)).normalize();
    const reach = box.getSize(new THREE.Vector3()).length() + 1;
    ray.set(middle.clone().addScaledVector(direction, reach), direction.clone().negate());
    ray.far = reach * 2;
    const hit = ray.intersectObjects(stones, false)[0];
    if (!hit?.face || hit.point.y < 0.08) continue;
    if (centers.some(c => new THREE.Vector3(c.x, c.y, c.z).distanceTo(hit.point) < size * 0.9)) continue;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const deposit = new THREE.Group(); deposit.name = `OreDeposit_${centers.length + 1}`;
    deposit.userData.surfacePoint = hit.point.clone(); deposit.userData.surfaceNormal = normal.clone();
    deposit.userData.oreKind = kind;
    const across = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    if (across.lengthSq() < 0.001) across.set(1, 0, 0);
    const along = normal.clone().cross(across).normalize();
    const pieces = 3 + Math.floor(rnd() * 3);
    for (let piece = 0; piece < pieces; piece++) {
      const target = hit.point.clone().addScaledVector(across, (piece - (pieces - 1) / 2) * size * 0.65)
        .addScaledVector(along, (rnd() - 0.5) * size * 0.7);
      ray.set(target.clone().addScaledVector(normal, size * 3 + 0.5), normal.clone().negate());
      ray.far = size * 6 + 1;
      const chipHit = ray.intersectObjects(stones, false)[0];
      if (!chipHit?.face || chipHit.point.y < 0.04) continue;
      const chipNormal = chipHit.face.normal.clone().transformDirection(chipHit.object.matrixWorld);
      const geometry = mineralGeometry(kind, rnd);
      geometries.push(geometry);
      const chip = new THREE.Mesh(geometry, material);
      chip.name = `Ore_${kind}_${centers.length + 1}_${piece + 1}`;
      chip.position.copy(chipHit.point).addScaledVector(chipNormal, isCrystal ? 0 : -size * 0.04);
      chip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), chipNormal);
      chip.rotateY(rnd() * Math.PI * 2);
      if (isCrystal) chip.rotateX((rnd() - 0.5) * 0.4);
      chip.scale.setScalar(size * (0.75 + rnd() * 0.55));
      // One halo at each fragment's actual contact point. Use a separate
      // deterministic variation without consuming the geometry seed stream.
      const patchVariation = 0.9 + Math.abs(Math.sin(config.seed * 0.37 + patches.length * 2.17)) * 0.2;
      patches.push(new THREE.Vector4(chipHit.point.x, chipHit.point.y, chipHit.point.z, chip.scale.x * 0.72 * patchVariation));
      chip.castShadow = true; chip.receiveShadow = true;
      // At most three small, camera-facing crosses. Ordinary depth testing
      // hides reflections on the far side of the rock.
      if (sparkleMap && piece === 0 && centers.length % 2 === 0 && centers.length < 6) {
        const sparkMaterial = new THREE.SpriteMaterial({
          map: sparkleMap, transparent: true, depthWrite: false,
          opacity: 0, toneMapped: false,
        });
        materials.push(sparkMaterial);
        const spark = new THREE.Sprite(sparkMaterial);
        spark.name = 'OrePixelSparkle';
        spark.userData.excludeFromOBJ = true;
        const vertices = geometry.attributes.position;
        const normals = geometry.attributes.normal;
        let best = 0, bestLight = -Infinity;
        const light = stoneMaterial.uniforms.uTexLightDir.value.clone().normalize();
        for (let v = 0; v < vertices.count; v++) {
          const worldNormal = new THREE.Vector3().fromBufferAttribute(normals, v).applyQuaternion(chip.quaternion);
          const score = worldNormal.dot(light);
          if (score > bestLight) { bestLight = score; best = v; }
        }
        const faceNormal = new THREE.Vector3().fromBufferAttribute(normals, best).normalize();
        spark.position.fromBufferAttribute(vertices, best).addScaledVector(faceNormal, 0.035);
        spark.scale.setScalar(isCrystal || shape === 'gem' ? 0.65 : 0.48);
        const phase = centers.length * 1.7 + config.seed * 0.013;
        const worldPoint = new THREE.Vector3(), worldNormal = new THREE.Vector3();
        const cameraPoint = new THREE.Vector3(), halfway = new THREE.Vector3(), viewDirection = new THREE.Vector3();
        const candidates: { point: THREE.Vector3; normal: THREE.Vector3 }[] = [];
        for (let v = 0; v < vertices.count; v += 3) {
          const point = new THREE.Vector3();
          for (let corner = 0; corner < 3; corner++) point.add(new THREE.Vector3().fromBufferAttribute(vertices, v + corner));
          candidates.push({ point: point.multiplyScalar(1 / 3), normal: new THREE.Vector3().fromBufferAttribute(normals, v).normalize() });
        }
        spark.onBeforeRender = (_renderer, _scene, camera) => {
          spark.getWorldPosition(worldPoint);
          camera.getWorldPosition(cameraPoint);
          worldNormal.copy(faceNormal).transformDirection(chip.matrixWorld);
          viewDirection.copy(cameraPoint).sub(worldPoint).normalize();
          halfway.copy(viewDirection).add(light).normalize();
          let brightest = -Infinity;
          for (const candidate of candidates) {
            worldNormal.copy(candidate.normal).transformDirection(chip.matrixWorld);
            const facing = worldNormal.dot(viewDirection);
            if (facing < 0.01) continue;
            // Prefer the camera-facing surface so the cross remains readable
            // around the object, instead of clinging to a side lit face.
            const score = facing * 0.8 + worldNormal.dot(halfway) * 0.2;
            if (score > brightest) {
              brightest = score;
              faceNormal.copy(candidate.normal);
              spark.position.copy(candidate.point).addScaledVector(faceNormal, 0.06);
            }
          }
          spark.updateMatrixWorld(true);
          worldNormal.copy(faceNormal).transformDirection(chip.matrixWorld);
          // Keep a readable glint across visible faces; the best reflection
          // angle strengthens it instead of acting as a narrow on/off gate.
          const alignment = brightest === -Infinity ? 0 : 0.9 + 0.1 * THREE.MathUtils.smoothstep(worldNormal.dot(halfway), -0.2, 0.7);
          const pulse = Math.pow(Math.max(0, Math.sin(performance.now() * 0.0016 + phase)), 4);
          sparkMaterial.opacity = alignment * pulse * (kind === 'lead' ? 0.45 : isCrystal || shape === 'gem' ? 1 : 0.8);
        };
        chip.add(spark);
      }
      deposit.add(chip);
    }
    deposits.add(deposit);
    centers.push(new THREE.Vector4(hit.point.x, hit.point.y, hit.point.z, size * 1.3));
  }
  asset.add(deposits);
  const actualCount = centers.length;
  while (centers.length < 24) centers.push(new THREE.Vector4());
  stoneMaterial.uniforms.uOrePalette = { value: palette };
  stoneMaterial.uniforms.uOreCenters = { value: centers };
  stoneMaterial.uniforms.uOreCount = { value: actualCount };
  stoneMaterial.uniforms.uOrePatchCount = { value: patches.length };
  while (patches.length < 120) patches.push(new THREE.Vector4());
  stoneMaterial.uniforms.uOrePatches = { value: patches };
  stoneMaterial.uniforms.uOreCopper = { value: kind === 'copper' ? 1 : 0 };
  stoneMaterial.fragmentShader = `uniform sampler2D uOrePalette;\nuniform vec4 uOrePatches[120];\nuniform int uOrePatchCount;\nuniform float uOreCopper;\n` + stoneMaterial.fragmentShader;
  // Paint small connected veins on the same grid as moss and snow. Existing
  // snow is applied afterwards, so buried mineral does not glow through it.
  stoneMaterial.fragmentShader = stoneMaterial.fragmentShader.replace('vec3 exposedColor = color;', /* glsl */ `
    float oreDistance = 1000.0;
    vec3 oreWorld = surfaceP / uTexelsPerMetre;
    for (int i = 0; i < 120; i++) {
      if (i >= uOrePatchCount) break;
      vec3 offset = (oreWorld - uOrePatches[i].xyz) / max(0.01, uOrePatches[i].w);
      float radiusDistance = length(offset);
      if (radiusDistance - 0.15 > oreDistance + 0.22) continue;
      float edge = mnoise3(offset * 2.8 + float(i) * 13.7 + 219.0);
      float patchDistance = radiusDistance + (edge - 0.5) * 0.3;
      // A small smooth union joins nearby halos without filling the whole group.
      float join = max(0.22 - abs(oreDistance - patchDistance), 0.0) / 0.22;
      oreDistance = min(oreDistance, patchDistance) - join * join * 0.055;
    }
    float vein = mnoise3(surfaceP / 4.0 + 209.0);
    if (oreDistance < 0.8 + vein * 0.3 && (oreDistance < 0.5 || vein < 0.78)) {
      float oi = clamp(floor(2.6 + dot(surfaceN, normalize(uTexLightDir)) * 1.6 + (vein - 0.5) * 2.0), 0.0, 5.0);
      if (oreDistance > 0.8) oi = max(0.0, oi - 1.0);
      color = texture2D(uOrePalette, vec2((oi + 0.5) / 6.0, 0.5)).rgb;
      if (uOreCopper > 0.5 && mnoise3(surfaceP / 3.0 + 233.0) < 0.28) color = oi > 2.0 ? vec3(0.34, 0.53, 0.42) : vec3(0.18, 0.35, 0.3);
    }
    vec3 exposedColor = color;
  `);
  stoneMaterial.needsUpdate = true;
  return { geometries, materials, textures };
}
