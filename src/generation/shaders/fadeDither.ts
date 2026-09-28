import * as THREE from 'three';

/**
 * Transições suaves entre níveis de detalhe: em vez de um corte seco (chunk -> horizonte, anel
 * do horizonte -> o seguinte, fim das pedras/arbustos/grama), os dois lados se misturam numa
 * faixa, na proporção que muda ao longo dela. A escolha é presa ao MUNDO, não à tela: blocos do
 * terreno de alguns pixels de lado (fadeHash da célula) ou o objeto inteiro (hash da posição dele).
 * Um pontilhado preso à tela fazia a faixa "ferver" com a câmera andando (o terreno passava por
 * baixo do padrão e cada pixel alternava entre o detalhado e o simplificado).
 *
 * Raios em metros a partir do ponto de foco (o mesmo que centra os chunks), atualizados a cada
 * quadro pelo WorldEngine: (começo, fim) da faixa em que o nível de detalhe some.
 */
export const FADE = {
  uFadeCam: { value: new THREE.Vector2() },
  /** chunks detalhados -> horizonte */
  uChunkFade: { value: new THREE.Vector2(1e9, 1e9 + 1) },
  /** árvores/pedras/arbustos de verdade -> árvores distantes (impostores) */
  uVegFade: { value: new THREE.Vector2(1e9, 1e9 + 1) },
  /**
   * árvores de verdade <-> impostores (mesmas posições): troca seca por árvore nesta distância
   * (faixa de poucos centímetros)
   */
  uTreeSwap: { value: new THREE.Vector2(1e9, 1e9 + 1) },
  /** fim da grama 3D */
  uGrassFade: { value: new THREE.Vector2(1e9, 1e9 + 1) },
};

/** limiar do pontilhado (0-1) no pixel da tela (só para a troca seca árvore <-> impostor) */
export const FADE_GLSL = /* glsl */ `
// limiar (0-1) fixo por célula/objeto do mundo
float fadeHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float fadeBayer(vec2 fc) {
  ivec2 q = ivec2(mod(floor(fc), 4.0));
  int i = q.x + q.y * 4;
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}
`;
