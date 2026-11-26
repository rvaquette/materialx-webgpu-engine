import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(process.env.MX_SOURCE_DIR ?? 'D:/WebGL2/MaterialX/MaterialX-rva');
const pinnedRevision = 'bea1e9251d8f936a73930ad19a6f3b37265d46f5';
const emsdkRoot = resolve(process.env.EMSDK ?? 'D:/emsdk');
const cmakeFile = join(sourceRoot, 'source', 'JsMaterialX', 'CMakeLists.txt');
const bindingFile = join(sourceRoot, 'source', 'JsMaterialX', 'JsMaterialXCore', 'JsMaterialXCoreMinimal.cpp');
const formatBindingFile = join(sourceRoot, 'source', 'JsMaterialX', 'JsMaterialXFormat', 'JsMaterialXFormatMinimal.cpp');
const coreTemplate = join(projectRoot, 'scripts', 'materialx-core-minimal.cpp');
const formatTemplate = join(projectRoot, 'scripts', 'materialx-format-minimal.cpp');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

if (!existsSync(cmakeFile) || !existsSync(coreTemplate) || !existsSync(formatTemplate)) {
  throw new Error('MaterialX source or binding template is missing.');
}
const revision = git(['-C', sourceRoot, 'rev-parse', 'HEAD']);
if (revision !== pinnedRevision) throw new Error(`Expected MaterialX ${pinnedRevision}, found ${revision}.`);
if (git(['-C', sourceRoot, 'status', '--porcelain', '--untracked-files=all']) !== '') {
  throw new Error('MaterialX source must be clean before applying the temporary minimal-binding patch.');
}
if (existsSync(bindingFile) || existsSync(formatBindingFile)) {
  throw new Error('Refusing to overwrite an existing minimal binding file.');
}
const originalCmake = readFileSync(cmakeFile, 'utf8');
const coreDeps = /set\(CORE_DEPS[\s\S]*?\)/;
const formatDeps = /set\(FORMAT_DEPS[\s\S]*?\)/;
if (!coreDeps.test(originalCmake) || !formatDeps.test(originalCmake)) {
  throw new Error('Could not locate the MaterialX Core and Format dependency declarations.');
}
const patchedCmake = originalCmake.replace(
  coreDeps,
  'set(CORE_DEPS ${CORE}JsMaterialXCoreMinimal.cpp\n    ${CORE}JsExceptions.cpp)',
).replace(
  formatDeps,
  'set(FORMAT_DEPS ${FORMAT}JsMaterialXFormatMinimal.cpp\n    ${FORMAT}JsUtil.cpp\n    ${FORMAT}JsEnviron.cpp)',
);
const buildRoot = mkdtempSync(join(tmpdir(), 'materialx-core-minimal-'));
const env = {
  ...process.env,
  MX_CORE_DIR: join(buildRoot, 'bin'),
  MX_LIB_ROOT: join(sourceRoot, 'libraries'),
};

try {
  writeFileSync(cmakeFile, patchedCmake);
  writeFileSync(bindingFile, readFileSync(coreTemplate));
  writeFileSync(formatBindingFile, readFileSync(formatTemplate));
  run('cmake', [
    '-S', sourceRoot, '-B', buildRoot, '-G', 'Ninja',
    '-DMATERIALX_BUILD_JS=ON',
    `-DMATERIALX_EMSDK_PATH=${emsdkRoot}`,
    '-DMATERIALX_BUILD_GEN_GLSL=OFF',
    '-DMATERIALX_BUILD_GEN_OSL=OFF',
    '-DMATERIALX_BUILD_GEN_MDL=OFF',
    '-DMATERIALX_BUILD_GEN_MSL=OFF',
    '-DMATERIALX_BUILD_GEN_SLANG=OFF',
    '-DMATERIALX_BUILD_RENDER=OFF',
    '-DMATERIALX_BUILD_SHARED_LIBS=OFF',
    '-DCMAKE_BUILD_TYPE=Release',
  ], { cwd: projectRoot });
  run('cmake', ['--build', buildRoot, '--target', 'JsMaterialXCore', '--parallel', '2'], { cwd: projectRoot });
  if (process.platform === 'win32') {
    run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run build:static'], { cwd: projectRoot, env });
  } else {
    run('npm', ['run', 'build:static'], { cwd: projectRoot, env });
  }
} finally {
  try {
    writeFileSync(cmakeFile, originalCmake);
  } finally {
    try {
      rmSync(bindingFile, { force: true });
    } finally {
      try {
        rmSync(formatBindingFile, { force: true });
      } finally {
        rmSync(buildRoot, { recursive: true, force: true });
      }
    }
  }
  if (git(['-C', sourceRoot, 'status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new Error('MaterialX source cleanup was incomplete.');
  }
}
