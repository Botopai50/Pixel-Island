import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Capturando Coqueiros Exclusivos de Praia e Validação da Areia Molhada ---');
  
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
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', (msg) => console.log(`[Browser]: ${msg.text()}`));
  page.on('pageerror', (err) => console.error(`[PageError]: ${err.toString()}`));

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  await page.waitForFunction(() => !!window.__WORLD__ && !!window.__PLAYER__);

  // 1. Procura praia arenosa com coqueiros
  const beachPoints = await page.evaluate(() => {
    const world = window.__WORLD__;
    if (!world) return [];
    const points = [];
    for (let x = -200; x < 200; x += 6) {
      for (let z = -200; z < 200; z += 6) {
        const pt = world.queryPoint(x, z);
        if (pt.biome.type === 'Praia Arenosa' && pt.height > 2.0 && pt.height < 3.5) {
          points.push({ x, z, h: pt.height });
          if (points.length >= 3) return points;
        }
      }
    }
    return points;
  });

  console.log('Pontos de praia encontrados:', beachPoints);

  if (beachPoints.length > 0) {
    const p = beachPoints[0];
    console.log(`Focando em praia 1 em (${p.x}, ${p.z})...`);
    await page.evaluate((pos) => {
      window.__PLAYER__.setPosition(pos.x, pos.z);
      window.__WORLD__.updateObserverPosition(pos.x, pos.z);
      const cam = window.__PLAYER__.observerCamera;
      if (cam) {
        cam.targetFrustumSize = 46;
        cam.frustumSize = 46;
        cam.updateProjection();
      }
    }, p);

    await new Promise((r) => setTimeout(r, 3500));
    const shot1 = path.join(ARTIFACT_DIR, 'screenshot_beach_palms_closeup.png');
    await page.screenshot({ path: shot1 });
    console.log(`Foto 1 (Coqueiros de Praia) salva: ${shot1}`);

    // Zoom mais aberto para ver a faixa de praia, areia molhada e mar
    await page.evaluate(() => {
      const cam = window.__PLAYER__.observerCamera;
      if (cam) {
        cam.targetFrustumSize = 85;
        cam.frustumSize = 85;
        cam.updateProjection();
      }
    });
    await new Promise((r) => setTimeout(r, 2000));
    const shot2 = path.join(ARTIFACT_DIR, 'screenshot_beach_strand_overview.png');
    await page.screenshot({ path: shot2 });
    console.log(`Foto 2 (Orla e Areia Molhada sem Árvores) salva: ${shot2}`);
  }

  await browser.close();
  console.log('--- Captura concluída com sucesso! ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
