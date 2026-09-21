import * as THREE from 'three';

export function createTerrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    lights: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.common,
      THREE.UniformsLib.lights,
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0.0 },
        uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.35).normalize() },
        uSunColor: { value: new THREE.Color('#fff8ea') },
        uAmbientColor: { value: new THREE.Color('#7895b2') },
        uSeaLevel: { value: 0.0 },
        uBeachLevel: { value: 2.5 },
        uFogColor: { value: new THREE.Color('#b0d2ee') },
        uFogNear: { value: 200.0 },
        uFogFar: { value: 2400.0 }
      }
    ]),
    vertexShader: `
      #include <common>
      #include <shadowmap_pars_vertex>

      attribute vec2 aClimate;
      attribute vec4 aExtra;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec2 vClimate;
      varying vec4 vExtra;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vClimate = aClimate;
        vExtra = aExtra;
        
        mat3 normalMat = mat3(modelMatrix);
        vWorldNormal = normalize(normalMat * normal);

        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <project_vertex>
        #include <worldpos_vertex>

        #if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
          vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
          vec4 shadowWorldPosition;
        #endif
        #if defined( USE_SHADOWMAP )
          #if NUM_DIR_LIGHT_SHADOWS > 0
            float terrainNormalBias;
            #pragma unroll_loop_start
            for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
              // Viés de normal calibrado para a malha de relevo (quads de 2m)
              // Alinhado ao normalBias da cascata de sombra para contato perfeito e Peter Panning zero
              terrainNormalBias = directionalLightShadows[ i ].shadowNormalBias;
              shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * terrainNormalBias, 0.0 );
              vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
            }
            #pragma unroll_loop_end
          #endif
        #endif

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      #include <common>
      #include <packing>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>

      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform vec3 uAmbientColor;
      uniform float uSeaLevel;
      uniform float uBeachLevel;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec2 vClimate;
      varying vec4 vExtra;

      // Paleta ecológica rica, saturada e vibrante (Estilo Wind Waker / Ghibli / Pixel Oasis)
      const vec3 COL_DEEP_OCEAN       = vec3(0.04, 0.16, 0.28); // Fundo oceânico profundo
      const vec3 COL_WET_SAND         = vec3(0.58, 0.42, 0.24); // Areia molhada da orla (caramelo úmido saturado)
      const vec3 COL_WET_DESERT       = vec3(0.68, 0.48, 0.26); // Areia molhada de duna
      const vec3 COL_BEACH            = vec3(0.96, 0.86, 0.56); // Areia seca dourada ensolarada (#f6d365)
      const vec3 COL_DESERT_DUNES     = vec3(0.94, 0.74, 0.38); // Dunas douradas quentes
      const vec3 COL_SAVANNAH         = vec3(0.74, 0.66, 0.28); // Grama seca dourada
      const vec3 COL_RAINFOREST       = vec3(0.14, 0.44, 0.16); // Esmeralda tropical
      const vec3 COL_MANGROVE_SWAMP   = vec3(0.24, 0.38, 0.18); // Manguezal
      const vec3 COL_AUTUMN_FOREST    = vec3(0.68, 0.32, 0.14); // Folhas outonais vívidas
      const vec3 COL_TEMPERATE_FOREST = vec3(0.24, 0.56, 0.20); // Floresta temperada esmeralda viçosa
      const vec3 COL_COASTAL_MEADOW   = vec3(0.46, 0.72, 0.26); // Prado costeiro verdejante luminoso
      const vec3 COL_BOREAL_TAIGA     = vec3(0.18, 0.36, 0.20); // Coníferas frias
      const vec3 COL_ALPINE_TUNDRA    = vec3(0.42, 0.48, 0.40); // Tundra líquens
      const vec3 COL_ROCK_CLIFF       = vec3(0.48, 0.46, 0.44); // Granito das escarpas
      const vec3 COL_DARK_STONE       = vec3(0.30, 0.30, 0.32); // Basalto e pedra escura
      const vec3 COL_SNOW_SUMMIT      = vec3(0.96, 0.98, 1.00); // Neve glacial cristalina
      const vec3 COL_VOLCANO_ASH       = vec3(0.18, 0.18, 0.20); // Cinzas vulcânicas escuras
      const vec3 COL_VOLCANO_BASALT    = vec3(0.10, 0.10, 0.12); // Basalto e obsidiana
      const vec3 COL_VOLCANO_SULFUR    = vec3(0.95, 0.88, 0.18); // Enxofre geotérmico
      const vec3 COL_CANYON_RED        = vec3(0.82, 0.32, 0.18); // Arenito carmim
      const vec3 COL_CANYON_TERRA      = vec3(0.90, 0.48, 0.26); // Terracota sedimentar
      const vec3 COL_CANYON_OCHRE      = vec3(0.92, 0.70, 0.35); // Ocre desértico
      const vec3 COL_THERMAL_TURQUOISE = vec3(0.06, 0.78, 0.92); // Água termal límpida
      const vec3 COL_THERMAL_YELLOW    = vec3(0.98, 0.88, 0.18); // Bactérias termófilas
      const vec3 COL_THERMAL_RUST      = vec3(0.88, 0.40, 0.14); // Óxido mineral termal
      const vec3 COL_THERMAL_TRAVERTINE= vec3(0.94, 0.92, 0.86); // Travertino esbranquiçado
      const vec3 COL_PERMAFROST_ICE    = vec3(0.78, 0.90, 0.98); // Gelo e permafrost ártico

      // Hash determinístico de alta frequência (2D e 3D)
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float hash3D(vec3 p) {
        p = fract(p * vec3(123.34, 456.21, 789.12));
        p += dot(p, p.yzx + 45.32);
        return fract((p.x + p.y) * p.z);
      }

      // Ruído discreto por célula
      float cellNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Transição bioclimática orgânica suave e contínua
      float smoothTransition(float val, float threshold, float jitter, float halfWidth) {
        float t = threshold + jitter;
        return smoothstep(t - halfWidth, t + halfWidth, val);
      }

      // Gradiente analítico do plano receptor no espaço do shadow map
      // Permite predizer a profundidade exata do plano receptor em cada texel vizinho,
      // eliminando 100% da acne de sombra em encostas e geometrias rasantes.
      vec2 computeReceiverPlaneDepthSlope(vec3 shadowCoord) {
        vec3 dcdx = dFdx(shadowCoord);
        vec3 dcdy = dFdy(shadowCoord);
        float det = dcdx.x * dcdy.y - dcdx.y * dcdy.x;
        if (abs(det) > 1e-8) {
          vec2 slope = vec2(
            dcdy.y * dcdx.z - dcdx.y * dcdy.z,
            dcdx.x * dcdy.z - dcdy.x * dcdx.z
          ) / det;
          return clamp(slope, -50.0, 50.0);
        }
        return vec2(0.0);
      }

      // SMSR: Shadow Map Silhouette Revectorization com Compensação Planar
      // Reconstrói a silhueta analítica contínua da sombra no espaço sub-pixel,
      // eliminando serrilhados (stair-stepping) sem borrar as bordas duras estilo cartoon.
      float sampleShadowSMSR(sampler2D shadowMap, vec2 uv, float compareDepth, vec2 mapSize, vec2 dz_duv) {
        vec2 texelSize = vec2(1.0) / mapSize;
        vec2 coord = uv * mapSize - 0.5;
        vec2 base = floor(coord);
        vec2 f = fract(coord);

        vec2 uv00 = (base + vec2(0.5, 0.5)) * texelSize;
        vec2 uv10 = uv00 + vec2(texelSize.x, 0.0);
        vec2 uv01 = uv00 + vec2(0.0, texelSize.y);
        vec2 uv11 = uv00 + texelSize;

        // Ajuste de profundidade do plano receptor para cada amostra
        float d00 = compareDepth + dot(uv00 - uv, dz_duv);
        float d10 = compareDepth + dot(uv10 - uv, dz_duv);
        float d01 = compareDepth + dot(uv01 - uv, dz_duv);
        float d11 = compareDepth + dot(uv11 - uv, dz_duv);

        float s00 = texture2DCompare(shadowMap, uv00, d00);
        float s10 = texture2DCompare(shadowMap, uv10, d10);
        float s01 = texture2DCompare(shadowMap, uv01, d01);
        float s11 = texture2DCompare(shadowMap, uv11, d11);

        // Se os 4 texels concordam (área 100% iluminada ou 100% na sombra), sai imediatamente
        if (s00 == s10 && s10 == s01 && s01 == s11) {
          return s00;
        }

        // Revectorização da silhueta sub-pixel
        vec2 grad = vec2((s10 + s11) - (s00 + s01), (s01 + s11) - (s00 + s10));
        float gradLen = length(grad);
        if (gradLen < 0.001) {
          return (s00 + s10 + s01 + s11) * 0.25;
        }
        vec2 edgeNormal = grad / gradLen;
        float coverage = (s00 + s10 + s01 + s11) * 0.25;

        // Distância sub-pixel com sinal até a reta da silhueta revectorizada
        float dist = dot(f - 0.5, edgeNormal) + (coverage - 0.5) * 1.25;

        // Transição sub-pixel nítida estilo cartoon (largura sub-texel anti-aliased)
        const float w = 0.08;
        return smoothstep(-w, w, dist);
      }

      void main() {
        // 1. Normal analítica interpolada contínua (Shade Smooth - elimina a malha multifacetada)
        vec3 normal = normalize(vWorldNormal);
        float slope = clamp(normal.y, 0.0, 1.0);
        float h = vWorldPosition.y;

        // 2. Ruídos contínuos suaves no espaço de mundo (elimina a triangulação artificial per-face)
        float worldNoise1 = cellNoise(vWorldPosition.xz * 0.16);
        float worldNoise2 = cellNoise(vWorldPosition.xz * 0.38 + vec2(17.3, 41.8));
        float organicShade = 0.96 + (worldNoise1 * 0.6 + worldNoise2 * 0.4) * 0.08;

        float softJitter1 = (worldNoise1 - 0.5) * 0.055;
        float softJitter2 = (worldNoise2 - 0.5) * 0.055;

        // 3. Macro-clima contínuo (Temperatura e Umidade)
        float temperature = clamp(vClimate.x, 0.0, 1.0);
        float moisture = clamp(vClimate.y, 0.0, 1.0);

        // 4. Paletas botânicas e minerais ricas combinadas suavemente
        // Floresta Temperada (Lush emerald, musgo profundo, clareira viçosa)
        vec3 colForestA = vec3(0.24, 0.54, 0.12);
        vec3 colForestB = vec3(0.16, 0.40, 0.08);
        vec3 colForestC = vec3(0.32, 0.64, 0.16);
        vec3 forestColor = mix(colForestA, mix(colForestB, colForestC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Prado Costeiro (Verde esmeralda Ghibli, capim viçoso, tufos dourados)
        vec3 colMeadowA = vec3(0.28, 0.62, 0.14);
        vec3 colMeadowB = vec3(0.38, 0.74, 0.16);
        vec3 colMeadowC = vec3(0.20, 0.48, 0.10);
        vec3 meadowColor = mix(colMeadowA, mix(colMeadowB, colMeadowC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Bosque Outonal (Mosaico vívido de folhas caídas: carmesim, âmbar dourado e húmus terroso)
        vec3 colAutumnA = vec3(0.68, 0.32, 0.14);
        vec3 colAutumnB = vec3(0.78, 0.48, 0.16);
        vec3 colAutumnC = vec3(0.48, 0.26, 0.12);
        vec3 autumnColor = mix(colAutumnA, mix(colAutumnB, colAutumnC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Savana Tropical (Grama madura dourada, capim ocre e solo argiloso queimado)
        vec3 colSavA = vec3(0.78, 0.66, 0.24);
        vec3 colSavB = vec3(0.68, 0.58, 0.20);
        vec3 colSavC = vec3(0.72, 0.52, 0.22);
        vec3 savannahColor = mix(colSavA, mix(colSavB, colSavC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Dunas do Deserto (Crista ensolarada, encosta dourada e vale ocre)
        vec3 colDuneA = vec3(0.96, 0.78, 0.38);
        vec3 colDuneB = vec3(0.90, 0.70, 0.32);
        vec3 colDuneC = vec3(0.84, 0.62, 0.26);
        vec3 duneColor = mix(colDuneA, mix(colDuneB, colDuneC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Selva Tropical / Floresta Úmida (Esmeralda densa, dossel profundo e sombra úmida)
        vec3 colJungleA = vec3(0.14, 0.46, 0.14);
        vec3 colJungleB = vec3(0.10, 0.38, 0.10);
        vec3 colJungleC = vec3(0.18, 0.50, 0.16);
        vec3 jungleColor = mix(colJungleA, mix(colJungleB, colJungleC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Taiga Boreal (Agulhas gélidas, líquens escuros e turfa boreal)
        vec3 colTaigaA = vec3(0.18, 0.34, 0.16);
        vec3 colTaigaB = vec3(0.22, 0.38, 0.20);
        vec3 colTaigaC = vec3(0.16, 0.28, 0.14);
        vec3 taigaColor = mix(colTaigaA, mix(colTaigaB, colTaigaC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Tundra Glacial & Ártico (Permafrost vítreo, rime gélido e ardósia polar)
        vec3 colTundraA = vec3(0.82, 0.92, 0.98);
        vec3 colTundraB = vec3(0.68, 0.78, 0.78);
        vec3 colTundraC = vec3(0.56, 0.64, 0.62);
        vec3 tundraColor = mix(colTundraA, mix(colTundraB, colTundraC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Falésias e Paredões Rochosos (Granito quente, basalto e pedra mineral)
        vec3 colCliffA = vec3(0.48, 0.46, 0.42);
        vec3 colCliffB = vec3(0.34, 0.33, 0.32);
        vec3 colCliffC = vec3(0.42, 0.40, 0.38);
        vec3 cliffColor = mix(colCliffA, mix(colCliffB, colCliffC, smoothstep(0.35, 0.75, worldNoise2)), smoothstep(0.25, 0.65, worldNoise1)) * organicShade;

        // Praia Arenosa Dourada Quente
        vec3 colWetSandA = vec3(0.58, 0.40, 0.22);
        vec3 colWetSandB = vec3(0.48, 0.32, 0.16);
        vec3 wetSandColor = mix(colWetSandA, colWetSandB, worldNoise1);

        vec3 colBeachA = vec3(0.95, 0.82, 0.48);
        vec3 colBeachB = vec3(0.88, 0.74, 0.40);
        vec3 colBeachC = vec3(0.98, 0.88, 0.54);
        vec3 dryBeachColor = mix(colBeachA, mix(colBeachB, colBeachC, worldNoise2), worldNoise1) * organicShade;

        float tDry = smoothstep(0.04, 1.40, h);
        vec3 beachColor = mix(wetSandColor, dryBeachColor, tDry);

        // 5. TRANSIÇÕES ECOLÓGICAS SUAVES E CONTÍNUAS (Full Smooth - Abordagem A)
        // A. Zonas Quentes (Deserto -> Savana -> Selva Tropical Úmida)
        float tHotSavannah = smoothTransition(moisture, 0.32, softJitter2, 0.05);
        vec3 hotBase = mix(duneColor, savannahColor, tHotSavannah);
        float tHotRainforest = smoothTransition(moisture, 0.48, softJitter1, 0.05);
        vec3 hotGround = mix(hotBase, jungleColor, tHotRainforest);

        // B. Zonas Temperadas e Tropicais da Ilha (Prado Costeiro -> Floresta Temperada -> Bosque Outonal)
        float tTempForest = smoothTransition(moisture, 0.40, softJitter2, 0.05);
        vec3 tempBase = mix(meadowColor, forestColor, tTempForest);
        float tTempAutumn = smoothTransition(moisture, 0.72, softJitter1, 0.05);
        vec3 tempGround = mix(tempBase, autumnColor, tTempAutumn);

        // C. Zonas Frias (Taiga Boreal)
        vec3 coldGround = taigaColor;

        // Transição macroscópica de temperatura (Zonas temperadas e tropicais cobrem a ilha costeira)
        float tColdToTemp = smoothTransition(temperature, 0.34, softJitter1, 0.05);
        vec3 inlandPlains = mix(coldGround, tempGround, tColdToTemp);
        float tTempToHot = smoothTransition(temperature, 0.78, softJitter2, 0.05);
        inlandPlains = mix(inlandPlains, hotGround, tTempToHot);

        // Transição suave da Praia para o Interior Verdejante (Orla até 2.4m de cota)
        float tInland = smoothTransition(h, 2.4, softJitter1 * 2.5, 0.40);
        vec3 landColor = mix(beachColor, inlandPlains, tInland);

        // Andar de Altitude Elevada (h > 45.0m): Tundra Alpina vs Taiga
        if (h > 45.0) {
          float tAlpine = smoothTransition(temperature, 0.32, softJitter1, 0.05);
          vec3 alpineBase = mix(COL_ALPINE_TUNDRA * organicShade, taigaColor, tAlpine);
          float tHigh = smoothTransition(h, 48.0, softJitter2 * 6.0, 2.5);
          landColor = mix(landColor, alpineBase, tHigh);
        }

        // Falésias rochosas estritas: colinas e encostas até 60° permanecem verdes; apenas paredões íngremes mostram pedra
        float cliffFactor = smoothstep(0.48, 0.24, slope);
        if (h < 1.0) {
          cliffColor *= mix(0.70, 1.0, smoothstep(-2.0, 1.0, h));
        }
        vec3 groundColor = mix(landColor, cliffColor, cliffFactor);

        // Fundo oceânico e leito marinho submerso
        if (h < 0.2) {
          groundColor = mix(COL_DEEP_OCEAN, groundColor, smoothstep(-5.0, 0.2, h));
        }

        // 6. CAMADAS GEOLÓGICAS ESPECIAIS COM TRANSIÇÕES SUAVES
        float volcanoVal = vExtra.x;
        float canyonVal = vExtra.y;
        float geothermalVal = vExtra.z;
        float iceVal = vExtra.w;

        // Camada Vulcânica: Basalto, cinzas e veios de enxofre
        float tAsh = smoothTransition(volcanoVal, 0.18, softJitter2, 0.04);
        if (tAsh > 0.0) {
          vec3 volcanoBase = mix(COL_VOLCANO_BASALT, COL_VOLCANO_ASH, worldNoise1) * organicShade;
          float sulfurVein = smoothstep(0.68, 0.88, cellNoise(vWorldPosition.xz * 0.04)) * smoothstep(0.35, 0.80, volcanoVal);
          vec3 volcanoGround = mix(volcanoBase, COL_VOLCANO_SULFUR, sulfurVein * 0.65);
          if (slope > 0.65) {
            volcanoGround = mix(volcanoGround, COL_VOLCANO_BASALT * 0.75, smoothstep(0.65, 1.2, slope));
          }
          groundColor = mix(groundColor, volcanoGround, tAsh);
        }

        // Camada de Cânion Estratificado
        float effectiveCanyon = canyonVal * (1.0 - smoothstep(0.04, 0.25, volcanoVal));
        float tCanyon = smoothTransition(effectiveCanyon, 0.30, softJitter1, 0.04);
        if (tCanyon > 0.0 && slope < 0.85) {
          float strataBand = sin(h * 1.6 + cellNoise(vWorldPosition.xz * 0.015) * 1.5) * 0.5 + 0.5;
          vec3 strataColor;
          if (strataBand < 0.33) {
            strataColor = mix(COL_CANYON_RED, COL_CANYON_TERRA, strataBand * 3.0);
          } else if (strataBand < 0.66) {
            strataColor = mix(COL_CANYON_TERRA, COL_CANYON_OCHRE, (strataBand - 0.33) * 3.0);
          } else {
            strataColor = mix(COL_CANYON_OCHRE, COL_CANYON_RED, (strataBand - 0.66) * 3.0);
          }
          groundColor = mix(groundColor, strataColor * organicShade, tCanyon);
        }

        // Camada Geotérmica: Travertino e anéis termófilos
        float tGeo = smoothTransition(geothermalVal, 0.25, softJitter1, 0.04);
        if (tGeo > 0.0) {
          vec3 travert = mix(COL_THERMAL_TRAVERTINE, vec3(0.72, 0.66, 0.54), worldNoise2) * organicShade;
          if (geothermalVal > 0.65) {
            float bacPattern = cellNoise(vWorldPosition.xz * 0.08);
            vec3 mineralCol = mix(COL_THERMAL_YELLOW, COL_THERMAL_RUST, smoothstep(0.3, 0.7, bacPattern));
            travert = mix(travert, mineralCol, smoothstep(0.65, 0.90, geothermalVal));
          }
          groundColor = mix(groundColor, travert, tGeo);
        }

        // Camada Ártica de Permafrost / Tundra Glacial
        float tIce = smoothTransition(iceVal, 0.22, softJitter1, 0.04);
        if (tIce > 0.0) {
          groundColor = mix(groundColor, tundraColor, tIce);
        }

        // 7. Camada Glacial de Neve Natural nos Cumes Alpinos
        float macroMountain = (cellNoise(vWorldPosition.xz * 0.02) - 0.5) * 8.0;
        float creviceNoise = (cellNoise(vWorldPosition.xz * 0.06) - 0.5) * 3.5;
        float slopeBonus = (slope - 0.48) * 16.0;
        float effectiveSnowH = h + macroMountain + creviceNoise + slopeBonus + (worldNoise1 - 0.5) * 2.0;

        float snowMinH = 50.0;
        float snowMaxH = 68.0;
        float snowProgress = clamp((effectiveSnowH - snowMinH) / (snowMaxH - snowMinH), 0.0, 1.0) * (1.0 - smoothstep(0.02, 0.12, volcanoVal));
        float cliffExpose = smoothstep(0.20, 0.48, slope);
        snowProgress = mix(snowProgress * 0.78, snowProgress, cliffExpose);

        if (snowProgress > 0.05) {
          float tSnow = smoothTransition(snowProgress, 0.25, softJitter2, 0.06);
          vec3 snowTone = mix(COL_SNOW_SUMMIT * 0.97, COL_SNOW_SUMMIT * 1.01, worldNoise1);
          groundColor = mix(groundColor, snowTone, tSnow);
        }

        // 8. Iluminação Cartoon Cel-Shading com Sistema de Shadow Clipmap Concêntrico + SMSR
        vec3 lightDir = normalize(uSunDirection);
        float NdotL = dot(normal, lightDir);

        // Viés dinâmico de plano receptor (Slope-Scale Depth Bias):
        // Elimina Peter Panning em superfícies frontais (bias mínimo) e Shadow Acne em encostas rasantes.
        float tanTheta = sqrt(clamp(1.0 - NdotL * NdotL, 0.0, 1.0)) / max(abs(NdotL), 0.02);
        float slopeFactor = clamp(tanTheta, 0.0, 2.5);

        // Amostragem hierárquica concêntrica com SMSR (Nível 0: 35m, Nível 1: 120m, Nível 2: 450m)
        float clipmapShadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        // Avalia coordenadas e gradientes analíticos do plano receptor em fluxo uniforme
        #if NUM_DIR_LIGHT_SHADOWS >= 1
        vec4 sc0 = vDirectionalShadowCoord[0];
        vec3 c0 = sc0.xyz / sc0.w;
        vec2 dz_duv0 = computeReceiverPlaneDepthSlope(c0);
        #endif
        #if NUM_DIR_LIGHT_SHADOWS >= 2
        vec4 sc1 = vDirectionalShadowCoord[1];
        vec3 c1 = sc1.xyz / sc1.w;
        vec2 dz_duv1 = computeReceiverPlaneDepthSlope(c1);
        #endif
        #if NUM_DIR_LIGHT_SHADOWS >= 3
        vec4 sc2 = vDirectionalShadowCoord[2];
        vec3 c2 = sc2.xyz / sc2.w;
        vec2 dz_duv2 = computeReceiverPlaneDepthSlope(c2);
        #endif

        bool sampled = false;
        #if NUM_DIR_LIGHT_SHADOWS >= 1
        if (!sampled && c0.x >= 0.01 && c0.x <= 0.99 && c0.y >= 0.01 && c0.y <= 0.99 && c0.z <= 1.0) {
          float bias0 = directionalLightShadows[0].shadowBias - 0.00003 * slopeFactor;
          clipmapShadow = sampleShadowSMSR( directionalShadowMap[0], c0.xy, c0.z + bias0, directionalLightShadows[0].shadowMapSize, dz_duv0 );
          sampled = true;
        }
        #endif
        #if NUM_DIR_LIGHT_SHADOWS >= 2
        if (!sampled && c1.x >= 0.01 && c1.x <= 0.99 && c1.y >= 0.01 && c1.y <= 0.99 && c1.z <= 1.0) {
          float bias1 = directionalLightShadows[1].shadowBias - 0.00008 * slopeFactor;
          clipmapShadow = sampleShadowSMSR( directionalShadowMap[1], c1.xy, c1.z + bias1, directionalLightShadows[1].shadowMapSize, dz_duv1 );
          sampled = true;
        }
        #endif
        #if NUM_DIR_LIGHT_SHADOWS >= 3
        if (!sampled && c2.x >= 0.01 && c2.x <= 0.99 && c2.y >= 0.01 && c2.y <= 0.99 && c2.z <= 1.0) {
          float bias2 = directionalLightShadows[2].shadowBias - 0.00020 * slopeFactor;
          clipmapShadow = sampleShadowSMSR( directionalShadowMap[2], c2.xy, c2.z + bias2, directionalLightShadows[2].shadowMapSize, dz_duv2 );
          sampled = true;
        }
        #endif
        #endif

        // Sombra cartoon com silhueta analítica nítida suavizada por SMSR
        float hardShadow = clipmapShadow;

        // 8. Vetores de iluminação e observação para cel-shading, especular e lustro
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 halfDir = normalize(lightDir + viewDir);
        float NdotH = max(dot(normal, halfDir), 0.0);

        // Iluminação direta cel-shading com 2 degraus nítidos
        float celSun = (step(0.12, NdotL) * 0.65 + step(0.02, NdotL) * 0.35) * hardShadow;

        // Warm Wrap Terminator: Borda aquecida dourada/pêssego na transição sombra-luz (estilo Ghibli/Wind Waker)
        // Elimina sombras duras cinzentas e frias ("opacas"), dando vida biológica e dispersão de luz
        float terminatorBand = smoothstep(-0.08, 0.06, NdotL) * (1.0 - smoothstep(0.06, 0.22, NdotL)) * hardShadow;
        vec3 warmTerminator = vec3(1.0, 0.68, 0.32) * (terminatorBand * 0.28);

        // Oclusão de encostas e vales baseada na inclinação da normal
        float slopeAO = clamp(normal.y * 0.30 + 0.70, 0.0, 1.0);

        // 9. Texturização Procedural Pixel-Art Rica em Camadas (Fim do Aspecto Fosco/Opaco)
        // Grade quantizada no espaço de mundo: 8 texels por metro (resolução retro nítida de 12.5cm)
        vec2 pCoord = floor(vWorldPosition.xz * 8.0);
        vec2 cell4 = mod(pCoord, 4.0);
        float pHash = hash(pCoord);
        float pHash2 = hash(pCoord + vec2(19.3, 37.1));

        // A. Textura de Grama / Prado: Tufos de grama estilizados com lâminas e pontas ensolaradas
        float grassTuft = 0.0;
        if ((cell4.x == 1.0 && cell4.y == 2.0) || (cell4.x == 2.0 && cell4.y == 3.0) || (cell4.x == 3.0 && cell4.y == 1.0)) {
          grassTuft = 0.12; // Ponta iluminada de tufo
        } else if ((cell4.x == 1.0 && cell4.y == 1.0) || (cell4.x == 2.0 && cell4.y == 2.0)) {
          grassTuft = -0.10; // Sombra na base do tufo
        }
        float flowerMask = step(0.965, pHash) * smoothstep(0.40, 0.80, moisture) * (1.0 - cliffFactor);
        vec3 flowerCol = (pHash2 > 0.5) ? vec3(1.0, 0.95, 0.40) : vec3(1.0, 0.80, 0.88);

        // B. Textura de Praia / Areia: Ondulações de dunas suaves (Wind Ripples) e grãos finos de quartzo
        float sandRipple = sin((vWorldPosition.x * 0.7 + vWorldPosition.z * 1.1) * 2.2 + cellNoise(vWorldPosition.xz * 0.3) * 3.0);
        float sandRippleStepped = (floor(sandRipple * 2.0) / 2.0) * 0.06;
        float sandGrain = (pHash - 0.5) * 0.04;
        float pebbleMask = step(0.975, pHash) * (1.0 - tDry) * (1.0 - cliffFactor);
        vec3 pebbleCol = vec3(0.92, 0.90, 0.85);

        // C. Textura de Falésias e Paredões Rochosos: Estratos geológicos e fissuras cinzeladas
        float rockStrata = sin(vWorldPosition.y * 2.4 + cellNoise(vWorldPosition.xz * 0.2) * 2.5);
        float strataBand = (floor(rockStrata * 3.0) / 3.0) * 0.08;
        float rockChisel = ((cell4.y == 0.0 || cell4.x == 0.0) && pHash > 0.4) ? -0.12 : 0.0;
        if (cell4.y == 1.0 && pHash > 0.4) rockChisel += 0.08;

        // D. Textura de Neve Glacial: Cristais de neve e cintilação
        float snowGrain = (pHash - 0.5) * 0.035;

        // Aplicação ponderada das texturas por bioma/relevo
        float isGrassland = tInland * (1.0 - cliffFactor);
        float isBeachZone = (1.0 - tInland) * (1.0 - cliffFactor);

        vec3 texGround = groundColor;
        vec3 tuftOffset = (grassTuft > 0.0) 
          ? vec3(0.10, 0.18, 0.02) * (grassTuft * 4.0) 
          : vec3(-0.06, -0.12, -0.03) * (-grassTuft * 4.0);
        texGround += tuftOffset * isGrassland;
        texGround = mix(texGround, flowerCol, flowerMask * isGrassland);

        vec3 rippleOffset = vec3(sandRippleStepped * 0.8, sandRippleStepped * 0.7, sandRippleStepped * 0.3) + vec3(sandGrain * 0.5);
        texGround += rippleOffset * isBeachZone;
        texGround = mix(texGround, pebbleCol, pebbleMask * isBeachZone);

        texGround += vec3(strataBand + rockChisel) * cliffFactor;
        texGround += vec3(snowGrain) * (snowProgress * 0.5);

        groundColor = clamp(texGround, 0.0, 1.0);

        // Balanceamento de luz ambiente e solar com preservação de saturação rica
        // O terreno recebe iluminação ambiente natural levemente aquecida pelo solo e vegetação
        vec3 warmSkyAmbient = mix(uAmbientColor, vec3(0.75, 0.85, 0.65), 0.40);
        vec3 ambientTerm = warmSkyAmbient * (0.42 * slopeAO);
        vec3 sunTerm = uSunColor * (celSun * 0.85);
        vec3 totalLight = ambientTerm + sunTerm + warmTerminator;
        vec3 finalColor = groundColor * totalLight;

        // 10. Especular e Lustro Cel-Shaded (Quebrando o Aspecto Fosco/Opaco)
        // A. Película de Água na Areia Molhada da Praia (Wet Sand Sheen)
        float isWetSand = (1.0 - tDry) * (1.0 - cliffFactor) * (1.0 - tInland);
        if (isWetSand > 0.01 && hardShadow > 0.05) {
          float wetSpec = pow(NdotH, 42.0);
          float wetGlint = smoothstep(0.72, 0.92, wetSpec) * hardShadow * isWetSand;
          float wetHalo = smoothstep(0.35, 0.70, wetSpec) * hardShadow * isWetSand;
          finalColor = mix(finalColor, vec3(0.92, 0.96, 1.0), wetHalo * 0.20);
          finalColor = mix(finalColor, vec3(1.0, 1.0, 0.95), wetGlint * 0.45);
        }

        // B. Lustro Mineral em Arestas Rochosas
        if (cliffFactor > 0.20 && hardShadow > 0.05) {
          float rockSpec = pow(NdotH, 28.0) * cliffFactor;
          float rockGlint = step(0.70, rockSpec) * hardShadow;
          finalColor = mix(finalColor, vec3(0.92, 0.94, 0.98), rockGlint * 0.35);
        }

        // C. Micro-cintilação Glacial na Neve
        if (snowProgress > 0.10 && hardShadow > 0.05) {
          float snowSpec = pow(NdotH, 36.0);
          float snowSparkle = step(0.88, hash3D(floor(vWorldPosition * 6.0))) * step(0.45, snowSpec) * hardShadow * snowProgress;
          finalColor = mix(finalColor, vec3(1.0, 1.0, 1.0), snowSparkle * 0.85);
        }

        // Névoa atmosférica de profundidade
        float dist = length(vWorldPosition - cameraPosition);
        float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 0.85);
        finalColor = mix(finalColor, uFogColor, fogFactor);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `
  });
}
