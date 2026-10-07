import * as THREE from 'three';

/**
 * Luz volumétrica do sol (feixes no ar, como nos jogos com "god rays volumétricos").
 *
 * Em meia resolução, cada pixel caminha pelo ar da câmera até o que está na tela (no máximo
 * MAX_DIST metros), em STEPS passos com início sorteado por pixel, e em cada passo pergunta ao
 * mapa de sombra do sol se aquele ponto do ar está iluminado: a faixa de perto (35m) do clipmap
 * de sombras e, além dela, a do meio (200m). A luz acumulada no ar iluminado, com uma função de
 * espalhamento que favorece olhar para o sol (Henyey-Greenstein), forma os feixes entre as árvores
 * e os morros - mesmo com o sol fora da tela. Um desfoque curto tira o ruído do sorteio; o resultado
 * é somado à imagem final (sunFX.ts).
 */
const STEPS = 24;
const MAX_DIST = 160;
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class VolumetricLight {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private marchMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** ligada/desligada (tecla V em main.ts) */
  public enabled = true;
  /** força atual (0 sem sol ou desligada) */
  public amount = 0;

  constructor() {
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, type: THREE.HalfFloatType };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.marchMat = new THREE.ShaderMaterial({
      defines: { STEPS, MAX_DIST: MAX_DIST.toFixed(1) },
      uniforms: {
        tDepth: { value: null }, tShadow0: { value: null }, tShadow1: { value: null },
        uShadowMat0: { value: new THREE.Matrix4() }, uShadowMat1: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFrame: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: THREE.ShaderChunk.packing + /* glsl */ `
        uniform sampler2D tDepth; uniform sampler2D tShadow0; uniform sampler2D tShadow1;
        uniform mat4 uShadowMat0; uniform mat4 uShadowMat1; uniform mat4 uInvProj; uniform mat4 uInvView;
        uniform vec3 uCamPos; uniform vec3 uSunDir; uniform float uFrame;
        varying vec2 vUv;
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        // 1 = ar iluminado pelo sol, 0 = na sombra (faixa de perto e, fora dela, a do meio)
        float litAt(vec3 q) {
          vec4 c0 = uShadowMat0 * vec4(q, 1.0);
          if (c0.x > 0.01 && c0.x < 0.99 && c0.y > 0.01 && c0.y < 0.99 && c0.z < 1.0)
            return step(c0.z - 0.0015, unpackRGBAToDepth(texture2D(tShadow0, c0.xy)));
          vec4 c1 = uShadowMat1 * vec4(q, 1.0);
          if (c1.x > 0.005 && c1.x < 0.995 && c1.y > 0.005 && c1.y < 0.995 && c1.z < 1.0)
            return step(c1.z - 0.003, unpackRGBAToDepth(texture2D(tShadow1, c1.xy)));
          return 1.0;
        }
        void main() {
          float d = texture2D(tDepth, vUv).x;
          vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, min(d, 0.9999) * 2.0 - 1.0, 1.0);
          vec3 Pw = (uInvView * vec4(v.xyz / v.w, 1.0)).xyz;
          vec3 rd = Pw - uCamPos;
          float len = length(rd);
          rd /= max(len, 1e-4);
          float dist = d >= 0.99999 ? MAX_DIST : min(len, MAX_DIST);
          float ds = dist / float(STEPS);
          float t = ds * ign(gl_FragCoord.xy + uFrame * 5.588238);
          float lit = 0.0;
          for (int i = 0; i < STEPS; i++) {
            lit += litAt(uCamPos + rd * t);
            t += ds;
          }
          // fração do caminho no ar iluminado (0-1), pesada pelo comprimento do caminho
          float frac = lit / float(STEPS) * (dist / MAX_DIST);
          // espalhamento: forte olhando para o sol, fraco de lado
          float g = 0.68, cosT = dot(rd, uSunDir);
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) / 12.566;
          // (o realce na direção do sol é contido: com o céu aberto todo o ar está iluminado e ele
          // virava um clarão enorme em volta do sol)
          gl_FragColor = vec4(vec3(frac * (0.04 + 0.18 * min(hg, 0.6))), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    // desfoque curto (tira o ruído do início sorteado de cada pixel)
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          float s = texture2D(tSrc, vUv).r * 0.28;
          s += (texture2D(tSrc, vUv + uDir).r + texture2D(tSrc, vUv - uDir).r) * 0.22;
          s += (texture2D(tSrc, vUv + uDir * 2.0).r + texture2D(tSrc, vUv - uDir * 2.0).r) * 0.14;
          gl_FragColor = vec4(vec3(s), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.marchMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  public get texture(): THREE.Texture { return this.rtA.texture; }

  /**
   * Calcula a luz no ar. lights: as luzes do clipmap de sombras (0 = perto, 1 = meio);
   * strength: 0-1 (sol acima do horizonte, sem céu encoberto, primeira pessoa).
   */
  public render(renderer: THREE.WebGLRenderer, depth: THREE.DepthTexture, camera: THREE.Camera,
    lights: THREE.DirectionalLight[], sunDir: THREE.Vector3, w: number, h: number, strength: number): void {
    this.amount = this.enabled ? strength : 0;
    if (this.amount < 0.01 || lights.length < 2 || !lights[0].shadow.map || !lights[1].shadow.map) { this.amount = 0; return; }
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    if (this.rtA.width !== hw || this.rtA.height !== hh) { this.rtA.setSize(hw, hh); this.rtB.setSize(hw, hh); }
    const cam = camera as THREE.PerspectiveCamera;
    const u = this.marchMat.uniforms;
    u.tDepth.value = depth;
    u.tShadow0.value = lights[0].shadow.map.texture;
    u.tShadow1.value = lights[1].shadow.map.texture;
    u.uShadowMat0.value.copy(lights[0].shadow.matrix);
    u.uShadowMat1.value.copy(lights[1].shadow.matrix);
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uInvView.value.copy(cam.matrixWorld);
    u.uCamPos.value.copy(cam.position);
    u.uSunDir.value.copy(sunDir).normalize();
    u.uFrame.value = (u.uFrame.value + 1) % 64;
    const prev = renderer.getRenderTarget();
    this.quad.material = this.marchMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.cam);
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tSrc.value = this.rtA.texture;
    this.blurMat.uniforms.uDir.value.set(1 / hw, 0);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.cam);
    this.blurMat.uniforms.tSrc.value = this.rtB.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / hh);
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }
}
