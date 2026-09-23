import * as THREE from 'three';
import { TimePreset } from './skyAtmosphere.ts';

/**
 * CartoonSkybox: Procedural Cel-Shaded Sky Dome with Atmospheric Gradient,
 * Fluffy Animated Cartoon Clouds, Radiant Sun Disk & Corona, Heroic Moon,
 * and Pinpoint Twinkling Starfield.
 */
export class CartoonSkybox {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private currentSunDir: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private currentMoonDir: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  // Target values for smooth preset transitions
  private targetZenithColor = new THREE.Color('#1e6ece');
  private targetHorizonColor = new THREE.Color('#92ccf8');
  private targetGroundColor = new THREE.Color('#78b0db');
  private targetCloudColor = new THREE.Color('#ffffff');
  private targetCloudShadowColor = new THREE.Color('#b3d3f5');
  private targetSunColor = new THREE.Color('#fffdf0');
  private targetCoronaColor = new THREE.Color('#ffe28a');
  private targetFogColor = new THREE.Color('#b0d2ee');
  private targetStarVis = 0.0;
  private targetMoonVis = 0.0;
  private targetCloudCoverage = 0.72;

  // Current interpolated values
  private currentZenithColor = new THREE.Color('#1e6ece');
  private currentHorizonColor = new THREE.Color('#92ccf8');
  private currentGroundColor = new THREE.Color('#78b0db');
  private currentCloudColor = new THREE.Color('#ffffff');
  private currentCloudShadowColor = new THREE.Color('#b3d3f5');
  private currentSunColor = new THREE.Color('#fffdf0');
  private currentCoronaColor = new THREE.Color('#ffe28a');
  private currentFogColor = new THREE.Color('#b0d2ee');
  private currentStarVis = 0.0;
  private currentMoonVis = 0.0;
  private currentCloudCoverage = 0.72;

  private windOffset = new THREE.Vector2(0, 0);
  private windOffset2 = new THREE.Vector2(0, 0);
  private windSpeed = new THREE.Vector2(0.015, 0.007);

