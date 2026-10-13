/**
 * Orçamento de tempo dividido entre os trabalhos de fundo de cada quadro (subir texturas, descarregar e plantar chunks, plantar grama).
 * Cada um tinha o seu limite (2 a 5 ms) e, numa travessia de chunk, vários estouravam no MESMO quadro: 15 a 20 ms de trabalho de fundo
 * somados aos 12 do desenho. Agora o total é um só, e o que não couber espera o quadro seguinte.
 */
const TOTAL_MS = 5;
let frameStart = 0;
/** Chamar no começo de cada quadro. */
export function beginFrameBudget(): void { frameStart = performance.now(); }
/** Quanto ainda cabe neste quadro (ms), no máximo `cap`. */
export function budgetLeft(cap: number = TOTAL_MS): number {
  return Math.min(cap, Math.max(0, TOTAL_MS - (performance.now() - frameStart)));
}
