import * as THREE from 'three';

/**
 * Multi-draw das árvores: todas as variações de uma espécie (num mesmo degrau de detalhe e parte) viram UMA malha com as geometrias coladas, e
 * UMA chamada de desenho (WEBGL_multi_draw) desenha cada variação com as suas instâncias. Antes eram ~230 chamadas por quadro só nos dois
 * degraus próximos (cada uma ~25 µs de CPU no three: troca de programa, uniforms, VAO), e o mesmo nos mapas de sombra.
 *
 * Como o multi-draw "sem base de instância" lê os atributos de instância sempre do começo, as matrizes e cores das instâncias vão numa
 * textura de pontos flutuantes, e o shader lê a instância de índice gl_InstanceID + base[gl_DrawID] (veja MD_BLOCK).
 */
export const MD_MAX = 16;
export const MD_TEX_W = 2048;      // texels por linha da textura de matrizes (4 por instância)
export const MD_COL_W = 1024;      // texels por linha da textura de cores (1 por instância)

export const MD: {
  enabled: boolean;
  pending: null | { counts: Int32Array; offsets: Int32Array; instances: Int32Array; n: number };
} = { enabled: false, pending: null };

/** Liga o multi-draw só com ?md na URL (precisa de WEBGL_multi_draw; em teste não foi mais rápido que o desenho por variação: a leitura das matrizes pela textura pesa na GPU e só uma parte das malhas pode ser juntada) e desvia a chamada de desenho das malhas que pediram (MD.pending). */
export function installMultiDraw(renderer: THREE.WebGLRenderer): void {
  if (MD.enabled || !new URLSearchParams(window.location.search).has('md') || !renderer.extensions.has('WEBGL_multi_draw')) return;
  const ext = renderer.extensions.get('WEBGL_multi_draw') as {
    multiDrawElementsInstancedWEBGL: (mode: number, counts: Int32Array, co: number, type: number, offsets: Int32Array, oo: number, inst: Int32Array, io: number, n: number) => void;
  };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const orig = gl.drawElementsInstanced.bind(gl);
  gl.drawElementsInstanced = (mode: number, count: number, type: number, offset: number, prim: number): void => {
    const p = MD.pending;
    if (p) {
      if (p.n > 0) ext.multiDrawElementsInstancedWEBGL(mode, p.counts, 0, type, p.offsets, 0, p.instances, 0, p.n);
      return;
    }
    orig(mode, count, type, offset, prim);
  };
  MD.enabled = true;
}

/** Cola as geometrias (mesmos atributos) numa só, com índices de 32 bits; guarda em userData.md onde cada uma começa (em bytes) e quantos índices tem. */
export function mergeVariantGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0 || geos.length > MD_MAX) return null;
  const names = Object.keys(geos[0].attributes);
  let vtx = 0, idx = 0;
  for (const g of geos) {
    const n = Object.keys(g.attributes);
    if (n.length !== names.length || !names.every((k) => g.attributes[k]) || g.groups.length > 0 || Object.keys(g.morphAttributes).length > 0) return null;
    vtx += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a0 = geos[0].attributes[name] as THREE.BufferAttribute;
    if ((a0 as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return null;
    const Ctor = a0.array.constructor as new (n: number) => THREE.TypedArray;
    const size = a0.itemSize;
    for (const g of geos) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      if ((a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || a.itemSize !== size || a.array.constructor !== Ctor) return null;
    }
    const arr = new Ctor(vtx * size) as unknown as { set: (a: ArrayLike<number>, o: number) => void };
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      arr.set((a.array as unknown as { subarray: (s: number, e: number) => ArrayLike<number> }).subarray(0, a.count * size), o);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr as unknown as THREE.TypedArray, size, a0.normalized));
  }
  const index = new Uint32Array(idx);
  const counts = new Int32Array(geos.length), offsets = new Int32Array(geos.length);
  let vo = 0, io = 0;
  geos.forEach((g, i) => {
    const n = g.index ? g.index.count : g.attributes.position.count;
    counts[i] = n; offsets[i] = io * 4;
    if (g.index) { const src = g.index.array; for (let j = 0; j < n; j++) index[io + j] = src[j] + vo; }
    else for (let j = 0; j < n; j++) index[io + j] = vo + j;
    io += n; vo += g.attributes.position.count;
  });
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.userData.md = { counts, offsets };
  out.computeBoundingSphere();
  return out;
}