  constructor() {
    const geometry = new THREE.SphereGeometry(1500, 64, 48);

    const vertexShader = /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vRayDir;

      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vRayDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform vec3 uCloudColor;
      uniform vec3 uCloudShadowColor;
      uniform vec3 uSunColor;
      uniform vec3 uCoronaColor;
      uniform vec3 uFogColor;
      uniform float uStarVisibility;
      uniform float uMoonVisibility;
      uniform float uCloudCoverage;
      uniform vec2 uWindOffset;
      uniform vec2 uWindOffset2;
      uniform vec3 uCameraPos;
      // Escala das grades pixel-art do céu, relativa à densidade de texels padrão do terreno
      uniform float uPixelScale;

      varying vec3 vWorldPosition;
      varying vec3 vRayDir;

      // Matriz de Bayer 4x4 clássica para dithering de pixel art 16-bit
      float bayer4x4(vec2 p) {
        vec2 f = floor(mod(p, 4.0));
        float m = 0.0;
        if (f.y < 0.5) {
          if (f.x < 0.5) m = 0.0;
          else if (f.x < 1.5) m = 8.0;
          else if (f.x < 2.5) m = 2.0;
          else m = 10.0;
        } else if (f.y < 1.5) {
          if (f.x < 0.5) m = 12.0;
          else if (f.x < 1.5) m = 4.0;
          else if (f.x < 2.5) m = 14.0;
          else m = 6.0;
        } else if (f.y < 2.5) {
          if (f.x < 0.5) m = 3.0;
          else if (f.x < 1.5) m = 11.0;
          else if (f.x < 2.5) m = 1.0;
          else m = 9.0;
        } else {
          if (f.x < 0.5) m = 15.0;
          else if (f.x < 1.5) m = 7.0;
          else if (f.x < 2.5) m = 13.0;
          else m = 5.0;
        }
        return m / 16.0;
      }

      // Hash determinístico 2D
      vec2 hash2(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }

      // Ruído Simplex 2D otimizado e estável
      float noise2D(vec2 p) {
        const float K1 = 0.366025404;
        const float K2 = 0.211324865;

        vec2 i = floor(p + (p.x + p.y) * K1);
        vec2 a = p - i + (i.x + i.y) * K2;
        float m = step(a.y, a.x);
        vec2 o = vec2(m, 1.0 - m);
        vec2 b = a - o + K2;
        vec2 c = a - 1.0 + 2.0 * K2;

        vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
        vec3 n = h * h * h * h * vec3(dot(a, hash2(i)), dot(b, hash2(i + o)), dot(c, hash2(i + 1.0)));

        return dot(n, vec3(70.0));
      }

      // Ruído Billow para convexidade e fofura cúmulus estilo cartoon
      float billowNoise(vec2 p) {
        return 1.0 - abs(noise2D(p));
      }

      // FBM Billow multi-oitavas para silhuetas de nuvens cúmulus fofas
      float billowFBM(vec2 p) {
        float f = 0.0;
        f += 0.54 * billowNoise(p);
        f += 0.28 * billowNoise(p * 2.18 + vec2(1.7, 3.2));
        f += 0.18 * billowNoise(p * 4.45 + vec2(3.5, 1.9));
        return f;
      }

      void main() {
        vec3 ray = normalize(vRayDir);
        float height = ray.y;

        // Coordenadas esféricas projetadas em grid de Pixel Art SNES Mode 7
        float az = atan(ray.z, ray.x);
        float azNorm = (az / 3.14159265359) * 0.5 + 0.5;

        vec2 snesGrid = vec2(1920.0, 960.0) * uPixelScale;
        vec2 snesTexel = floor(vec2(azNorm, height * 0.5 + 0.5) * snesGrid);
        vec2 snesUV = snesTexel / snesGrid;
        // O dither fica na grade PADRÃO: se encolhesse junto com o pixel, viraria um padrão
        // mais fino que os pixels da tela e apareceria como listras (moiré).
        float snesDither = (bayer4x4(floor(vec2(azNorm, height * 0.5 + 0.5) * vec2(1920.0, 960.0))) - 0.5);

        // 1. CÉU SNES: Gradiente HDMA com bandas celestes e dithering 16-bit
        vec3 sky;
        float bandCount = 16.0;
        if (height >= 0.0) {
          float tSky = pow(clamp(height, 0.0, 1.0), 0.72);
          float tBanded = floor(clamp(tSky + snesDither / bandCount, 0.0, 1.0) * bandCount) / (bandCount - 1.0);
          sky = mix(uHorizonColor, uZenithColor, clamp(tBanded, 0.0, 1.0));
        } else {
          float tGround = clamp(-height * 4.0, 0.0, 1.0);
          float gBanded = floor(clamp(tGround + snesDither / 4.0, 0.0, 1.0) * 4.0) / 3.0;
          sky = mix(uHorizonColor, uGroundColor, clamp(gBanded, 0.0, 1.0));
        }

        // 2. CORPOS CELESTES: Sol em Pixel Art 16-Bit
        vec3 normSunDir = normalize(uSunDir);
        float sunMask = step(-0.02, normSunDir.y);

        if (sunMask > 0.01) {
          vec3 upRef = abs(normSunDir.y) > 0.88 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 perp1 = normalize(cross(normSunDir, upRef));
          vec3 perp2 = cross(normSunDir, perp1);
          vec2 sunPlane = vec2(dot(ray, perp1), dot(ray, perp2));

          float sunForward = dot(ray, normSunDir);
          if (sunForward > 0.82) {
            float sunGridRes = 360.0 * uPixelScale;
            vec2 sunTexel = floor(sunPlane * sunGridRes + 0.5);
            vec2 sunQuant = sunTexel / sunGridRes;
            float sunDist = length(sunQuant);
            float sunAng = atan(sunQuant.y, sunQuant.x);

            float isSunDisk = step(sunDist, 0.048);
            float isCorona1 = step(sunDist, 0.082) * (1.0 - isSunDisk);
            float raySpikes = step(0.30, sin(sunAng * 8.0));
            float isCorona2 = step(sunDist, 0.135) * (1.0 - step(sunDist, 0.082)) * raySpikes;

            vec3 sunArt = uSunColor * isSunDisk + 
                          uCoronaColor * (isCorona1 * 0.90 + isCorona2 * 0.60);
            float sunPresence = isSunDisk + isCorona1 + isCorona2;
            if (sunPresence > 0.01) {
              sky = mix(sky, sunArt, clamp(sunPresence, 0.0, 1.0) * sunMask);
            }
          }
        }

        // 3. ESTRELAS EM PIXEL ART NOTURNO (Pixels pontuais cintilantes)
        if (uStarVisibility > 0.01 && height > 0.05) {
          vec3 starGrid = floor(ray * 420.0);
          float starSeed = fract(sin(dot(starGrid.xy, vec2(12.9898, 78.233)) + starGrid.z * 17.13) * 43758.5453);

          if (starSeed > 0.985) {
            vec3 starFract = (ray * 420.0) - starGrid - 0.5;
            float starDist = max(max(abs(starFract.x), abs(starFract.y)), abs(starFract.z));
            float isStarPixel = step(starDist, 0.35);

            float blink = floor(fract(uTime * 1.8 + starSeed * 20.0) * 4.0) / 4.0;
            float starBrightness = step(0.20, blink) * mix(0.7, 1.4, fract(starSeed * 7.7));

            sky += vec3(0.96, 0.98, 1.0) * isStarPixel * starBrightness * uStarVisibility;
          }
        }

        // Lua em Pixel Art Gótica com Crateras
        if (uMoonVisibility > 0.01) {
          vec3 normMoonDir = normalize(uMoonDir);
          float moonForward = dot(ray, normMoonDir);

          if (moonForward > 0.86) {
            vec3 upRefM = abs(normMoonDir.y) > 0.88 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
            vec3 mPerp1 = normalize(cross(normMoonDir, upRefM));
            vec3 mPerp2 = cross(normMoonDir, mPerp1);
            vec2 moonPlane = vec2(dot(ray, mPerp1), dot(ray, mPerp2));

            float moonGridRes = 320.0 * uPixelScale;
            vec2 moonTexel = floor(moonPlane * moonGridRes + 0.5);
            vec2 moonQuant = moonTexel / moonGridRes;
            float moonDist = length(moonQuant);

            if (moonDist < 0.068) {
              float crater = step(0.54, noise2D(moonQuant * 48.0));
              vec3 moonFace = mix(vec3(0.96, 0.98, 1.0), vec3(0.66, 0.74, 0.88), crater * 0.65);
              sky = mix(sky, moonFace, uMoonVisibility);
            } else if (moonDist < 0.115) {
              float mDither = (bayer4x4(moonTexel) - 0.5) * 0.015;
              float isHalo = step(moonDist + mDither, 0.115);
              sky = mix(sky, vec3(0.55, 0.70, 0.95), isHalo * 0.35 * uMoonVisibility);
            }
          }
        }

        // 4. SISTEMA VOLUMÉTRICO DE NUVENS CÚMULUS EM 2 CAMADAS 3D (PIXEL ART RETRO)
        // Camada 1: Base / Sombra / Volume inferior (cor escura/sombra, sem o branco puro)
        // Camada 2: Cristas e Volume Iluminado Superior em camada 3D separada com paralaxe volumétrico
        if (height > 0.02 && uCloudCoverage > 0.05) {
          float planeH = max(height, 0.08);
          float hFade = smoothstep(0.04, 0.16, height);
          float coverageThresh = mix(0.58, 0.38, uCloudCoverage);
          vec2 sunDir2D = normalize(normSunDir.xz + vec2(0.001, 0.001));
          float cloudGridRes = 320.0 * uPixelScale;

          // =========================================================================
          // CAMADA 1: BASE E CORPO INFERIOR (SOMBRA E BASE DAS NUVENS)
          // =========================================================================
          vec2 planeUV1 = (ray.xz / planeH) * 0.32 + uWindOffset + uCameraPos.xz * 0.00008;
          vec2 cloudTexel1 = floor(planeUV1 * cloudGridRes);
          vec2 pixelUV1 = cloudTexel1 / cloudGridRes;

          float macroMask1 = noise2D(pixelUV1 * 0.45 + vec2(4.1, 7.8)) * 0.5 + 0.5;
          float billowVal1 = billowFBM(pixelUV1);
          float cloudShape1 = billowVal1 * (0.35 + 0.65 * macroMask1);
          float cloudDensity1 = (cloudShape1 - coverageThresh) / max(1.0 - coverageThresh, 0.001);

          if (cloudDensity1 > 0.0 && hFade > 0.01) {
            // Sombra direcional da base
            // Deslocamento da sombra e dither medidos na grade PADRÃO (320), não na grade escalada:
            // senão a sombra afinava e o dither virava hachura conforme o pixel diminuía.
            vec2 shadowUV1 = pixelUV1 - sunDir2D * (2.5 / 320.0);
            float shadowShape1 = billowFBM(shadowUV1) * (0.35 + 0.65 * macroMask1);
            float shadowDensity1 = (shadowShape1 - coverageThresh) / max(1.0 - coverageThresh, 0.001);

            float cDither1 = (bayer4x4(floor(planeUV1 * 320.0)) - 0.5) * 0.12;
            float isShadow1 = 1.0 - step(0.18 + cDither1, shadowDensity1);

            // Camada 1: tom de sombra/base periwinkle característico do estilo cel-shaded
            vec3 cloudBaseTone = mix(uCloudShadowColor, mix(uCloudShadowColor, uCloudColor, 0.30), 0.60);
            vec3 layer1Color = isShadow1 > 0.5 ? uCloudShadowColor : cloudBaseTone;

            sky = mix(sky, layer1Color, hFade);
          }

          // =========================================================================
          // CAMADA 2: CRISTAS E CORPO ILUMINADO 3D (SOMENTE A PARTE MAIS CLARA)
          // Altitude superior com deslocamento de paralaxe 3D e iluminação solar
          // =========================================================================
          // Deslocamento de paralaxe 3D: a camada superior desloca-se em direção ao zênite e ao sol
          float pFactor = clamp(1.0 / planeH, 1.0, 3.8);
          vec2 parallax3D = - (ray.xz / planeH) * 0.028 - sunDir2D * 0.018;
          vec2 planeUV2 = (ray.xz / planeH) * 0.32 + uWindOffset2 + uCameraPos.xz * 0.00010 + parallax3D;

          vec2 cloudTexel2 = floor(planeUV2 * cloudGridRes);
          vec2 pixelUV2 = cloudTexel2 / cloudGridRes;

          float macroMask2 = noise2D(pixelUV2 * 0.45 + vec2(4.1, 7.8)) * 0.5 + 0.5;
          float billowVal2 = billowFBM(pixelUV2);
          float cloudShape2 = billowVal2 * (0.35 + 0.65 * macroMask2);
          float cloudDensity2 = (cloudShape2 - coverageThresh) / max(1.0 - coverageThresh, 0.001);

          // Dither Bayer 4x4 para a borda da camada clara
          float cDither2 = (bayer4x4(floor(planeUV2 * 320.0)) - 0.5) * 0.12;

          // A camada 2 renderiza exclusivamente a parte mais clara (creme/branco iluminado)
          float isHighlight2 = step(0.15 + cDither2, cloudDensity2);

          if (cloudDensity2 > 0.0 && isHighlight2 > 0.5 && hFade > 0.01) {
            // Nuance sutil entre o branco puro e tom claro para dar volume aos tufos
            float innerPeak = step(0.36 + cDither2, cloudDensity2);
            vec3 layer2Color = mix(mix(uCloudColor, uCloudShadowColor, 0.12), uCloudColor, innerPeak);

            // Realce cel solar na borda da crista iluminada
            float sunFacing = dot(ray, normSunDir);
            float isSunRim = step(0.60, sunFacing);
            float sunsetGlow = clamp((0.45 - normSunDir.y) * 2.5, 0.0, 1.0);
            if (isSunRim > 0.5) {
              layer2Color = mix(layer2Color, uCoronaColor, sunsetGlow * 0.55);
            }

            // A camada 2 compõe por cima da camada 1 (e do céu onde a crista projeta além da base)
            sky = mix(sky, layer2Color, hFade);
          }
        }

        // 5. Transição Suave com o Fog Costeiro no Horizonte
        float hFog = 1.0 - clamp((height + 0.01) / 0.09, 0.0, 1.0);
        float qFog = floor(clamp(hFog + snesDither * 0.15, 0.0, 1.0) * 4.0) / 4.0;
        sky = mix(sky, uFogColor, clamp(qFog * 0.65, 0.0, 1.0));

        gl_FragColor = vec4(sky, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uZenithColor: { value: new THREE.Color('#1e6ece') },
        uHorizonColor: { value: new THREE.Color('#92ccf8') },
        uGroundColor: { value: new THREE.Color('#78b0db') },
        uCloudColor: { value: new THREE.Color('#ffffff') },
        uCloudShadowColor: { value: new THREE.Color('#b3d3f5') },
        uSunColor: { value: new THREE.Color('#fffdf0') },
        uCoronaColor: { value: new THREE.Color('#ffe28a') },
        uFogColor: { value: new THREE.Color('#b0d2ee') },
        uStarVisibility: { value: 0.0 },
        uMoonVisibility: { value: 0.0 },
        uCloudCoverage: { value: 0.72 },
        uWindOffset: { value: new THREE.Vector2(0, 0) },
        uWindOffset2: { value: new THREE.Vector2(0, 0) },
        uCameraPos: { value: new THREE.Vector3(0, 0, 0) },
        uPixelScale: { value: 1.0 }
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1000;
  }

  public getMesh(): THREE.Mesh {
    return this.mesh;
  }

  public setPixelScale(scale: number): void {
    // Acima de ~2.5x os pixels do céu ficam menores que os pixels da tela e passam a cintilar.
    this.material.uniforms.uPixelScale.value = Math.min(scale, 2.5);
  }

  public getMoonDirection(): THREE.Vector3 {
    return this.currentMoonDir.clone();
  }

  public syncWithPreset(preset: TimePreset, sunDir: THREE.Vector3): void {
    this.currentSunDir.copy(sunDir);

    // Lua posicionada no céu noturno com elevação alta (~40°)
    const moonElevation = Math.max(0.62, -sunDir.y * 0.85 + 0.35);
    this.currentMoonDir.set(-sunDir.x, moonElevation, -sunDir.z).normalize();

    const zenith = preset.zenithColor || (preset.name.includes('Noite') ? '#070d1e' : preset.name.includes('Pôr') ? '#4f3b75' : preset.name.includes('Crep') ? '#22193b' : preset.skyColor);
    const horizon = preset.horizonColor || (preset.name.includes('Noite') ? '#121f3b' : preset.name.includes('Pôr') ? '#ff8243' : preset.name.includes('Crep') ? '#b84f6a' : preset.fogColor);
    const cloudCol = preset.cloudColor || (preset.name.includes('Noite') ? '#2a3a58' : preset.name.includes('Pôr') ? '#ffe2bf' : '#ffffff');
    const cloudShad = preset.cloudShadowColor || (preset.name.includes('Noite') ? '#0e1625' : preset.name.includes('Pôr') ? '#a05474' : '#bed7ef');
    const sunCol = preset.sunDiskColor || preset.sunColor || '#fffdf0';
    const coronaCol = preset.sunCoronaColor || (preset.name.includes('Pôr') ? '#ff6f3c' : '#ffe28a');
    const starVis = preset.starVisibility !== undefined ? preset.starVisibility : (preset.name.includes('Noite') ? 1.0 : preset.name.includes('Crep') ? 0.6 : 0.0);
    const moonVis = preset.moonVisibility !== undefined ? preset.moonVisibility : (preset.name.includes('Noite') ? 1.0 : preset.name.includes('Crep') ? 0.5 : 0.0);
    const cloudCov = preset.cloudCoverage !== undefined ? preset.cloudCoverage : 0.72;

    this.targetZenithColor.set(zenith);
    this.targetHorizonColor.set(horizon);
    this.targetGroundColor.set(preset.ambientColor);
    this.targetCloudColor.set(cloudCol);
    this.targetCloudShadowColor.set(cloudShad);
    this.targetSunColor.set(sunCol);
    this.targetCoronaColor.set(coronaCol);
    this.targetFogColor.set(preset.fogColor);
    this.targetStarVis = starVis;
    this.targetMoonVis = moonVis;
    this.targetCloudCoverage = cloudCov;
  }

  public update(delta: number, cameraPosition: THREE.Vector3): void {
    this.mesh.position.copy(cameraPosition);

    this.windOffset.x = (this.windOffset.x + this.windSpeed.x * delta) % 1000.0;
    this.windOffset.y = (this.windOffset.y + this.windSpeed.y * delta) % 1000.0;

    // Vento da camada superior (shear de altitude sutil de 12%)
    this.windOffset2.x = (this.windOffset2.x + this.windSpeed.x * 1.12 * delta) % 1000.0;
    this.windOffset2.y = (this.windOffset2.y + this.windSpeed.y * 1.12 * delta) % 1000.0;

    const lerpSpeed = Math.min(delta * 4.0, 1.0);
    this.currentZenithColor.lerp(this.targetZenithColor, lerpSpeed);
    this.currentHorizonColor.lerp(this.targetHorizonColor, lerpSpeed);
    this.currentGroundColor.lerp(this.targetGroundColor, lerpSpeed);
    this.currentCloudColor.lerp(this.targetCloudColor, lerpSpeed);
    this.currentCloudShadowColor.lerp(this.targetCloudShadowColor, lerpSpeed);
    this.currentSunColor.lerp(this.targetSunColor, lerpSpeed);
    this.currentCoronaColor.lerp(this.targetCoronaColor, lerpSpeed);
    this.currentFogColor.lerp(this.targetFogColor, lerpSpeed);
    this.currentStarVis += (this.targetStarVis - this.currentStarVis) * lerpSpeed;
    this.currentMoonVis += (this.targetMoonVis - this.currentMoonVis) * lerpSpeed;
    this.currentCloudCoverage += (this.targetCloudCoverage - this.currentCloudCoverage) * lerpSpeed;

    const u = this.material.uniforms;
    u.uTime.value += delta;
    u.uSunDir.value.copy(this.currentSunDir);
    u.uMoonDir.value.copy(this.currentMoonDir);
    u.uZenithColor.value.copy(this.currentZenithColor);
    u.uHorizonColor.value.copy(this.currentHorizonColor);
    u.uGroundColor.value.copy(this.currentGroundColor);
    u.uCloudColor.value.copy(this.currentCloudColor);
    u.uCloudShadowColor.value.copy(this.currentCloudShadowColor);
    u.uSunColor.value.copy(this.currentSunColor);
    u.uCoronaColor.value.copy(this.currentCoronaColor);
    u.uFogColor.value.copy(this.currentFogColor);
    u.uStarVisibility.value = this.currentStarVis;
    u.uMoonVisibility.value = this.currentMoonVis;
    u.uCloudCoverage.value = this.currentCloudCoverage;
    u.uWindOffset.value.copy(this.windOffset);
    u.uWindOffset2.value.copy(this.windOffset2);
    u.uCameraPos.value.copy(cameraPosition);
  }
}
