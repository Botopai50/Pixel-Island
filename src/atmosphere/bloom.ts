import * as THREE from 'three';

/**
 * Bloom suave só no que brilha de verdade: lava, vaga-lumes, brasas, o sol. Pega da cena opaca
 * os pixels muito claros E de cor forte (neve, nuvens e céu branco ficam de fora: são claros mas
 * sem saturação), espalha em um quarto da resolução com um desfoque largo e soma por cima da
 * imagem final, de leve.
 */
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const STRENGTH = 0.55;

export class Bloom {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private addMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, type: THREE.HalfFloatType };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        vec3 pick(vec2 uv) {
          vec3 c = texture2D(tSrc, uv).rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float sat = (mx - mn) / max(mx, 1e-3);
          // só cores quentes ou verdes (lava, brasas, vaga-lumes, sol): o céu e a névoa azul/ciano claros
          // passavam no corte de brilho e saturação e o céu ficava borrado de brilho
          float warm = 1.0 - smoothstep(0.0, 0.06, c.b - c.r);
          return c * smoothstep(0.62, 0.95, mx) * smoothstep(0.35, 0.7, sat) * warm;
        }
        void main() {
          // média de 4 amostras (o alvo tem 1/4 da resolução)
          vec3 s = pick(vUv + uTexel * vec2(-1.0, -1.0)) + pick(vUv + uTexel * vec2(1.0, -1.0))
                 + pick(vUv + uTexel * vec2(-1.0, 1.0)) + pick(vUv + uTexel * vec2(1.0, 1.0));
          gl_FragColor = vec4(s * 0.25, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 s = texture2D(tSrc, vUv).rgb * 0.20;
          s += (texture2D(tSrc, vUv + uDir * 1.5).rgb + texture2D(tSrc, vUv - uDir * 1.5).rgb) * 0.18;
          s += (texture2D(tSrc, vUv + uDir * 3.5).rgb + texture2D(tSrc, vUv - uDir * 3.5).rgb) * 0.13;
          s += (texture2D(tSrc, vUv + uDir * 5.5).rgb + texture2D(tSrc, vUv - uDir * 5.5).rgb) * 0.075;
          s += (texture2D(tSrc, vUv + uDir * 7.5).rgb + texture2D(tSrc, vUv - uDir * 7.5).rgb) * 0.025;
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.addMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uAmt: { value: STRENGTH } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform float uAmt; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uAmt, 1.0); }`,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Extrai e espalha o brilho da cena opaca (chamar depois de desenhá-la). */
  public render(renderer: THREE.WebGLRenderer, sceneTex: THREE.Texture, w: number, h: number): void {
    const qw = Math.max(1, Math.floor(w / 4)), qh = Math.max(1, Math.floor(h / 4));
    if (this.rtA.width !== qw || this.rtA.height !== qh) { this.rtA.setSize(qw, qh); this.rtB.setSize(qw, qh); }
    const prev = renderer.getRenderTarget();
    this.brightMat.uniforms.tSrc.value = sceneTex;
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.quad.material = this.brightMat;
    renderer.setRenderTarget(this.rtA); renderer.render(this.scene, this.cam);
    this.quad.material = this.blurMat;
    for (let pass = 0; pass < 2; pass++) {
      this.blurMat.uniforms.tSrc.value = this.rtA.texture;
      this.blurMat.uniforms.uDir.value.set(1 / qw, 0);
      renderer.setRenderTarget(this.rtB); renderer.render(this.scene, this.cam);
      this.blurMat.uniforms.tSrc.value = this.rtB.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1 / qh);
      renderer.setRenderTarget(this.rtA); renderer.render(this.scene, this.cam);
    }
    renderer.setRenderTarget(prev);
  }

  /** Soma o brilho por cima da imagem final (alvo atual = tela). */
  public composite(renderer: THREE.WebGLRenderer): void {
    this.addMat.uniforms.tSrc.value = this.rtA.texture;
    this.quad.material = this.addMat;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = prevAuto;
  }
}
