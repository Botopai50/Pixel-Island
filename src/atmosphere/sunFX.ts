import * as THREE from 'three';

/**
 * God rays e lens flare em pixel art, por cima da imagem final.
 *
 * God rays: o clássico dos jogos. Num quarto da resolução, marca a luz do sol onde o céu aparece
 * (pelo depth da cena opaca: o que não é céu fica preto) e espalha em raios na direção do sol na
 * tela (desfoque radial com decaimento). Árvores e montanhas na frente recortam os feixes. Suaves,
 * somados direto na imagem.
 *
 * Lens flare: a partir do sol na tela, elementos ao longo da reta sol -> centro da tela (discos,
 * um anel e um hexágono, em tons quentes e frios) e um brilho horizontal no próprio sol. Some
 * quando o sol está tampado (amostras do depth em volta dele).
 *
 * O flare é desenhado no estilo do jogo: numa grade de pixels grandes (cada um acende inteiro),
 * com a intensidade em poucos degraus e pontilhado entre eles. Soma por cima da
 * imagem final (cores da tela), depois da água e do FXAA.
 */

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const RAY_SAMPLES = 64;

export class SunFX {
  private rtMask: THREE.WebGLRenderTarget;
  private rtRays: THREE.WebGLRenderTarget;
  private maskMat: THREE.ShaderMaterial;
  private raysMat: THREE.ShaderMaterial;
  private overlayMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private active = false;
  private _v = new THREE.Vector3();
  /** visibilidade suavizada (entra e sai em ~0.3s, sem piscar) */
  private strength = 0;
  /** cobertura de nuvens do céu (main.ts atualiza a cada quadro) */
  public cloudCover = 0;
  /** luz volumétrica a somar (main.ts liga a textura e a força a cada quadro) */
  public volTex: THREE.Texture | null = null;
  public volAmt = 0;

  constructor() {
    // meio-float: a razão entre os canais (luz que passa / luz total) precisa de precisão
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, type: THREE.HalfFloatType };
    this.rtMask = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtRays = new THREE.WebGLRenderTarget(4, 4, opts);

