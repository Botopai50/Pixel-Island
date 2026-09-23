import * as THREE from 'three';

export interface WaterPreset {
  id?: string;
  name: string;
  waterDeepColor: string;
  waterShallowColor: string;
  foamColor: string;
  crestColor: string;
  skyColor?: string;
  groundColor?: string;
  brickColor?: string;
  fogColor?: string;
  sunColor?: string;
  waterOpacity: number;
  foamAmount: number;
  foamDistance: number;
}

export const WATER_PRESETS: Record<string, WaterPreset> = {
  classic: {
    id: 'classic',
    name: 'Pixel Oasis (Original)',
    waterDeepColor: '#0284c7', // Deep vibrant azure (Pixel Oasis)
    waterShallowColor: '#00d2ff', // Electric bright cyan
    foamColor: '#ffffff', // Shoreline contact white
    crestColor: '#bbf2f6', // Wave crest cyan white
    skyColor: '#38bdf8', // Sunny pixel sky
    groundColor: '#48bb78', // Pixel grass green
    brickColor: '#9c674e', // Terracotta stone brick
    fogColor: '#7dd3fc',
    sunColor: '#fffbeb',
    waterOpacity: 0.92,
    foamAmount: 0.65,
    foamDistance: 0.052,
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset Lagoon',
    waterDeepColor: '#6d28d9', // Deep violet
    waterShallowColor: '#f43f5e', // Radiant rose/coral
    foamColor: '#fcd5b5', // Golden soft peach foam
    crestColor: '#fbbf24', // Golden amber crest
    skyColor: '#fb923c', // Warm orange sunset sky
    groundColor: '#65a30d', // Warm olive green
    brickColor: '#78350f', // Dark amber brick
    fogColor: '#fda4af',
    sunColor: '#fef08a',
    waterOpacity: 0.94,
    foamAmount: 0.65,
    foamDistance: 0.052,
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Bioluminescent',
    waterDeepColor: '#0f172a', // Abyss navy
    waterShallowColor: '#06b6d4', // Bioluminescent cyan
    foamColor: '#99f6e4', // Soft bioluminescent pale mint foam
    crestColor: '#38bdf8', // Cyan glints
    skyColor: '#090d16', // Starry night sky
    groundColor: '#1e293b', // Dark slate terrain
    brickColor: '#334155', // Charcoal slate stone
    fogColor: '#0f172a',
    sunColor: '#38bdf8',
    waterOpacity: 0.95,
    foamAmount: 0.65,
    foamDistance: 0.052,
  },
  toxic: {
    id: 'toxic',
    name: 'Toxic Slime Pool',
    waterDeepColor: '#15803d', // Dark toxic emerald
    waterShallowColor: '#22c55e', // Radioactive bright green
    foamColor: '#fef08a', // Acidic soft yellow foam
    crestColor: '#a3e635', // Lime neon crest
    skyColor: '#14532d', // Sickly green sky
    groundColor: '#3f3f46', // Ash grey terrain
    brickColor: '#52525b', // Industrial concrete
    fogColor: '#166534',
    sunColor: '#facc15',
    waterOpacity: 0.96,
    foamAmount: 0.65,
    foamDistance: 0.052,
  },
  magma: {
    name: 'Volcanic Magma',
    waterDeepColor: '#7f1d1d', // Dark volcanic red
    waterShallowColor: '#ea580c', // Fiery glowing orange
    foamColor: '#fde047', // Searing soft yellow crust
    crestColor: '#fbbf24', // Lava bubbles
    waterOpacity: 0.98,
    foamAmount: 0.70,
    foamDistance: 0.052,
  },
  crystal: {
    name: 'Glacial Crystal',
    waterDeepColor: '#0369a1', // Deep ice blue
    waterShallowColor: '#7dd3fc', // Frost crystal pale cyan
    foamColor: '#cbeafe', // Pure frost soft cyan-white
    crestColor: '#60a5fa', // Ice glint
    waterOpacity: 0.92,
    foamAmount: 0.60,
    foamDistance: 0.052,
  },
};

