import * as THREE from 'three';

/**
 * Campo distante: o que está a mais de ~150-200 m (árvores dos degraus 2 e 3, o horizonte e os chunks longe) quase não muda de um quadro
 * para o seguinte, mas custava ~250 chamadas de desenho por quadro. Aqui ele é desenhado em TRÊS imagens (uma por tipo), cada uma refeita a
 * cada três quadros (uma por quadro, então o custo fica parelho), e as imagens são reaproveitadas:
 *   - a rotação da câmera é corrigida exatamente (a imagem é desenhada numa janela maior que a tela, com a mesma escala de pixels);
 *   - o deslocamento da câmera é corrigido pela profundidade guardada (paralaxe), então o erro fica abaixo de um pixel;
 *   - a imagem entra na cena por um triângulo em tela cheia que também escreve a profundidade, para o que está perto passar na frente.
 * Só liga quando o jogo está lento (ver main.ts); numa máquina rápida tudo é desenhado direto, como antes.
 */

/** estado compartilhado com o recorte das sombras (shadowClipmap.ts) */
export const FAR = {
  /** desenhando uma fatia do campo distante: os mapas de sombra não devem ser refeitos agora (os objetos de perto estão escondidos) */
  inPass: false,
  /** durante o desenho dos mapas de sombra os grupos distantes precisam estar visíveis (projetam sombra) */
  shadowBegin: (): void => {},
  shadowEnd: (): void => {},
};

const PAD = 0.15;   // margem da imagem em relação à tela (cada lado)

interface Pose {
  valid: boolean;
  frame: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vp: THREE.Matrix4;
  fwd: THREE.Vector3;
}

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uCol0, uCol1, uCol2;
uniform sampler2D uDep0, uDep1, uDep2;
uniform mat4 uVP0, uVP1, uVP2;
uniform vec3 uC0, uC1, uC2;
uniform vec3 uF0, uF1, uF2;
uniform vec3 uOn;           // 1 = esta imagem vale
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec2 uRes;
uniform vec3 uMainPos;
uniform vec3 uMainFwd;
uniform float uNear, uFar;

float linZ(float d) {
  float n = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - n * (uFar - uNear));
}
float outDepth(float z) {
  float n = (uFar + uNear) / (uFar - uNear) - 2.0 * uNear * uFar / ((uFar - uNear) * z);
  return n * 0.5 + 0.5;
}

