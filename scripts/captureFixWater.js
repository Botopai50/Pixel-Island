import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=d3d11']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));

  const targets = [
    {
      name: 'screenshot_water_and_reef_fixed',
      x: 255,
      z: -225,
      zoom: 120,
      yaw: -0.4
    },
    {
      name: 'screenshot_sea_arch_clean_water',
      x: 380,
      z: -160,
      zoom: 160,
      yaw: 0.6
    },
    {
      name: 'screenshot_ocean_uniform_wide',
      x: 100,
      z: -300,
      zoom: 450,
      yaw: 0.0
    }
  ];

  for (const t of targets) {
    await page.evaluate((pos) => {
      const player = window.__PLAYER__;
      const world = window.__WORLD__;
      if (player && world) {
        player.setPosition(pos.x, pos.z);
        player.setFrustumSize(pos.zoom);
        player.setRotation(pos.yaw);
        world.updateObserverPosition(pos.x, pos.z);
      }
    }, t);

    await new Promise((r) => setTimeout(r, 2000));
    const outPath = path.join(ARTIFACT_DIR, `${t.name}.png`);
    await page.screenshot({ path: outPath });
    console.log(`✓ Capturado: ${outPath}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
