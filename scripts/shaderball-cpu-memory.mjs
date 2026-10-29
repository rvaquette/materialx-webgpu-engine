import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execFile);

export async function sampleCpuMemory(chromePid) {
  const memory = {
    node: { ...process.memoryUsage(), peakRss: process.resourceUsage().maxRSS * 1024 },
    chrome: { unavailable: 'Chrome local Windows requis pour les mesures processus.' },
  };
  if (process.platform !== 'win32' || !Number.isInteger(chromePid) || chromePid <= 0) return memory;
  try {
    const pwsh = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
    const { stdout } = await exec(existsSync(pwsh) ? pwsh : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $all = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR ProcessId = ${chromePid}" -Property ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount -ErrorAction Stop)
      $ids = [System.Collections.Generic.HashSet[uint32]]::new()
      [void]$ids.Add(${chromePid})
      do {
        $added = $false
        foreach ($p in $all) {
          if ($ids.Contains([uint32]$p.ParentProcessId) -and $ids.Add([uint32]$p.ProcessId)) { $added = $true }
        }
      } while ($added)
      $owned = @($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) })
      if ($owned.Count -eq 0) { throw 'Chrome process no longer available' }
      @{
        rss = [double](($owned | Measure-Object WorkingSetSize -Sum).Sum)
        privateBytes = [double](($owned | Measure-Object PrivatePageCount -Sum).Sum)
        processes = $owned.Count
      } | ConvertTo-Json -Compress
    `], { timeout: 15000 });
    memory.chrome = JSON.parse(stdout);
  } catch (error) {
    memory.chrome = { unavailable: error.message };
    console.warn(`[shaderball] Chrome memory unavailable: ${error.killed ? 'process query exceeded 15 seconds' : error.message}`);
  }
  return memory;
}
