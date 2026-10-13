import * as THREE from 'three';

/**
 * Menos chamadas de GL por desenho (a CPU gastava ~20% do quadro só em uniform4fv/uniformMatrix4fv, que o three refaz a cada troca de
 * material mesmo quando o valor é o mesmo).
 *
 * 1) Ordem dos desenhos opacos: o three ordena por material.id, e como os materiais de terreno, horizonte, árvores e água foram criados
 *    intercalados, o mesmo programa de shader era reativado ~100 vezes por quadro (cada troca de programa reenvia as luzes e os arrays).
 *    Agora ordena pelo programa primeiro, depois pelo material (o resultado na tela é o mesmo: opacos têm teste de profundidade).
 * 2) Uniforms em array grandes (pegadas, vento, matrizes de sombra) só vão para a GPU uma vez por programa e por render(): vários
 *    materiais (um por chunk de terreno, por exemplo) compartilham o mesmo programa e os mesmos valores.
 */
const CACHED_ARRAYS = new Set(['uFoot', 'uVent', 'uSpr', 'uSM', 'directionalShadowMatrix']);

type Setter = { id: string; setValue: (gl: WebGL2RenderingContext, v: unknown, t: unknown) => void };

export function installRenderOptimizations(renderer: THREE.WebGLRenderer): void {
  const props = renderer.properties;
  const pidOf = (m: THREE.Material & { __pid?: number }): number => {
    if (m.__pid !== undefined) return m.__pid;
    const p = (props.get(m) as { currentProgram?: { id: number } }).currentProgram;
    if (!p) return 0;
    return (m.__pid = p.id);
  };
  renderer.setOpaqueSort((a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
    const pa = pidOf(a.material as THREE.Material), pb = pidOf(b.material as THREE.Material);
    if (pa !== pb) return pa - pb;
    if (a.material.id !== b.material.id) return a.material.id - b.material.id;
    if (a.z !== b.z) return a.z - b.z;
    return a.id - b.id;
  });

  const patched = new WeakSet<object>();
  let seen = -1;
  const info = renderer.info;
  const patchNew = (): void => {
    const progs = info.programs;
    if (!progs || progs.length === seen) return;
    seen = progs.length;
    for (const prog of progs) {
      if (patched.has(prog)) continue;
      patched.add(prog);
      const seq = (prog.getUniforms() as unknown as { seq: Setter[] }).seq;
      for (const u of seq) {
        if (!CACHED_ARRAYS.has(u.id)) continue;
        const orig = u.setValue;
        let lastV: unknown = null, lastFrame = -1;
        u.setValue = (gl, v, t) => {
          const f = info.render.frame;
          if (v === lastV && f === lastFrame) return;
          lastV = v; lastFrame = f;
          orig.call(u, gl, v, t);
        };
      }
    }
  };
  // chamado uma vez por quadro (os programas novos aparecem aos poucos, conforme o mundo carrega)
  (renderer as unknown as { __patchPrograms: () => void }).__patchPrograms = patchNew;
}

export function updateRenderOptimizations(renderer: THREE.WebGLRenderer): void {
  (renderer as unknown as { __patchPrograms?: () => void }).__patchPrograms?.();
}