export const WaterShader = {
  uniforms: {
    uTime: { value: 0 },
    uDeepColor: { value: new THREE.Color('#0284c7') },
    uShallowColor: { value: new THREE.Color('#00d2ff') },
    uFoamColor: { value: new THREE.Color('#ffffff') }, // Shoreline contact pure white & foam source
    uCrestColor: { value: new THREE.Color('#bbf2f6') }, // Wave crest cyan white
    uWaveHeight: { value: 0.16 },
    uWaveFrequency: { value: 1.2 },
    uWaveSpeed: { value: 1.2 },
    uFoamAmount: { value: 0.65 },
    uFlowSpeed: { value: 0.8 },
    uWindAngle: { value: 0.785 }, // 45 degrees
    uOpacity: { value: 0.92 },
    // Depth-based intersection foam uniforms
    tDepth: { value: null as THREE.Texture | null },
    tPlanarReflection: { value: null as THREE.Texture | null },
    uReflectTextureMatrix: { value: new THREE.Matrix4() },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 2500.0 },
    uIsOrthographic: { value: 1.0 }, // 1.0 = orthographic observer, 0.0 = perspective first-person
    uResolution: { value: new THREE.Vector2(320, 240) },
    uFoamDistance: { value: 0.052 },
    uBiomeColorEnabled: { value: 1.0 },
    // Pixels por metro da grade pixel-art da água: igual à densidade de texels do terreno
    uTexelDensity: { value: 6.0 },
    // Mapa de tons por bioma (ver WaterBiomeMap): atribuído pelo WorldEngine
    uBiomeMap: { value: null as THREE.Texture | null },
    uBiomeMapOrigin: { value: new THREE.Vector2(0, 0) },
    uBiomeMapSpan: { value: 1.0 },
    uBiomeMapReady: { value: 0.0 },
    // Ripple array: [x, z, radius, strength]
    uRipples: { value: new Float32Array(8 * 4) },
    uActiveRipples: { value: 0 },
    // Light direction
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
  },

  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uWaveHeight;
    uniform float uWaveFrequency;
    uniform float uWaveSpeed;
    uniform vec4 uRipples[8];
    uniform int uActiveRipples;
    uniform mat4 uReflectTextureMatrix;
    uniform sampler2D uBiomeMap;
    uniform vec2 uBiomeMapOrigin;
    uniform float uBiomeMapSpan;
    uniform float uBiomeMapReady;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying float vWaveHeight;
    varying float vRippleOffset;
    varying vec4 vReflectCoord;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // When the water mesh has rotation.x = -Math.PI / 2:
      // pos.x is X, pos.y is -Z, and pos.z is world Y (height).
      // We calculate worldCoord using the model translation so waves remain anchored in world space:
      vec2 worldCoord = vec2(pos.x + modelMatrix[3][0], -pos.y + modelMatrix[3][2]);

      // Base wave displacement
      float t = uTime * uWaveSpeed;
      float freq = uWaveFrequency;
      
      float wave1 = sin(worldCoord.x * freq * 0.8 + worldCoord.y * freq * 0.6 + t) * 0.5;
      float wave2 = cos(worldCoord.x * freq * 1.2 - worldCoord.y * freq * 0.9 + t * 1.3) * 0.3;
      float wave3 = sin((worldCoord.x + worldCoord.y) * freq * 2.0 + t * 0.7) * 0.2;
      
      float totalWave = (wave1 + wave2 + wave3);

      // Interactive ripples with compact displacement
      float rippleDisp = 0.0;
      vec2 rippleGrad = vec2(0.0);
      for (int i = 0; i < 8; i++) {
        if (i >= uActiveRipples) break;
        vec4 rip = uRipples[i];
        vec2 ripPos = rip.xy;
        float ripRad = rip.z;
        float ripStr = rip.w;
        
        float dist = length(worldCoord - ripPos);
        float ringDist = abs(dist - ripRad);
        
        if (ringDist < 0.45 && dist < ripRad + 0.45 && ripRad < 2.8) {
          float ring = cos(ringDist * 7.5) * exp(-ringDist * 3.5) * ripStr;
          rippleDisp += ring * 0.25;
          vec2 dir = (dist > 0.01) ? (worldCoord - ripPos) / dist : vec2(0.0);
          rippleGrad += dir * ring * ripStr;
        }
      }

      // Deslocamento físico vertical controlado: atenua suavemente para 0 antes da transição aos anéis externos
      float distFromCenter = length(pos.xy);
      float waveDispFade = 1.0 - smoothstep(400.0, 500.0, distFromCenter);

      // Água rasa quase não sobe e desce: a onda cresce de 0 na linha da costa até o tamanho cheio
      // por volta de 3.5m de profundidade (canal A do mapa = profundidade / 6m). Sem isso, numa praia
      // suave a linha d'água andava 1-2m para frente e para trás.
      vec2 depthUv = (worldCoord - uBiomeMapOrigin) / uBiomeMapSpan;
      float seabedDepth = texture2D(uBiomeMap, clamp(depthUv, 0.0, 1.0)).a;
      float insideMap = step(0.0, depthUv.x) * step(depthUv.x, 1.0) * step(0.0, depthUv.y) * step(depthUv.y, 1.0);
      waveDispFade *= mix(1.0, smoothstep(0.03, 0.58, seabedDepth), insideMap * uBiomeMapReady);
      pos.z += (totalWave * min(uWaveHeight, 0.065) + rippleDisp) * waveDispFade;
      
      // Passa a altura de onda real para cálculo dos contrastes cel-shaded e agrupamento de espuma nas cristas
      vWaveHeight = totalWave * uWaveHeight;
      vRippleOffset = rippleDisp;

      vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
      vWorldPosition = worldPosition.xyz;
      vReflectCoord = uReflectTextureMatrix * worldPosition;
      
      // Calculate normal estimation including ripple waves
      float eps = 0.05;
      float dx = sin((worldCoord.x + eps) * freq + t) * uWaveHeight - sin((worldCoord.x - eps) * freq + t) * uWaveHeight - rippleGrad.x * 0.4;
      float dy = cos((worldCoord.y + eps) * freq + t) * uWaveHeight - cos((worldCoord.y - eps) * freq + t) * uWaveHeight - rippleGrad.y * 0.4;
      vNormal = normalize(mat3(modelMatrix) * vec3(-dx, -dy, 1.0));

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uFoamColor;
    uniform vec3 uCrestColor;
    uniform float uWaveHeight;
    uniform float uWaveFrequency;
    uniform float uWaveSpeed;
    uniform float uFoamAmount;
    uniform float uFlowSpeed;
    uniform float uWindAngle;
    uniform float uOpacity;
    uniform vec3 uLightDir;

    // Depth & Planar Reflection Uniforms
    uniform sampler2D tDepth;
    uniform sampler2D tPlanarReflection;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uIsOrthographic;
    uniform vec2 uResolution;
    uniform float uFoamDistance;
    uniform float uBiomeColorEnabled;
    uniform float uTexelDensity;
    uniform sampler2D uBiomeMap;
    uniform vec2 uBiomeMapOrigin;
    uniform float uBiomeMapSpan;
    uniform float uBiomeMapReady;
    uniform vec4 uRipples[8];
    uniform int uActiveRipples;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying float vWaveHeight;
    varying float vRippleOffset;
    varying vec4 vReflectCoord;

    // Linearize Depth from depth buffer (dual camera: Perspective & Orthographic)
    float getLinearDepth(float depth, float near, float far) {
      if (uIsOrthographic > 0.5) {
        return near + depth * (far - near);
      } else {
        float z = depth * 2.0 - 1.0;
        return (2.0 * near * far) / max(far + near - z * (far - near), 0.00001);
      }
    }

    // 2D Cellular Voronoi Noise for stylized pixel foam
    vec2 hash2(vec2 p) {
      return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
    }

    float voronoi(vec2 x) {
      vec2 n = floor(x);
      vec2 f = fract(x);
      float m = 8.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 o = hash2(n + g);
          vec2 r = g + o - f;
          float d = dot(r, r);
          m = min(m, d);
        }
      }
      return sqrt(m);
    }

    void main() {
      // 1. Amostragem contínua de profundidade (Pixel-perfect por fragmento)
      // Erradica 100% de trepidação, oscilação de blocos e tremilique nas bordas ao andar
      vec2 screenUv = gl_FragCoord.xy / uResolution;
      float sceneDepthRaw = texture2D(tDepth, screenUv).r;
      float sceneLinear = getLinearDepth(sceneDepthRaw, uCameraNear, uCameraFar);
      float waterLinear = getLinearDepth(gl_FragCoord.z, uCameraNear, uCameraFar);
      float depthDifference = sceneLinear - waterLinear;

      // Direção do olhar para compensação angular de profundidade vertical e reflexos
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float viewCos = (uIsOrthographic > 0.5) ? 0.707 : clamp(viewDir.y, 0.18, 1.0);
      float verticalDepth = depthDifference * viewCos;

      // Descarte estrito: se o relevo/areia está acima da água, descarta imediatamente
      if (verticalDepth < -0.002) {
        discard;
      }

      // 2. Natural Intrinsic Pixel-Art Grid Quantization
      // Stepped frame rate (12 fps retro pixel animation)
      float animTime = floor(uTime * 12.0) / 12.0;
      
      // Grade pixel-art em espaço de mundo com a MESMA densidade do terreno: o pixel da água
      // tem o mesmo tamanho do texel do chão ao lado, em qualquer modo de câmera.
      float pixelDensity = uTexelDensity;
      vec2 worldGrid = floor(vWorldPosition.xz * pixelDensity) / pixelDensity;

      // Contorno em degraus pixel-art ESTÁVEL ancorado no espaço de mundo
      vec2 hashCoord = worldGrid * 0.3183 + vec2(0.123, 0.456);
      vec2 hashFract = fract(hashCoord * vec2(15.7, 37.1));
      float staticWobble = fract((hashFract.x + hashFract.y) * 43.17);
      float pixelWobble = (floor(staticWobble * 4.0) / 4.0 - 0.5) * (uFoamDistance * 0.35);
      float foamLimit = uFoamDistance + pixelWobble;
      
      // Espuma de contato colada na orla com borda anti-jitter estabilizada (fina e estilizada)
      float transWidth = min(uFoamDistance * 0.35, 0.012);
      float isContactFoam = smoothstep(foamLimit, foamLimit - transWidth, verticalDepth);

      // Movimento dinâmico intensificado da ESPUMA DE DENTRO (fluxo ágil + vaivém de surf + turbulência de vórtices):
      vec2 waveSurge = vec2(cos(uWindAngle), sin(uWindAngle)) * (sin(animTime * 2.2) * 0.55 + cos(animTime * 1.1) * 0.28);
      
      // A espuma usa uma grade própria de no máximo 8 px/m: com pixels menores as células viram
      // pontinhos finos que somem visualmente (principalmente de longe) e parece haver menos
      // espuma. Assim ela mantém a leitura em blocos enquanto a superfície segue o chão.
      float foamDensity = min(uTexelDensity, 8.0);
      vec2 foamGrid = floor(vWorldPosition.xz * foamDensity) / foamDensity;

      // Noise coordinates adapted for camera mode:
      vec2 noiseCoord = (uIsOrthographic > 0.5) ? (foamGrid * 0.18) : (foamGrid * 0.95);
      
      // Vórtices e turbulência ativa que deformam, esticam e recombinam as células de dentro continuamente
      vec2 warp1 = vec2(sin(noiseCoord.y * 1.6 + animTime * 1.8) * 0.32, cos(noiseCoord.x * 1.6 + animTime * 1.4) * 0.32);
      vec2 warp2 = vec2(cos(noiseCoord.x * 2.1 - animTime * 2.0) * 0.26, sin(noiseCoord.y * 2.1 + animTime * 1.6) * 0.26);

      // Camada 1 de dentro: Deriva ágil com vaivém de ondas e turbulência viva
      vec2 flowDir1 = vec2(cos(uWindAngle), sin(uWindAngle)) * (animTime * 0.85) + waveSurge + warp1;
      // Camada 2 de dentro: Cruzamento em contracorrente para evolução celular orgânica
      vec2 flowDir2 = vec2(cos(uWindAngle + 0.92), sin(uWindAngle + 0.92)) * (animTime * 0.68) - waveSurge * 0.70 + warp2;

      vec2 sampleUv1 = noiseCoord + flowDir1;
      vec2 sampleUv2 = noiseCoord * 1.8 - flowDir2 + vec2(4.5, 2.1);
      
      // Multi-layer Stepped voronoi foam patterns da espuma de dentro em movimento vivo
      float v1 = voronoi(sampleUv1);
      float v2 = voronoi(sampleUv2);
      float vCombined = floor((v1 * 0.55 + v2 * 0.45) * 8.0) / 8.0; // 8 discrete quantized levels

      // 3. Avaliação analítica e exata das ondas em worldGrid:
      // Elimina 100% das arestas triangulares da malha 3D e substitui diferenças finitas por derivadas exatas
      float waveT = animTime * uWaveSpeed;
      float waveFreq = (uIsOrthographic > 0.5) ? (uWaveFrequency * 0.35) : uWaveFrequency;
      vec2 wavePos = worldGrid;

      float a1 = wavePos.x * waveFreq * 0.8 + wavePos.y * waveFreq * 0.6 + waveT;
      float a2 = wavePos.x * waveFreq * 1.2 - wavePos.y * waveFreq * 0.9 + waveT * 1.3;
      float a3 = (wavePos.x + wavePos.y) * waveFreq * 2.0 + waveT * 0.7;

      float s1 = sin(a1); float c1 = cos(a1);
      float s2 = sin(a2); float c2 = cos(a2);
      float s3 = sin(a3); float c3 = cos(a3);

      float w1 = s1 * 0.5;
      float w2 = c2 * 0.3;
      float w3 = s3 * 0.2;
      float fragWaveH = (w1 + w2 + w3) * uWaveHeight;

      // Derivadas analíticas exatas da superfície da onda
      float dhdx = (c1 * 0.4 - s2 * 0.36 + c3 * 0.4) * waveFreq * uWaveHeight;
      float dhdz = (c1 * 0.3 + s2 * 0.27 + c3 * 0.4) * waveFreq * uWaveHeight;
      vec3 fragNormal = normalize(vec3(-dhdx * 1.5, 1.0, -dhdz * 1.5));

      // Sistema de espuma estilizada multicamadas (Fiel à referência media_1789951390077.png):
      // - Transição suave com transparência progressiva (sem cortes duros/secos)
      // - A parte mais clara da espuma (branco) concentrada em MENOR quantidade (apenas cristas e topos)
      // - Corpo principal da espuma suave e translúcido (ciano/azul-céu pastel suave)
      float depthFadeStart = (uIsOrthographic > 0.5) ? 0.08 : 0.12;
      float depthFadeEnd = (uIsOrthographic > 0.5) ? 1.60 : 2.50;
      float coastalGrad = 1.0 - smoothstep(depthFadeStart, depthFadeEnd, verticalDepth);

      // 1. Corpo de espuma suave: cobre uma rede orgânica celular e dissipa com transparência suave
      float baseSoftThresh = (uIsOrthographic > 0.5) ? 0.52 : 0.44;
      // O threshold varia suavemente de modo que as células não sumam repentinamente, mas se espalhem com transparência
      float softFoamThresh = baseSoftThresh + (1.0 - coastalGrad) * 0.22;
      float softFoamMask = step(softFoamThresh, vCombined);

      // 2. A PARTE MAIS CLARA DA ESPUMA (Branco em MENOR quantidade, fiel à imagem de referência):
      // Restrita estritamente aos picos mais elevados de vCombined e às filigranas de crista de v2
      float whitePeakThresh = (uIsOrthographic > 0.5) ? 0.72 : 0.68;
      float whitePeakMask = step(whitePeakThresh + (1.0 - coastalGrad) * 0.18, vCombined);
      float crestGlints = step(0.78 + (1.0 - coastalGrad) * 0.20, v2);
      float whiteHighlightMask = max(whitePeakMask, crestGlints) * softFoamMask;

      // Quantized lighting and color bands (Cel-Shaded / Indexed Color Bands)
      float diffuse = max(dot(fragNormal, uLightDir), 0.0);
      diffuse = floor(diffuse * 4.0) / 4.0; // 4 discrete lighting levels
      
      // 3. Tons por bioma lidos do mapa calculado na CPU com o clima REAL do BiomeManager
      // (R = ártico, G = manguezal, B = tropical). Fora da área coberta, volta ao temperado.
      vec2 biomeUv = (vWorldPosition.xz - uBiomeMapOrigin) / uBiomeMapSpan;
      vec2 edgeDist = min(biomeUv, 1.0 - biomeUv);
      float mapCoverage = uBiomeMapReady * smoothstep(0.0, 0.05, min(edgeDist.x, edgeDist.y));
      vec3 biomeTints = texture2D(uBiomeMap, clamp(biomeUv, 0.0, 1.0)).rgb * mapCoverage;

      // Paletas cromáticas estilizadas por bioma (Raso, Profundo, Abissal):
      // 1. Tropical / Lagoa Costeira (turquesa caribenho, menos saturado que o ciano elétrico)
      vec3 tropShallow = vec3(0.10, 0.86, 0.90);
      vec3 tropDeep    = vec3(0.02, 0.52, 0.80);
      vec3 tropAbyss   = vec3(0.01, 0.20, 0.42);

      // 2. Manguezal / Pântano Estuarino: verde-água turvo (o esmeralda neon anterior parecia tinta)
      vec3 swampShallow = vec3(0.32, 0.66, 0.56);
      vec3 swampDeep    = vec3(0.12, 0.42, 0.36);
      vec3 swampAbyss   = vec3(0.03, 0.17, 0.15);

      // 3. Tundra Polar / Ártico / Lago Glacial (Azul-gelo vítreo cristalino gélido)
      vec3 arcticShallow = vec3(0.62, 0.90, 1.00); // #9ee6ff (azul-gelo luminoso vítreo)
      vec3 arcticDeep    = vec3(0.12, 0.50, 0.80); // #1f80cc (azul glacial polar profundo)
      vec3 arcticAbyss   = vec3(0.03, 0.18, 0.34); // #082e57 (abismo glacial polar frio)

      // 4. Floresta Temperada & Lagos Interiores (Azul límpido de montanha / água doce fresca)
      vec3 tempShallow = vec3(0.18, 0.78, 0.98); // #2ec7fa (azul céu fresco de lago de montanha)
      vec3 tempDeep    = vec3(0.02, 0.42, 0.70); // #056bb3 (azul profundo de água doce)
      vec3 tempAbyss   = vec3(0.01, 0.16, 0.35); // #032959 (abismo lacustre escuro)

      float tArctic = biomeTints.r;
      float tSwamp = biomeTints.g;
      float tTropical = biomeTints.b;

      // Interpolação suave e contínua dos biomas
      vec3 biomeShallow = tempShallow;
      vec3 biomeDeep    = tempDeep;
      vec3 biomeAbyss   = tempAbyss;

      // Mistura Tropical
      biomeShallow = mix(biomeShallow, tropShallow, tTropical);
      biomeDeep    = mix(biomeDeep, tropDeep, tTropical);
      biomeAbyss   = mix(biomeAbyss, tropAbyss, tTropical);

      // Mistura Manguezal / Pântano (Verde esmeralda/jade dominante onde presente)
      biomeShallow = mix(biomeShallow, swampShallow, tSwamp);
      biomeDeep    = mix(biomeDeep, swampDeep, tSwamp);
      biomeAbyss   = mix(biomeAbyss, swampAbyss, tSwamp);

      // Mistura Glacial / Ártica (Azul-gelo cristalino no norte)
      biomeShallow = mix(biomeShallow, arcticShallow, tArctic);
      biomeDeep    = mix(biomeDeep, arcticDeep, tArctic);
      biomeAbyss   = mix(biomeAbyss, arcticAbyss, tArctic);

      // Permite fallback/modulação pelos uniforms caso preset especial de fantasia esteja ativo
      vec3 activeShallow = mix(uShallowColor, biomeShallow, uBiomeColorEnabled);
      vec3 activeDeep    = mix(uDeepColor, biomeDeep, uBiomeColorEnabled);
      vec3 activeAbyss   = mix(uDeepColor * 0.35, biomeAbyss, uBiomeColorEnabled);

      // 4. Estratificação e Escurecimento Progressivo em Partes Mais Fundas (Lagos & Mares)
      // Águas rasas na beira (0m a 1.5m): luz solar atravessa com translucidez cristalina
      float shallowRamp = clamp(1.0 - verticalDepth / 1.5, 0.0, 1.0);
      
      // Transição para profundidade média do corpo d'água (0.4m a 2.5m)
      float deepRamp = smoothstep(0.4, 2.5, verticalDepth);
      
      // Escurecimento expressivo em partes profundas do lago / mar (2.0m a 6.5m+)
      // No centro do lago e nas fossas marinhas, a luz é absorvida e a água escurece nitidamente
      float abyssRamp = smoothstep(2.0, 6.5, verticalDepth);

      // Composição estratificada de cores por profundidade
      vec3 depthColor = mix(activeShallow, activeDeep, deepRamp);
      depthColor = mix(depthColor, activeAbyss, abyssRamp);

      // Absorção progressiva cel-shaded de luz nas partes mais fundas:
      // Reduz a luminosidade base em até 45% nas profundezas, criando claro contraste entre a orla e o centro fundo
      float depthAbsorption = 1.0 - abyssRamp * 0.45;
      depthColor *= depthAbsorption;

      // Modulação de ondas estilizadas cel-shaded
      float waveBand = floor((0.60 + fragWaveH * 1.1 + shallowRamp * 0.40) * 6.0) / 6.0;
      waveBand = clamp(waveBand, 0.0, 1.0);
      vec3 waterBase = depthColor * (0.84 + waveBand * 0.18 + diffuse * 0.18);

      vec3 finalColor = waterBase;

      vec3 halfDir = normalize(uLightDir + viewDir);

      // True Planar Pixel Reflection (Physically authentic inverted reflection at ALL camera angles)
      vec2 reflectUv = (vReflectCoord.xy / max(vReflectCoord.w, 0.0001));
      
      // Retro pixel-art wave displacement (normal contínua + deslocamento celular estável para erradicar flicadas ao caminhar)
      vec2 waveWobble = fragNormal.xz * 0.024 + vec2(
        (floor(v1 * 6.0) / 6.0 - 0.5) * 0.014,
        (floor(v2 * 6.0) / 6.0 - 0.5) * 0.014
      );
      
      vec2 finalReflectUv = clamp(reflectUv + waveWobble, 0.001, 0.999);
      vec3 sampledReflectColor = texture2D(tPlanarReflection, finalReflectUv).rgb;
      
      // Fresnel curve estilizada: reflexão sutil quando olhado de cima (permitindo ver a cor da água perfeitamente)
      // e elegante aumento rasante para o horizonte
      float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 1.8);
      float reflStrength = clamp(0.08 + fresnel * 0.32, 0.0, 0.40);
      
      // Blend planar reflection into water
      finalColor = mix(finalColor, sampledReflectColor, reflStrength);

      // Sun Specular Highlight: Secondary circular highlight + White faceted specular sparkles concentrated at core
      // 1. Secondary specular highlight band (smoothstep suave cel-shaded sem corte circular rígido)
      float baseNdotH = max(dot(fragNormal, halfDir), 0.0);
      float baseSpec = pow(baseNdotH, 56.0);
      float secondaryCircle = smoothstep(0.55, 0.80, baseSpec);
      if (secondaryCircle > 0.01) {
        finalColor = mix(finalColor, vec3(0.82, 0.94, 1.0), 0.45 * secondaryCircle);
      }

      // 2. White faceted specular sparkles: positioned strictly in the core location with reduced area
      float coreZone = step(0.82, baseSpec);
      vec3 facetedNormal = normalize(fragNormal + vec3((floor(v1 * 4.0)/4.0 - 0.5) * 0.45, 0.0, (floor(v2 * 4.0)/4.0 - 0.5) * 0.45));
      float facetNdotH = max(dot(facetedNormal, halfDir), 0.0);
      float facetSpec = pow(facetNdotH, 200.0);
      float whiteFacetGlint = coreZone * step(0.86, facetSpec) * step(0.52, v2);

      if (whiteFacetGlint > 0.5) {
        finalColor = mix(finalColor, vec3(0.95, 0.98, 1.0), 0.90);
      }

      // 4. Espuma de superfície multicamadas (Fiel à referência media_1789951390077.png):
      // - Transição SUAVE com transparência real (alpha diminui gradualmente para o azul da água)
      // - A parte mais clara (branco) é pontual / cristas em MENOR proporção (fiel à referência)

      // Opacidade da espuma suave (translucidez cel-shaded: a água azul transluz por baixo)
      // Na orla é ~0.55, caindo suavemente para 0.0 na água mais profunda
      // Alcance próprio (até ~4m): com o gradiente da orla ela sumia já a ~2m de profundidade.
      float softGrad = 1.0 - smoothstep(0.10, 4.0, verticalDepth);
      float softAlpha = pow(softGrad, 0.85) * 0.50;

      // Opacidade dos realces brancos (a parte mais clara): concentra-se na orla e some primeiro
      float whiteAlpha = pow(coastalGrad, 1.8) * 0.88;

      // Cores calibradas com base na paleta exata da referência (media_1789951390077.png):
      // Corpo suave: branco-azulado. O pastel anterior (#9fd0f5) tinha quase a mesma cor da água
      // ciano por baixo e a espuma de dentro praticamente sumia.
      vec3 softFoamColor = vec3(0.74, 0.89, 0.99);
      // Realce claro: branco puro brilhante (#ffffff)
      vec3 whiteFoamColor = vec3(1.0, 1.0, 1.0);

      // Camada 1: Corpo principal da espuma suave e translúcida (área ampla com transparência)
      if (softFoamMask > 0.5 && softAlpha > 0.01) {
        finalColor = mix(finalColor, softFoamColor, softAlpha);
      }

      // Camada 2: A parte mais clara da espuma (apenas picos e cristas em MENOR quantidade)
      if (whiteHighlightMask > 0.5 && whiteAlpha > 0.01) {
        finalColor = mix(finalColor, whiteFoamColor, whiteAlpha);
      }

      // 5. Ondulações interativas (Ripples) com anéis concêntricos bicolores
      for (int i = 0; i < 8; i++) {
        if (i >= uActiveRipples) break;
        vec4 rip = uRipples[i];
        vec2 ripPos = rip.xy;
        float ripRad = rip.z;
        float ripStr = rip.w;

        // Quantized distance on pixel grid for authentic pixelated circles
        float dist = length(worldGrid - ripPos);
        float ringDist = abs(dist - ripRad);

        if (ripStr > 0.06 && ripRad < 2.8) {
          // Hard, compact crisp stepped rings (localized and focused)
          float innerWhiteRing = step(ringDist, 0.08) * step(0.14, ripStr);
          float outerCyanRing = step(ringDist, 0.16) * step(0.08, ripStr);

          if (innerWhiteRing > 0.5) {
            finalColor = vec3(1.0, 1.0, 1.0); // Anel interno branco puro
          } else if (outerCyanRing > 0.5) {
            finalColor = mix(finalColor, uCrestColor, 0.85); // Anel externo ciano
          }
        }
      }

      // 6. Espuma de contato na borda da praia: linha de contato branca pura (#ffffff) colada na areia com transição anti-aliased estável
      if (isContactFoam > 0.01) {
        finalColor = mix(finalColor, vec3(1.0, 1.0, 1.0), isContactFoam);
      }

      gl_FragColor = vec4(finalColor, uOpacity);
    }
  `,
};

export const WaterfallShader = {
  uniforms: {
    uTime: { value: 0 },
    uDeepColor: { value: new THREE.Color('#0284c7') },
    uShallowColor: { value: new THREE.Color('#00d2ff') },
    uFoamColor: { value: new THREE.Color('#ffffff') },
    uFlowSpeed: { value: 3.5 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uFoamColor;
    uniform float uFlowSpeed;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      // Stepped vertical cascade streaks
      float t = uTime * uFlowSpeed;
      float streakUv = floor(vUv.x * 24.0) / 24.0;
      float streakAnim = fract(vUv.y * 6.0 + t + hash(vec2(streakUv, 0.0)) * 2.0);
      
      vec3 col = uShallowColor;
      
      // Vertical foam streaks
      if (streakAnim > 0.55) {
        col = uFoamColor;
      } else if (streakAnim > 0.35) {
        col = mix(uDeepColor, uShallowColor, 0.6);
      } else {
        col = uDeepColor;
      }

      // Spillway top lip and bottom splash foam
      if (vUv.y > 0.88 || vUv.y < 0.12) {
        col = uFoamColor;
      }

      gl_FragColor = vec4(col, 0.95);
    }
  `,
};

export function createWaterMaterial(): THREE.ShaderMaterial {
  const defaultTex = new THREE.DataTexture(new Uint8Array([2, 132, 199, 255]), 1, 1);
  defaultTex.needsUpdate = true;
  const defaultDepth = new THREE.DepthTexture(1, 1);

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(WaterShader.uniforms),
    vertexShader: WaterShader.vertexShader,
    fragmentShader: WaterShader.fragmentShader,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  mat.uniforms.tPlanarReflection.value = defaultTex;
  mat.uniforms.tDepth.value = defaultDepth;

  return mat;
}
