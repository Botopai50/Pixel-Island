/**
 * Medição repetível de desempenho (console: `await __bench.run('cidade', 60)`).
 * Cada corrida: teleporta para 300 m de uma cidade (ou para a mata), espera o mundo carregar, depois mede `seconds` segundos
 * PARADO ou ANDANDO de verdade (tecla W, 6,6 m/s) e guarda p50/p95/p99, quadros > 33 e > 50 ms por minuto, pior quadro e o custo de CPU
 * das chamadas de desenho. Resultados em `__bench.results`.
 */
import type * as THREE from 'three';

interface BenchEnv { world: any; player: any; renderer: THREE.WebGLRenderer }

/** Marcas de fase do quadro (só gravam durante uma medição): cada `phase('nome')` soma o tempo desde a marca anterior. */
export const PHASES: { gl?: WebGL2RenderingContext; armed: boolean; on: boolean; last: number; cur: Record<string, number>; frames: { dt: number; t: number; ph: Record<string, number> }[]; ext: { name: string; t: number; ms: number }[] } = { armed: false, on: typeof location !== 'undefined' && /[?&]trace=1/.test(location.search), last: 0, cur: {}, frames: [], ext: [] };
/** trabalho que roda FORA do quadro (timers, ociosidade): entra na linha do tempo dos quadros longos */
export function external(name: string, t0: number): void { if (PHASES.on) PHASES.ext.push({ name, t: t0, ms: performance.now() - t0 }); }
/** marca instantânea (acontecimento): aparece junto dos quadros longos que vieram logo depois */
export function mark(name: string): void { if (PHASES.on) PHASES.ext.push({ name, t: performance.now(), ms: 0 }); }
export function phase(name: string): void {
  if (!PHASES.on) return;
  const n = performance.now();
  PHASES.cur[name] = (PHASES.cur[name] ?? 0) + (n - PHASES.last);
  PHASES.last = n;
}
export function phaseStart(): void {
  if (!PHASES.on) return;
  PHASES.last = performance.now(); PHASES.cur = {};
  // quanto o GPU ainda devia do quadro anterior (só durante a medição: `finish` espera a fila esvaziar)
  if (PHASES.gl) { PHASES.gl.finish(); phase('gpu.espera'); }
}
export function phaseEnd(dtMs: number): void { if (PHASES.on) { phase('resto'); PHASES.frames.push({ dt: dtMs, t: performance.now(), ph: PHASES.cur }); } }

export interface BenchResult {
  label: string; seconds: number; frames: number; avgMs: number; p50: number; p95: number; p99: number; p999: number;
  over33PerMin: number; over50PerMin: number; worstMs: number; renderCpuMs: number;
}

