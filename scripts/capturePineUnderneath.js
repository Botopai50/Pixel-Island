import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('=== Capturando Pinheiro Visto de Baixo (Teste de Transparência / Oclusão) ===');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 }); // Formato vertical idêntico ao screenshot do usuário

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[Browser ERROR]:', msg.text());
  });

  console.log('Navegando para o mundo...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 6000));

  await page.waitForFunction(() => !!window.__WORLD__ && !!window.__PLAYER__);

  // 1. Procura um pinheiro no mundo
  const pineTarget = await page.evaluate(() => {
    const world = window.__WORLD__;
    for (let r = 30; r < 400; r += 8) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.25) {
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const pt = world.queryPoint(x, z);
        if (!pt.isWater && pt.biome.treeTypeDistribution && pt.biome.treeTypeDistribution.pine > 0.4) {
          // Procura instância real nos arredores
          let found = null;
          world.scene.traverse((obj) => {
            if (found) return;
            if (obj.isInstancedMesh && obj.count > 0 && obj.instanceMatrix) {
              const arr = obj.instanceMatrix.array;
              for (let i = 0; i < obj.count; i++) {
                const ix = arr[i * 16 + 12];
                const iy = arr[i * 16 + 13];
                const iz = arr[i * 16 + 14];
                const d = Math.hypot(ix - x, iz - z);
                if (d < 30) {
                  found = { x: ix, y: iy, z: iz };
                  return;
                }
              }
            }
          });
          if (found) return found;
        }
      }
    }
    return { x: 0, y: 10, z: -100 };
  });

  console.log('Alvo de Pinheiro encontrado:', pineTarget);

  // Posiciona a câmera logo abaixo da árvore (distância de ~3.2m do tronco)
  await page.evaluate((target) => {
    const player = window.__PLAYER__;
    const world = window.__WORLD__;
    const camX = target.x + 0.8;
    const camZ = target.z + 3.2;
    player.setPosition(camX, camZ);
    world.updateObserverPosition(camX, camZ);
    player.transitionToFirstPerson(camX, camZ, world.getTerrainGenerator());
  }, pineTarget);

  await new Promise((r) => setTimeout(r, 3500));

  // Inclina a câmera fortemente para CIMA (olhando para a copa e o ápice a partir de baixo)
  await page.evaluate((target) => {
    const fp = window.__PLAYER__.firstPersonController;
    if (fp) {
      const dx = target.x - fp.position.x;
      const dz = target.z - fp.position.z;
      fp.yaw = Math.atan2(-dx, -dz);
      fp.pitch = 0.82; // Olhando para cima!
    }
  }, pineTarget);

  await new Promise((r) => setTimeout(r, 2000));

  const pineShotPath = path.join(ARTIFACT_DIR, 'pine_view_from_below.png');
  await page.screenshot({ path: pineShotPath });
  console.log('✓ Pinheiro visto de baixo salvo em:', pineShotPath);

  // 1.2 Dá alguns passos para trás e olha para cima enquadrando múltiplos andares de saias
  await page.evaluate((target) => {
    const player = window.__PLAYER__;
    const world = window.__WORLD__;
    const camX = target.x + 2.0;
    const camZ = target.z + 6.8;
    player.setPosition(camX, camZ);
    world.updateObserverPosition(camX, camZ);
    player.transitionToFirstPerson(camX, camZ, world.getTerrainGenerator());
  }, pineTarget);

  await new Promise((r) => setTimeout(r, 2500));

  await page.evaluate((target) => {
    const fp = window.__PLAYER__.firstPersonController;
    if (fp) {
      const dx = target.x - fp.position.x;
      const dz = target.z - fp.position.z;
      fp.yaw = Math.atan2(-dx, -dz);
      fp.pitch = 0.55; // Olhando para cima enquadrando todos os andares
    }
  }, pineTarget);

  await new Promise((r) => setTimeout(r, 1500));

  const multiTierShotPath = path.join(ARTIFACT_DIR, 'pine_tiers_from_below.png');
  await page.screenshot({ path: multiTierShotPath });
  console.log('✓ Múltiplos andares do pinheiro vistos de baixo salvos em:', multiTierShotPath);

  // 2. Captura no Showcase do Pinheiro Adulto visto de baixo
  console.log('Navegando para Showcase Pinheiro...');
  await page.goto('http://localhost:5173/showcase.html?item=pine', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  const showcaseShotPath = path.join(ARTIFACT_DIR, 'pine_showcase_underneath.png');
  await page.screenshot({ path: showcaseShotPath });
  console.log('✓ Showcase Pinheiro salvo em:', showcaseShotPath);

  await browser.close();
  console.log('=== Concluído com sucesso! ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
