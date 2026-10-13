import * as THREE from 'three';
import { budgetLeft } from '../frameBudget.ts';

/**
 * Envio das texturas dos chunks para a GPU, espalhado pelos quadros.
 *
 * A textura de um chunk (e a versão escura dela, com mipmap) só ia para a GPU na primeira vez que o chunk era desenhado, e dois ou
 * quatro envios juntos custavam 30 a 45 ms num quadro só: a travada de cada chunk novo ao andar. Aqui o chunk só recebe o material novo
 * depois que a textura já está na GPU. Os envios seguem uma ordem (o chunk mais perto primeiro) e um orçamento de tempo por quadro:
 * sempre pelo menos uma textura por quadro (a fila nunca trava), e mais enquanto o orçamento deixar; com a fila grande (carregando o
 * mundo) o orçamento sobe, para o chão não demorar a aparecer.
 */
interface Item { tex: THREE.Texture[]; next: number; apply: () => void; priority: number }

let renderer: THREE.WebGLRenderer | null = null;
const queue: Item[] = [];

export function setUploadRenderer(r: THREE.WebGLRenderer): void { renderer = r; }

/** Espera as texturas subirem para a GPU e então chama apply (que as coloca no chunk). priority: menor = mais urgente (distância do chunk). */
export function enqueueTextureUpload(tex: THREE.Texture[], apply: () => void, priority = 0): void {
  if (!renderer) { apply(); return; }
  const item: Item = { tex, next: 0, apply, priority };
  let i = queue.length;
  while (i > 0 && queue[i - 1].priority > priority) i--;
  queue.splice(i, 0, item);
}

/** Chamar uma vez por quadro (main.ts). */
export function pumpTextureUploads(): void {
  if (!renderer || queue.length === 0) return;
  // sempre pelo menos um passo por quadro (a fila nunca trava); mais só enquanto sobrar do orçamento comum de fundo, e com a fila grande
  // (carregando o mundo) o orçamento do próprio envio sobe
  const extra = queue.length > 12 ? 10 : queue.length > 4 ? 6 : 3;
  const t0 = performance.now();
  let first = true;
  while (queue.length > 0 && (first || (performance.now() - t0 < extra && budgetLeft() > 0))) {
    first = false;
    const item = queue[0];
    if (item.next < item.tex.length) {
      renderer.initTexture(item.tex[item.next++]);
    } else {
      queue.shift();
      item.apply();
    }
  }
}
