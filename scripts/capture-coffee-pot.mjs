#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './renders';
const URL = 'http://localhost:5173/test-coffee-pot.html';
const SCREENSHOT_WAIT = 90000; // 90 seconds for rendering

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    
    // Set viewport to match our canvas size + UI
    await page.setViewport({ width: 1500, height: 900 });

    console.log(`Navigating to ${URL}...`);
    await page.goto(URL, { waitUntil: 'networkidle2' });

    console.log(`Waiting ${SCREENSHOT_WAIT / 1000}s for rendering to complete...`);
    await page.waitForTimeout(SCREENSHOT_WAIT);

    // Take screenshot of full page
    const fullScreenPath = path.join(OUTPUT_DIR, `coffee-pot-pt-disney-256spp-${Date.now()}.png`);
    await page.screenshot({ path: fullScreenPath, fullPage: false });
    console.log(`Screenshot saved to ${fullScreenPath}`);

    // Try to extract individual canvas images
    console.log('Extracting canvas images...');
    
    const canvasImages = await page.evaluate(() => {
      const ptCanvas = document.getElementById('canvas-pt');
      const disneyCanvas = document.getElementById('canvas-disney');
      
      return {
        pt: ptCanvas ? ptCanvas.toDataURL('image/png') : null,
        disney: disneyCanvas ? disneyCanvas.toDataURL('image/png') : null,
      };
    });

    if (canvasImages.pt) {
      const ptPath = path.join(OUTPUT_DIR, `coffee-pot-pt-256spp-${Date.now()}.png`);
      const data = canvasImages.pt.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(ptPath, Buffer.from(data, 'base64'));
      console.log(`Path Tracer canvas saved to ${ptPath}`);
    }

    if (canvasImages.disney) {
      const disneyPath = path.join(OUTPUT_DIR, `coffee-pot-disney-256spp-${Date.now()}.png`);
      const data = canvasImages.disney.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(disneyPath, Buffer.from(data, 'base64'));
      console.log(`Disney canvas saved to ${disneyPath}`);
    }

    console.log('Done!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