    // céu perto do sol (o resto tampa a luz)
    this.maskMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, tScene: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth; uniform sampler2D tScene; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
        void main() {
          // céu sem nuvem (o alfa do céu é a nuvem, skybox.ts): nuvem tampa a luz como o relevo
          float sky = step(0.99999, texture2D(tDepth, vUv).x) * (1.0 - clamp((1.0 - texture2D(tScene, vUv).a) * 2.0, 0.0, 1.0));
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          // fonte de luz: o disco do sol forte e um pouco do céu em volta; o que não é céu é preto
          float L = length(d);
          // pouco do disco do sol e bastante do céu em volta: a luz dos raios fica mais uniforme
          float src = pow(max(0.0, 1.0 - L / 0.22), 3.0) * 0.35 + pow(max(0.0, 1.0 - L / 1.0), 1.2) * 0.35;
          gl_FragColor = vec4(vec3(sky * src), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    // desfoque radial na direção do sol
    this.raysMat = new THREE.ShaderMaterial({
      defines: { SAMPLES: RAY_SAMPLES },
      uniforms: { tMask: { value: null }, uSun: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMask; uniform vec2 uSun; varying vec2 vUv;
        void main() {
          // desfoque radial clássico (GPU Gems 3, "Volumetric Light Scattering as a Post-Process")
          const float density = 0.96, weight = 0.55, decayK = 0.98, exposure = 0.035;
          vec2 delta = (vUv - uSun) * (density / float(SAMPLES));
          vec2 uv = vUv;
          float illum = 1.0, sum = 0.0;
          for (int i = 0; i < SAMPLES; i++) {
            uv -= delta;
            sum += texture2D(tMask, uv).r * illum * weight;
            illum *= decayK;
          }
          gl_FragColor = vec4(vec3(sum * exposure), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    // raios + flare em pixels grandes, somados à imagem final
    this.overlayMat = new THREE.ShaderMaterial({
      uniforms: {
        tRays: { value: null }, tDepth: { value: null }, tScene: { value: null },
        uSun: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(1, 1) },
        uPix: { value: 3 }, uRayCol: { value: new THREE.Color() }, uRayAmt: { value: 0 },
        uFlareAmt: { value: 0 },
        uOvercast: { value: 0 },
        tVol: { value: null }, uVolAmt: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tRays; uniform sampler2D tDepth; uniform sampler2D tScene;
        uniform vec2 uSun; uniform vec2 uRes; uniform float uPix;
        uniform vec3 uRayCol; uniform float uRayAmt; uniform float uFlareAmt; uniform float uOvercast;
        uniform sampler2D tVol; uniform float uVolAmt;
        varying vec2 vUv;

        // degraus com pontilhado (Bayer 2x2 nos pixels grandes)
        float stepped(float a, vec2 cell, float levels) {
          vec2 cc = mod(cell, 2.0);
          float bay = (cc.x * 2.0 + cc.y * 3.0 - 4.0 * cc.x * cc.y) / 4.0;
          return floor(a * levels + bay) / levels;
        }
        float hexDist(vec2 p) {
          p = abs(p);
          return max(p.x * 0.866 + p.y * 0.5, p.y);
        }

        void main() {
          vec2 cell = floor(gl_FragCoord.xy / uPix);
          vec2 cp = (cell + 0.5) * uPix;                  // centro do pixel grande (px da tela)
          vec2 cuv = cp / uRes;
          vec3 col = vec3(0.0);

          // em volta do sol: vis = quanto dele está à vista (nem relevo nem nuvem na frente: o flare);
          // cloudFree = quanto dele está livre de nuvem (árvore/relevo na frente ainda fazem feixes)
          float vis = 0.0, cloudFree = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 suv = clamp(uSun + vec2(float(i), float(j)) * vec2(0.008 * uRes.y / uRes.x, 0.008), 0.001, 0.999);
            float isSky = step(0.99999, texture2D(tDepth, suv).x);
            float cloud = isSky * clamp((1.0 - texture2D(tScene, suv).a) * 2.0, 0.0, 1.0);
            vis += isSky * (1.0 - cloud);
            cloudFree += 1.0 - cloud;
          }
          vis /= 9.0;
          cloudFree /= 9.0;
          // céu fechado: tampado mesmo onde o sol está atrás de árvore/relevo (ali não se vê a nuvem)
          cloudFree *= 1.0 - uOvercast;
          vis *= 1.0 - uOvercast;

          // god rays: suaves, como nos jogos (somados direto, sem degraus). No céu aberto bem mais
          // fracos (senão viram um clarão em volta do sol); por cima de árvores e relevo, inteiros.
          // Sol atrás de nuvem: sem raios (o céu aberto em volta não basta)
          float skyHere = step(0.99999, texture2D(tDepth, vUv).x);
          // curva comprimida (raiz): o forte perto do sol cai e o fraco por cima das árvores sobe
          float ray = pow(max(texture2D(tRays, vUv).r, 0.0), 0.75) * 0.75;
          // alcance na tela: os feixes somem longe do sol (sem isso a tela toda ganhava um véu claro
          // e o horizonte estourava olhando para o sol)
          vec2 dSun = (vUv - uSun) * vec2(uRes.x / uRes.y, 1.0);
          ray *= 1.0 - smoothstep(0.25, 0.85, length(dSun));
          col += uRayCol * ray * uRayAmt * mix(1.0, 0.45, skyHere) * cloudFree * cloudFree;
          // luz volumétrica (volumetricLight.ts): feixes no ar, mesmo com o sol fora da tela
          // sobre o céu bem mais fraca (o sol já tem o brilho dele); inteira sobre árvores e relevo
          col += mix(uRayCol, vec3(1.0, 0.92, 0.75), 0.3) * texture2D(tVol, vUv).r * uVolAmt * (1.0 - uOvercast) * mix(1.0, 0.3, skyHere);

          // flare só com o sol dentro da tela (fora dela as amostras caíam na borda da imagem)
          float inScr = step(0.0, uSun.x) * step(uSun.x, 1.0) * step(0.0, uSun.y) * step(uSun.y, 1.0);
          float flare = uFlareAmt * vis * inScr;
          if (flare > 0.001) {
            vec2 sunPx = uSun * uRes;
            vec2 centerPx = uRes * 0.5;
            vec2 axis = centerPx - sunPx;
            float sc = uRes.y / 540.0;                      // tamanhos pela altura da tela
            float f = 0.0; vec3 fc = vec3(0.0);
            // brilho horizontal no sol (anamórfico)
            vec2 ds = cp - sunPx;
            float streak = (1.0 - smoothstep(0.0, 260.0 * sc, abs(ds.x))) * (1.0 - smoothstep(0.0, 4.0 * sc, abs(ds.y)));
            fc += vec3(1.0, 0.92, 0.75) * streak * 0.55;
            // elementos ao longo da reta sol -> centro (e além)
            // disco quente pequeno
            vec2 p1 = sunPx + axis * 0.45; float d1 = length(cp - p1);
            fc += vec3(1.0, 0.75, 0.35) * (1.0 - step(10.0 * sc, d1)) * 0.30;
            // anel
            vec2 p2 = sunPx + axis * 0.8; float d2 = length(cp - p2);
            fc += vec3(0.55, 0.9, 1.0) * (1.0 - step(3.0 * sc, abs(d2 - 26.0 * sc))) * 0.22;
            // hexágono frio
            vec2 p3 = sunPx + axis * 1.25; float d3 = hexDist(cp - p3);
            fc += vec3(0.6, 0.75, 1.0) * (1.0 - step(18.0 * sc, d3)) * 0.16;
            // disco violeta grande e fraco
            vec2 p4 = sunPx + axis * 1.6; float d4 = length(cp - p4);
            fc += vec3(0.75, 0.55, 1.0) * (1.0 - step(34.0 * sc, d4)) * 0.10;
            // pontinho quente bem longe
            vec2 p5 = sunPx + axis * 1.95; float d5 = length(cp - p5);
            fc += vec3(1.0, 0.85, 0.5) * (1.0 - step(6.0 * sc, d5)) * 0.25;
            float lum = max(fc.r, max(fc.g, fc.b));
            if (lum > 0.0) col += fc / lum * stepped(lum * flare, cell, 4.0);
          }
          if (max(col.r, max(col.g, col.b)) <= 0.0) discard;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Calcula os raios (depois de desenhar a cena opaca). sunDir: direção do sol no mundo;
   * sunColor: cor do brilho do sol (a do céu); enabled: só em primeira pessoa.
   */
  public render(renderer: THREE.WebGLRenderer, depth: THREE.DepthTexture, sceneTex: THREE.Texture, camera: THREE.Camera,
    sunDir: THREE.Vector3, sunColor: THREE.Color, w: number, h: number, enabled: boolean, dt: number): void {
    // sol na tela
    const v = this._v.copy(camera.position).addScaledVector(sunDir, 5000).project(camera);
    const inFront = camera.getWorldDirection(new THREE.Vector3()).dot(sunDir) > 0.05;
    const sunUV = new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    // fora da tela some aos poucos (raios ainda entram com o sol logo fora da borda)
    const out = Math.max(Math.abs(v.x), Math.abs(v.y));
    const onScreen = inFront ? 1 - THREE.MathUtils.smoothstep(out, 1.0, 1.5) : 0;
    const up = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.12);
    const target = enabled ? onScreen * up : 0;
    this.strength += (target - this.strength) * (1 - Math.exp(-dt / 0.3));
    this.active = this.strength > 0.01;
    const ou = this.overlayMat.uniforms;
    ou.tVol.value = this.volTex;
    ou.uVolAmt.value = this.volAmt;
    ou.uOvercast.value = THREE.MathUtils.smoothstep(this.cloudCover, 0.75, 0.98);
    ou.uRes.value.set(w, h);
    ou.uRayCol.value.copy(sunColor);
    if (!this.active) {
      // sol fora da tela: sem raios nem flare, mas a luz volumétrica continua
      ou.uRayAmt.value = 0; ou.uFlareAmt.value = 0;
      return;
    }

    const qw = Math.max(1, Math.floor(w / 4)), qh = Math.max(1, Math.floor(h / 4));
    if (this.rtMask.width !== qw || this.rtMask.height !== qh) {
      this.rtMask.setSize(qw, qh);
      this.rtRays.setSize(qw, qh);
    }
    const prev = renderer.getRenderTarget();
    this.maskMat.uniforms.tDepth.value = depth;
    this.maskMat.uniforms.tScene.value = sceneTex;
    this.maskMat.uniforms.uSun.value.copy(sunUV);
    this.maskMat.uniforms.uAspect.value = w / h;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtMask);
    renderer.render(this.scene, this.cam);

    this.raysMat.uniforms.tMask.value = this.rtMask.texture;
    this.raysMat.uniforms.uSun.value.copy(sunUV);
    this.quad.material = this.raysMat;
    renderer.setRenderTarget(this.rtRays);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);

    const u = this.overlayMat.uniforms;
    u.tRays.value = this.rtRays.texture;
    u.tDepth.value = depth;
    u.tScene.value = sceneTex;
    u.uSun.value.copy(sunUV);
    u.uRes.value.set(w, h);
    u.uPix.value = h > 700 ? 3 : 2;
    u.uRayCol.value.copy(sunColor);
    u.uRayAmt.value = this.strength;
    u.uFlareAmt.value = this.strength;
    u.uOvercast.value = THREE.MathUtils.smoothstep(this.cloudCover, 0.75, 0.98);
  }

  /** Soma raios e flare à imagem final (chamar por último, com o alvo da tela). */
  public overlay(renderer: THREE.WebGLRenderer): void {
    if (!this.active && this.volAmt < 0.01) return;
    this.quad.material = this.overlayMat;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = prevAuto;
  }
}
