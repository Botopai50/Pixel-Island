import * as THREE from 'three';

/**
 * Reflexo das poças em espaço de tela. O terreno marca as poças no canal alfa da imagem da cena
 * opaca (alfa = 1 - 0.5 * poça; o resto da cena tem alfa 1). Este passe, para cada pixel de poça,
 * lança o raio refletido (a poça é um espelho horizontal) pela própria imagem: anda em passos
 * crescentes, projeta cada ponto na tela e para onde passa atrás do que o depth mostra - a cor dali
 * é o reflexo (copa, tronco, morro). Se o raio sai pelo céu, reflete o céu daquele ponto da tela.
 * Lido no centro do pixel grande da poça, para o reflexo continuar pixel art.
 */
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class PuddleSSR {
  private rt: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSky: { value: new THREE.Color() },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene; uniform sampler2D tDepth;
        uniform mat4 uProj; uniform mat4 uInvProj; uniform mat4 uView; uniform mat4 uInvView;
        uniform vec3 uCamPos; uniform vec3 uSky; uniform float uTime;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // cor ao redor de um ponto da tela (borrada): o reflexo difuso, como o do mar
        vec3 blurAt(vec2 uv) {
          vec2 o = vec2(0.006, 0.0045);
          return (texture2D(tScene, uv).rgb * 2.0
            + texture2D(tScene, uv + vec2(o.x, 0.0)).rgb + texture2D(tScene, uv - vec2(o.x, 0.0)).rgb
            + texture2D(tScene, uv + vec2(0.0, o.y)).rgb + texture2D(tScene, uv - vec2(0.0, o.y)).rgb
            + texture2D(tScene, uv + o).rgb + texture2D(tScene, uv - o).rgb) / 8.0;
        }
        varying vec2 vUv;
        vec3 viewPosAt(vec2 uv, float d) {
          vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return v.xyz / v.w;
        }
        void main() {
          vec4 s = texture2D(tScene, vUv);
          float d = texture2D(tDepth, vUv).x;
          // no céu o alfa é a nuvem (skybox.ts), não poça
          float m = d >= 0.99999 ? 0.0 : clamp((1.0 - s.a) * 2.0, 0.0, 1.0);
          if (m < 0.02) { gl_FragColor = vec4(s.rgb, 1.0); return; }
          vec3 Pw = (uInvView * vec4(viewPosAt(vUv, d), 1.0)).xyz;
          vec3 V = normalize(uCamPos - Pw);
          // superfície levemente ondulada: ondinhas suaves e contínuas entortam o reflexo de forma
          // fluida (antes eram quadradinhos sorteados de ~25cm, que viravam um mosaico de blocos)
          vec2 q = Pw.xz;
          vec2 wob = vec2(
            sin(q.x * 2.7 + q.y * 1.3 + uTime * 1.4) + sin(q.x * -1.1 + q.y * 3.3 - uTime * 1.1),
            sin(q.y * 2.9 - q.x * 1.7 + uTime * 1.2) + sin(q.x * 3.1 + q.y * 0.9 + uTime * 0.8)) * 0.5;
          vec3 N = normalize(vec3(wob.x * 0.05, 1.0, wob.y * 0.05));
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.02);
          // fora da tela: a cor do ar, mais apagada (não sabemos o que há ali)
          vec3 hitCol = uSky * 0.7;
          float t = 0.25;
          vec2 lastUv = vec2(-1.0);
          bool hit = false;
          for (int i = 0; i < 32; i++) {
            vec3 Q = Pw + R * t;
            vec4 qv = uView * vec4(Q, 1.0);
            vec4 c = uProj * qv;
            if (c.w <= 0.0) break;
            vec2 uv = c.xy / c.w * 0.5 + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            lastUv = uv;
            float sd = texture2D(tDepth, uv).x;
            if (sd < 0.99999) {
              float sceneDist = -viewPosAt(uv, sd).z;
              float rayDist = -qv.z;
              if (sceneDist < rayDist && rayDist - sceneDist < max(0.6, t * 0.35)) {
                hitCol = blurAt(uv);
                hit = true;
                break;
              }
            }
            t *= 1.17;
          }
          // sem bater em nada: o céu daquele ponto da tela (se o raio ficou na tela), senão a cor do ar
          if (!hit && lastUv.x >= 0.0 && texture2D(tDepth, lastUv).x >= 0.99999) hitCol = blurAt(lastUv);
          float fres = 0.12 + 0.5 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          gl_FragColor = vec4(mix(s.rgb, hitCol * 0.85, fres * m), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
  }

  /** Aplica o reflexo e devolve a textura resultante (a usar no lugar da cena opaca). */
  public render(renderer: THREE.WebGLRenderer, scene: THREE.WebGLRenderTarget, camera: THREE.Camera, sky: THREE.Color): THREE.Texture {
    if (this.rt.width !== scene.width || this.rt.height !== scene.height) this.rt.setSize(scene.width, scene.height);
    const u = this.mat.uniforms;
    const cam = camera as THREE.PerspectiveCamera;
    u.tScene.value = scene.texture;
    u.tDepth.value = scene.depthTexture;
    u.uProj.value.copy(cam.projectionMatrix);
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uView.value.copy(cam.matrixWorldInverse);
    u.uInvView.value.copy(cam.matrixWorld);
    u.uCamPos.value.copy(cam.position);
    u.uSky.value.copy(sky);
    u.uTime.value = performance.now() / 1000 % 3600;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
    return this.rt.texture;
  }
}
