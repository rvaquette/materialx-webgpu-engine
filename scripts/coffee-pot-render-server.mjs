#!/usr/bin/env node
// Simple server to view coffee pot renders in browser
// Usage: npm run render:coffee-pot

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = 5173;

const log = (m) => console.log(`[coffee-pot-render] ${m}`);

// Check if Chrome is available
function getChromePath() {
  const possibilities = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.MX_CHROME,
  ];
  
  for (const path of possibilities) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

async function main() {
  // Start dev server
  log('starting vite dev server...');
  const vite = spawn('npx vite --host 127.0.0.1 --port 5173', {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
  });
  
  // Wait for server to be ready
  await sleep(5000);
  
  const url = `http://127.0.0.1:${PORT}/coffee-pot-render.html`;
  log(`opening ${url}`);
  
  const chrome = getChromePath();
  if (chrome) {
    log(`launching Chrome...`);
    spawn(chrome, [url], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });
  } else {
    log(`Chrome not found, please open: ${url}`);
  }
  
  // Keep process alive
  vite.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch(error => {
  console.error(`[coffee-pot-render] ERROR: ${error.message}`);
  process.exit(1);
});