/** Trecho de shader que troca o atributo de instância pela leitura nas texturas (a base de cada desenho vem de uMdBase[gl_DrawID]). */
const MD_BLOCK = `#ifdef MD_BATCH
uniform highp sampler2D uMdTex;
uniform highp sampler2D uMdCol;
uniform int uMdBase[${MD_MAX}];
mat4 mdInstanceMatrix() {
  int i = gl_InstanceID + uMdBase[gl_DrawID];
  int w = ${MD_TEX_W};
  int j = i * 4;
  ivec2 p = ivec2(j % w, j / w);
  return mat4(texelFetch(uMdTex, p, 0), texelFetch(uMdTex, p + ivec2(1, 0), 0), texelFetch(uMdTex, p + ivec2(2, 0), 0), texelFetch(uMdTex, p + ivec2(3, 0), 0));
}
vec3 mdInstanceColor() {
  int i = gl_InstanceID + uMdBase[gl_DrawID];
  int w = ${MD_COL_W};
  return texelFetch(uMdCol, ivec2(i % w, i / w), 0).rgb;
}
#define instanceMatrix mdInstanceMatrix()
#define instanceColor mdInstanceColor()
#endif
`;

export interface MdMaterials {
  main: THREE.ShaderMaterial;
  depth: THREE.ShaderMaterial | null;
  /** os uniforms de instância (compartilhados entre o material e o de sombra) */
  uniforms: { uMdTex: { value: THREE.Texture | null }; uMdCol: { value: THREE.Texture | null }; uMdBase: { value: Int32Array } };
}

const COPY_PROPS = ['side', 'transparent', 'depthWrite', 'depthTest', 'colorWrite', 'blending', 'alphaTest', 'premultipliedAlpha', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'toneMapped', 'dithering', 'name'] as const;

function derive(src: THREE.ShaderMaterial, vs: string, fs: string, shared: Record<string, { value: unknown }>): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial();
  for (const p of COPY_PROPS) (m as unknown as Record<string, unknown>)[p] = (src as unknown as Record<string, unknown>)[p];
  m.uniforms = shared as THREE.ShaderMaterial['uniforms'];
  m.vertexShader = MD_BLOCK + vs;
  m.fragmentShader = fs;
  m.defines = { ...src.defines, MD_BATCH: '' };
  m.extensions = { ...src.extensions, multiDraw: true };
  return m;
}

/**
 * Cópia do material de uma árvore que lê as instâncias das texturas. Parte do shader original (userData.srcVS, antes de o assetEnvironment
 * mexer nele) e divide com o original todos os uniforms (texturas, vento, luz), então o visual é o mesmo. O material de sombra idem.
 */
export function makeMdMaterials(mat: THREE.ShaderMaterial): MdMaterials | null {
  const vs0 = mat.userData.srcVS as string | undefined, fs0 = mat.userData.srcFS as string | undefined;
  if (!mat.isShaderMaterial || !vs0 || !fs0) return null;
  const mu = { uMdTex: { value: null as THREE.Texture | null }, uMdCol: { value: null as THREE.Texture | null }, uMdBase: { value: new Int32Array(MD_MAX) } };
  const main = derive(mat, vs0, fs0, { ...mat.uniforms, ...mu });
  const { assetEnvironment: _a, assetFrame: _f, assetCam: _c, depthMaterial: _d, ...rest } = mat.userData as Record<string, unknown>;
  void _a; void _f; void _c; void _d;
  main.userData = { ...rest };
  const d = mat.userData.depthMaterial as THREE.ShaderMaterial | undefined;
  let depth: THREE.ShaderMaterial | null = null;
  if (d) {
    depth = derive(d, d.vertexShader, d.fragmentShader, { ...d.uniforms, ...mu });
    main.userData.depthMaterial = depth;
  }
  return { main, depth, uniforms: mu };
}