bool fetchLayer(sampler2D cT, sampler2D dT, mat4 vp, vec3 c0, vec3 fwd, vec3 d, out vec3 rgb, out float dist, out float axis) {
  vec3 T = uMainPos - c0;
  vec4 h = vp * vec4(d, 0.0);
  if (h.w <= 0.0) return false;
  vec2 uv = h.xy / h.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return false;
  float z0 = texture2D(dT, uv).r;
  if (z0 >= 0.99999) return false;
  // paralaxe: a direção, vista de onde a imagem foi desenhada, em que o mesmo ponto aparece
  float r0 = linZ(z0) / max(dot(d, fwd), 0.2);
  vec3 d2 = normalize(d * r0 + T);
  h = vp * vec4(d2, 0.0);
  if (h.w <= 0.0) return false;
  uv = h.xy / h.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return false;
  float z = texture2D(dT, uv).r;
  if (z >= 0.99999) return false;
  float rad = linZ(z) / max(dot(d2, fwd), 0.2);
  vec3 V = d2 * rad - T;                 // do observador de agora até o ponto
  axis = dot(V, uMainFwd);
  if (axis <= uNear) return false;
  dist = length(V);
  rgb = texture2D(cT, uv).rgb;
  return true;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 p = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 vd = normalize(p.xyz / p.w);
  vec3 d = normalize(mat3(uCamWorld) * vd);
  vec3 best = vec3(0.0);
  float bestDist = 1e20, bestAxis = 0.0;
  vec3 rgb; float dist, axis;
  if (uOn.x > 0.5 && fetchLayer(uCol0, uDep0, uVP0, uC0, uF0, d, rgb, dist, axis) && dist < bestDist) { bestDist = dist; bestAxis = axis; best = rgb; }
  if (uOn.y > 0.5 && fetchLayer(uCol1, uDep1, uVP1, uC1, uF1, d, rgb, dist, axis) && dist < bestDist) { bestDist = dist; bestAxis = axis; best = rgb; }
  if (uOn.z > 0.5 && fetchLayer(uCol2, uDep2, uVP2, uC2, uF2, d, rgb, dist, axis) && dist < bestDist) { bestDist = dist; bestAxis = axis; best = rgb; }
  if (bestDist > 1e19) discard;
  gl_FragColor = vec4(best, 1.0);
  gl_FragDepth = clamp(outDepth(bestAxis), 0.0, 1.0);
}`;

export interface FarContainers {
  vegRoot: THREE.Object3D;
  nearPools: THREE.Object3D;
  farPools: THREE.Object3D;
  horizon: THREE.Object3D;
  chunks: THREE.Object3D;
}

export class FarLayer {
  public engaged = false;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly cam = new THREE.PerspectiveCamera();
  private rts: (THREE.WebGLRenderTarget | null)[] = [null, null, null];
  private readonly poses: Pose[] = [0, 1, 2].map(() => ({ valid: false, frame: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vp: new THREE.Matrix4(), fwd: new THREE.Vector3() }));
  private w = 0; private h = 0; private padX = 0; private padY = 0;
  private fov = 0; private aspect = 0; private near = 0; private far = 0;
  private padAngle = 0.08;
  private saved: boolean[] = [true, true, true];
  private readonly containers: THREE.Object3D[];
  private readonly _p = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _hidden: THREE.Object3D[] = [];
  private readonly _clear = new THREE.Color();
  /** chamado antes de desenhar a fatia dos chunks distantes (quem está longe passa para o grupo distante) */
  public onChunkSlice: () => void = () => {};

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer, private readonly c: FarContainers) {
    this.containers = [c.farPools, c.horizon, c.chunks];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const tex = () => ({ value: null as THREE.Texture | null });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: true, depthWrite: true, side: THREE.DoubleSide, fog: false,
      uniforms: {
        uCol0: tex(), uCol1: tex(), uCol2: tex(), uDep0: tex(), uDep1: tex(), uDep2: tex(),
        uVP0: { value: new THREE.Matrix4() }, uVP1: { value: new THREE.Matrix4() }, uVP2: { value: new THREE.Matrix4() },
        uC0: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3() }, uC2: { value: new THREE.Vector3() },
        uF0: { value: new THREE.Vector3() }, uF1: { value: new THREE.Vector3() }, uF2: { value: new THREE.Vector3() },
        uOn: { value: new THREE.Vector3(0, 0, 0) },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(1, 1) }, uMainPos: { value: new THREE.Vector3() }, uMainFwd: { value: new THREE.Vector3() },
        uNear: { value: 0.1 }, uFar: { value: 1000 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'far_layer_composite';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -999;     // logo depois do céu (-1000)
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    scene.add(this.mesh);
    FAR.shadowBegin = () => { if (this.engaged) this.containers.forEach((o, i) => { o.visible = this.saved[i]; }); };
    FAR.shadowEnd = () => { if (this.engaged) this.containers.forEach((o) => { o.visible = false; }); };
  }

  private alloc(w: number, h: number): void {
    for (let k = 0; k < 3; k++) { this.rts[k]?.dispose(); this.rts[k]?.depthTexture?.dispose(); }
    this.w = w; this.h = h;
    this.padX = Math.round(w * PAD); this.padY = Math.round(h * PAD);
    const W = w + 2 * this.padX, H = h + 2 * this.padY;
    for (let k = 0; k < 3; k++) {
      this.rts[k] = new THREE.WebGLRenderTarget(W, H, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
        depthBuffer: true, depthTexture: new THREE.DepthTexture(W, H, THREE.UnsignedIntType),
      });
      this.poses[k].valid = false;
    }
    this.material.uniforms.uRes.value.set(w, h);
  }

  public invalidate(): void { for (const p of this.poses) p.valid = false; }

  /**
   * Aquecimento: a primeira ativação aloca os 3 alvos de desenho (com textura de profundidade), compila o shader da composição e desenha as 3 fatias de uma
   * vez: ~200 ms num quadro só, na hora em que o jogo já está mais lento (a média cruzou ~10 ms). Feito uma vez, com o jogador parado, o custo some do jogo.
   */
  public warmUp(main: THREE.PerspectiveCamera, w: number, h: number, frame: number): void {
    if (this.begin(main, w, h, frame)) this.finish();
    void this.renderer.compileAsync(this.mesh, main, this.scene).catch(() => undefined);
  }

  /**
   * Chamar uma vez por quadro, antes do desenho principal (câmera em perspectiva). Refaz as fatias que precisam e prepara a composição.
   * Devolve true se o campo distante vai ser composto (quem chama esconde-os no desenho principal: já feito aqui; chame finish() depois).
   */
  public begin(main: THREE.PerspectiveCamera, w: number, h: number, frame: number): boolean {
    main.updateMatrixWorld();
    if (w !== this.w || h !== this.h || main.fov !== this.fov || main.aspect !== this.aspect || main.near !== this.near || main.far !== this.far) {
      if (w !== this.w || h !== this.h) this.alloc(w, h); else this.invalidate();
      this.fov = main.fov; this.aspect = main.aspect; this.near = main.near; this.far = main.far;
      const vh = THREE.MathUtils.degToRad(main.fov) / 2, tanV = Math.tan(vh), tanH = tanV * main.aspect;
      const padV = Math.atan(tanV * (1 + this.padY / (h / 2))) - vh;
      const padH = Math.atan(tanH * (1 + this.padX / (w / 2))) - Math.atan(tanH);
      this.padAngle = Math.min(padV, padH);
    }
    this.saved = this.containers.map((o) => o.visible);
    main.getWorldPosition(this._p);
    main.getWorldQuaternion(this._q);
    // (cada fatia é refeita a cada 4 quadros, e um quadro em cada 4 não refaz nenhuma: antes era a cada 3, uma fatia por quadro, ~1,6 ms de CPU cada;
    // o campo distante muda devagar e o reaproveitamento corrige a posição e a rotação da câmera, então um quadro a mais de idade não aparece)
    // Fatia que nunca foi desenhada entra na hora; as que só ficaram velhas (o jogador começou a andar e as três passam do limite juntas) vão uma por quadro,
    // a mais antiga primeiro: as três de uma vez custavam ~50 ms num quadro só.
    let oldest = -1;
    for (let k = 0; k < 3; k++) {
      const pose = this.poses[k];
      // (nunca desenhada, ou a câmera girou a ponto de a borda do campo distante aparecer: não espera)
      if (!pose.valid || pose.quat.angleTo(this._q) > this.padAngle * 0.95) { this.renderSlice(k, main, frame); continue; }
      const stale = (frame % 4) === k
        || pose.quat.angleTo(this._q) > this.padAngle * 0.7
        || pose.pos.distanceToSquared(this._p) > 1.0;
      if (stale && (oldest < 0 || pose.frame < this.poses[oldest].frame)) oldest = k;
    }
    if (oldest >= 0) this.renderSlice(oldest, main, frame);
    // composição
    const u = this.material.uniforms;
    u.uInvProj.value.copy(main.projectionMatrixInverse);
    u.uCamWorld.value.copy(main.matrixWorld);
    u.uMainPos.value.copy(this._p);
    main.getWorldDirection(u.uMainFwd.value);
    u.uNear.value = main.near; u.uFar.value = main.far;
    for (let k = 0; k < 3; k++) {
      const rt = this.rts[k]!;
      u['uCol' + k].value = rt.texture; u['uDep' + k].value = rt.depthTexture;
      u['uVP' + k].value.copy(this.poses[k].vp);
      u['uC' + k].value.copy(this.poses[k].pos);
      u['uF' + k].value.copy(this.poses[k].fwd);
    }
    // esconde os grupos distantes do desenho principal e liga a composição
    u.uOn.value.set(this.saved[0] ? 1 : 0, this.saved[1] ? 1 : 0, this.saved[2] ? 1 : 0);
    for (const o of this.containers) o.visible = false;
    this.mesh.visible = true;
    this.engaged = true;
    return true;
  }

  /** depois do desenho principal: tudo volta ao normal */
  public finish(): void {
    if (!this.engaged) return;
    this.containers.forEach((o, i) => { o.visible = this.saved[i]; });
    this.mesh.visible = false;
    this.engaged = false;
  }

  private renderSlice(k: number, main: THREE.PerspectiveCamera, frame: number): void {
    const rt = this.rts[k]!;
    const pose = this.poses[k];
    if (k === 2) this.onChunkSlice();
    const cam = this.cam;
    cam.position.copy(this._p); cam.quaternion.copy(this._q);
    cam.fov = main.fov; cam.aspect = main.aspect; cam.near = main.near; cam.far = main.far; cam.zoom = main.zoom;
    cam.setViewOffset(this.w, this.h, -this.padX, -this.padY, this.w + 2 * this.padX, this.h + 2 * this.padY);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    pose.pos.copy(this._p); pose.quat.copy(this._q); pose.frame = frame;
    pose.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cam.getWorldDirection(pose.fwd);
    pose.valid = true;

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const alpha = r.getClearAlpha(); r.getClearColor(this._clear);
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    const container = this.containers[k];
    const wasVisible = container.visible;
    if (wasVisible) {
      // só este grupo (e as luzes) fica visível
      const hidden = this._hidden; hidden.length = 0;
      const top = k === 0 ? this.c.vegRoot : container;
      for (const o of this.scene.children) {
        if (o === top || (o as THREE.Light).isLight || o === this.mesh) continue;
        if (o.visible) { o.visible = false; hidden.push(o); }
      }
      const nearWasVisible = this.c.nearPools.visible;
      if (k === 0) this.c.nearPools.visible = false;
      const wasTop = top.visible; top.visible = true;
      const wasAuto = this.scene.matrixWorldAutoUpdate; this.scene.matrixWorldAutoUpdate = false;
      container.visible = true;
      FAR.inPass = true;
      try { r.render(this.scene, cam); } finally {
        FAR.inPass = false;
        this.scene.matrixWorldAutoUpdate = wasAuto;
        top.visible = wasTop;
        if (k === 0) this.c.nearPools.visible = nearWasVisible;
        for (const o of hidden) o.visible = true;
      }
      container.visible = wasVisible;
    }
    r.setClearColor(this._clear, alpha);
    r.setRenderTarget(prevTarget);
  }
}