export function installBench(env: BenchEnv): void {
  const results: Record<string, BenchResult> = {};
  PHASES.gl = env.renderer.getContext() as WebGL2RenderingContext;
  // ?trace=1: grava as fases de TODOS os quadros desde o primeiro (carregamento); lê-se em `__bench.trace()`
  if (/[?&]trace=1/.test(location.search)) { PHASES.on = true; PHASES.gl = undefined; }
  const key = (type: string): void => { window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w', bubbles: true })); };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function run(scenario: 'cidade' | 'cidade-parado' | 'mata' | 'mata-parado', seconds = 60, settleSec = 25): Promise<BenchResult> {
    const { world, player, renderer } = env;
    const walking = !scenario.endsWith('parado');
    let x = -2500, z = -2500, yaw = -Math.PI / 2;
    if (scenario.startsWith('cidade')) {
      const town = [...world.settlementMgr.towns.values()][0];
      const e = town.entry;
      const px = e.site.x + (e.plan.plaza.x + e.plan.plaza.radius * 0.5) * 1.7, pz = e.site.z + e.plan.plaza.z * 1.7;
      x = px - 300; z = pz;
    }
    player.teleportToFirstPerson(x, z, world.terrainGen, yaw, 0);
    await sleep(settleSec * 1000);
    if (PHASES.armed) { PHASES.frames = []; PHASES.ext = []; PHASES.on = true; }       // (só a parte medida entra, não a espera de carga)
    // custo de CPU das chamadas de desenho
    let cpu = 0;
    const orig = renderer.render.bind(renderer);
    renderer.render = ((s: THREE.Object3D, c: THREE.Camera) => { const t = performance.now(); orig(s, c); cpu += performance.now() - t; }) as typeof renderer.render;
    if (walking) key('keydown');
    const dts: number[] = [];
    await new Promise<void>((res) => {
      let last = performance.now(); const t0 = last;
      const tick = (): void => { const n = performance.now(); dts.push(n - last); last = n; if (n - t0 < seconds * 1000) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    if (walking) key('keyup');
    renderer.render = orig;
    dts.shift();
    const s = [...dts].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
    const min = seconds / 60;
    const r: BenchResult = {
      label: scenario, seconds, frames: dts.length, avgMs: +avg.toFixed(2), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), p999: +q(0.999).toFixed(1),
      over33PerMin: +(s.filter((v) => v > 33).length / min).toFixed(1), over50PerMin: +(s.filter((v) => v > 50).length / min).toFixed(1),
      worstMs: Math.round(s[s.length - 1]), renderCpuMs: +(cpu / dts.length).toFixed(2),
    };
    results[`${scenario}#${Object.keys(results).length}`] = r;
    return r;
  }
  /** Qual fase pesa nos quadros longos (> limiar): média por fase nesses quadros contra a média dos demais. */
  async function phases(scenario: 'cidade' | 'mata' = 'cidade', seconds = 30, over = 33): Promise<unknown> {
    PHASES.armed = true;
    await run(scenario, seconds);
    PHASES.on = false; PHASES.armed = false;
    const fr = PHASES.frames, long = fr.filter((f) => f.dt > over), rest = fr.filter((f) => f.dt <= over);
    const names = new Set<string>(); for (const f of fr) for (const k of Object.keys(f.ph)) names.add(k);
    const avg = (arr: typeof fr, k: string) => arr.length ? +(arr.reduce((s, f) => s + (f.ph[k] ?? 0), 0) / arr.length).toFixed(2) : 0;
    const rows = [...names].map((k) => ({ fase: k, longos: avg(long, k), normais: avg(rest, k), extra: +(avg(long, k) - avg(rest, k)).toFixed(2) })).sort((a, b) => b.extra - a.extra);
    return { quadros: fr.length, longos: long.length, rows: rows.slice(0, 12) };
  }
  /** Custo de GPU (consulta de tempo do WebGL2) e de CPU das chamadas de desenho por quadro, mais chamadas e triângulos, PARADO onde está. */
  async function gpu(seconds = 10): Promise<unknown> {
    const { renderer } = env;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return 'sem EXT_disjoint_timer_query_webgl2';
    let gpuMs = 0, cpuMs = 0, frames = 0, calls = 0, tris = 0;
    const pend: { q: WebGLQuery; k: string }[] = [];
    const byPass: Record<string, { ms: number; n: number }> = {};
    const drain = (): void => {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (let i = pend.length - 1; i >= 0; i--) {
        const { q, k } = pend[i];
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          if (!disjoint) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gpuMs += ms; const e = byPass[k] ?? (byPass[k] = { ms: 0, n: 0 }); e.ms += ms; e.n++; }
          gl.deleteQuery(q); pend.splice(i, 1);
        }
      }
    };
    const orig = renderer.render.bind(renderer);
    renderer.info.autoReset = false;
    renderer.render = ((s: THREE.Object3D, c: THREE.Camera) => {
      const rt = renderer.getRenderTarget();
      const k = (rt ? `${rt.width}x${rt.height}` : 'tela') + ' ' + (s.name || s.type);
      const q = gl.createQuery()!; gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t0 = performance.now(); orig(s, c); cpuMs += performance.now() - t0;
      gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push({ q, k });
    }) as typeof renderer.render;
    await new Promise<void>((res) => {
      const t0 = performance.now();
      const tick = (): void => {
        frames++; calls += renderer.info.render.calls; tris += renderer.info.render.triangles; renderer.info.reset(); drain();
        if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    await sleep(600); drain();
    renderer.render = orig; renderer.info.autoReset = true;
    const passes = Object.entries(byPass).map(([k, v]) => `${k}: ${(v.ms / frames).toFixed(2)} ms/quadro (${(v.n / frames).toFixed(1)}x)`).sort();
    return { passes, frames, gpuMsPerFrame: +(gpuMs / frames).toFixed(2), cpuDrawMsPerFrame: +(cpuMs / frames).toFixed(2), callsPerFrame: Math.round(calls / frames), trisPerFrame: Math.round(tris / frames) };
  }
  /** Teleporta para 300 m da primeira cidade (ou para a mata) e espera o mundo carregar. */
  async function goto(scenario: 'cidade' | 'mata', settleSec = 25): Promise<void> {
    const { world, player } = env;
    let x = -2500, z = -2500;
    if (scenario === 'cidade') {
      const e = [...world.settlementMgr.towns.values()][0].entry;
      x = e.site.x + (e.plan.plaza.x + e.plan.plaza.radius * 0.5) * 1.7 - 300; z = e.site.z + e.plan.plaza.z * 1.7;
    }
    player.teleportToFirstPerson(x, z, world.terrainGen, -Math.PI / 2, 0);
    await sleep(settleSec * 1000);
  }
  /** Os N piores quadros de uma corrida, cada um com as fases que passaram de 2 ms e o trabalho de fundo que caiu dentro dele. */
  async function worst(scenario: 'cidade' | 'mata' = 'cidade', seconds = 60, n = 14): Promise<unknown> {
    PHASES.armed = true;
    await run(scenario, seconds);
    PHASES.on = false; PHASES.armed = false;
    return [...PHASES.frames].sort((a, b) => b.dt - a.dt).slice(0, n).map((f) => {
      const t0 = f.t - f.dt;
      const ph = Object.entries(f.ph).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`);
      // trabalho de fundo dentro do quadro: soma por nome (muitos eventos curtos também pesam); marcas instantâneas só como aviso
      const sums = new Map<string, { ms: number; n: number }>();
      const marks: string[] = [];
      for (const e of PHASES.ext) {
        if (e.ms > 0) { if (e.t + e.ms >= t0 && e.t <= f.t) { const s = sums.get(e.name) ?? { ms: 0, n: 0 }; s.ms += e.ms; s.n++; sums.set(e.name, s); } }
        else if (e.t >= t0 - 400 && e.t <= f.t) marks.push(`[${e.name} há ${Math.max(0, f.t - e.t).toFixed(0)} ms]`);
      }
      const ext = [...[...sums].filter(([, s]) => s.ms >= 1).sort((x, y) => y[1].ms - x[1].ms).map(([k, s]) => `${k} ${s.ms.toFixed(0)}ms×${s.n}`), ...marks];
      return `@${((f.t - PHASES.frames[0].t) / 1000).toFixed(1)}s ${f.dt.toFixed(0)} ms | ${ph.join(', ')}${ext.length ? ' | fora do quadro: ' + ext.join(', ') : ''}`;
    });
  }
  /** Fases dos primeiros quadros (com ?trace=1 na URL): para ver o que enche os quadros do carregamento. */
  function trace(n = 12): string[] {
    return PHASES.frames.slice(0, n).map((f, i) => `quadro ${i}: ${f.dt.toFixed(0)} ms | ` + Object.entries(f.ph).filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
  }
  (window as any).__bench = { run, results, phases, gpu, goto, worst, trace, state: () => ({ on: PHASES.on, n: PHASES.frames.length, gl: !!PHASES.gl }) };
}
