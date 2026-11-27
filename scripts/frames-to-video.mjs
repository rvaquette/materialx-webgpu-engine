import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mediabunnyRoot = resolve(root, 'node_modules/mediabunny/dist/modules');
const framePattern = /^frame-(\d{3,})\.png$/i;

async function findFrameSequences(inputDirectory) {
  const sequences = [];
  const visit = async directory => {
    const entries = await readdir(directory, { withFileTypes: true });
    const frames = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isFile()) {
        const match = framePattern.exec(entry.name);
        if (match) {
          const frameIndex = Number(match[1]);
          if (!Number.isSafeInteger(frameIndex)) {
            throw new Error(`Frame number is outside the safe integer range: ${path}`);
          }
          frames.push({ path, name: entry.name, frameIndex });
        }
      } else if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        await visit(path);
      }
    }

    if (frames.length) {
      frames.sort((left, right) => left.frameIndex - right.frameIndex);
      for (let index = 1; index < frames.length; index++) {
        if (frames[index - 1].frameIndex === frames[index].frameIndex) {
          throw new Error(`Duplicate frame number ${frames[index].frameIndex} in ${directory}.`);
        }
      }
      sequences.push({ directory, frames });
    }
  };
  await visit(inputDirectory);
  return sequences.sort((left, right) => left.directory.localeCompare(right.directory));
}

function parsePositiveNumber(value, option, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > maximum) {
    throw new Error(`--${option} must be greater than 0 and no more than ${maximum}.`);
  }
  return number;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function createLocalServer(framePaths, outputPaths, overwrite) {
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(error => {
      console.error(`[video:frames] ${error.message}`);
      if (response.headersSent) response.destroy(error);
      else {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
    });
  });

  async function handleRequest(request, response) {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'POST' && /^\/save\/\d+$/.test(pathname)) {
      const id = pathname.slice('/save/'.length);
      const destination = outputPaths.get(id);
      if (!destination) {
        response.writeHead(404);
        response.end();
        return;
      }
      await mkdir(dirname(destination), { recursive: true });
      const temporaryPath = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
      try {
        await pipeline(request, createWriteStream(temporaryPath, { flags: 'wx' }));
        const info = await stat(temporaryPath);
        if (info.size === 0) throw new Error(`The browser produced an empty video for ${destination}.`);
        if (await pathExists(destination)) {
          if (!overwrite) throw new Error(`Output appeared during export: ${destination}`);
          await rm(destination);
        }
        await rename(temporaryPath, destination);
        response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ bytes: info.size }));
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
      return;
    }

    const frameMatch = /^\/frames\/(\d+)\/([^/]+)$/.exec(pathname);
    if (request.method === 'GET' && frameMatch) {
      const id = frameMatch[1];
      let filename;
      try {
        filename = decodeURIComponent(frameMatch[2]);
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      const path = framePaths.get(`${id}:${filename}`);
      if (!path) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      });
      response.end(await readFile(path));
      return;
    }

    if (request.method === 'GET' && pathname.startsWith('/mediabunny/')) {
      if (pathname === '/mediabunny/src/node.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end('export {};');
        return;
      }
      const modulePath = resolve(mediabunnyRoot, pathname.slice('/mediabunny/'.length));
      const moduleRelativePath = relative(mediabunnyRoot, modulePath);
      if (moduleRelativePath === '..' || moduleRelativePath.startsWith(`..${sep}`) || isAbsolute(moduleRelativePath)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(await readFile(modulePath));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Frame video export</title>
      <script type="importmap">{"imports":{"mediabunny":"/mediabunny/src/index.js"}}</script>`);
  }

  return server;
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string', default: 'mp4' },
      fps: { type: 'string', default: '24' },
      bitrate: { type: 'string', default: '1000000' },
      'keyframe-interval': { type: 'string', default: '0.5' },
      overwrite: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: npm run video:frames -- --input <directory> [--output <directory|file.mp4|file.webm>]\n' +
      '       [--format mp4|webm] [--fps 24] [--bitrate 1000000] [--keyframe-interval 0.5] [--overwrite]\n' +
      'Recursively converts each directory containing frame-NNN.png files into its own video.\n' +
      'Frame numbers determine timestamps; missing numbers are kept as time gaps. Outputs default to <input>/videos/.\n' +
      'MP4 uses H.264; WebM uses VP9. Existing output files are preserved unless --overwrite is specified.');
    return;
  }
  if (!values.input) throw new Error('Provide --input <directory>.');
  if (!['mp4', 'webm'].includes(values.format)) throw new Error('--format must be mp4 or webm.');
  const fps = parsePositiveNumber(values.fps, 'fps', 240);
  const bitrate = parsePositiveNumber(values.bitrate, 'bitrate', 100_000_000);
  const keyFrameInterval = parsePositiveNumber(values['keyframe-interval'], 'keyframe-interval', 60);
  if (!Number.isSafeInteger(bitrate)) throw new Error('--bitrate must be an integer.');

  const inputDirectory = resolve(values.input);
  const inputInfo = await stat(inputDirectory);
  if (!inputInfo.isDirectory()) throw new Error(`--input is not a directory: ${inputDirectory}`);
  const sequences = await findFrameSequences(inputDirectory);
  if (!sequences.length) {
    throw new Error(`No frame-NNN.png sequences found under ${inputDirectory}.`);
  }

  const requestedOutput = values.output ? resolve(values.output) : undefined;
  const outputIsFile = requestedOutput !== undefined && /\.(mp4|webm)$/i.test(requestedOutput);
  if (outputIsFile && sequences.length > 1) {
    throw new Error('--output must be a directory when the input contains multiple frame sequences.');
  }
  if (outputIsFile && !requestedOutput.toLowerCase().endsWith(`.${values.format}`)) {
    throw new Error(`--output extension must match --format ${values.format}.`);
  }
  const outputDirectory = outputIsFile
    ? undefined
    : requestedOutput ?? join(inputDirectory, 'videos');
  const jobs = sequences.map((sequence, index) => {
    const relativeDirectory = relative(inputDirectory, sequence.directory);
    const outputPath = outputIsFile
      ? requestedOutput
      : join(outputDirectory, `${relativeDirectory || basename(inputDirectory)}.${values.format}`);
    return { ...sequence, id: String(index), outputPath };
  });

  const outputOwners = new Map();
  for (const job of jobs) {
    const previous = outputOwners.get(job.outputPath);
    if (previous) throw new Error(`Multiple sequences map to the same output file: ${job.outputPath}`);
    outputOwners.set(job.outputPath, job.directory);
    if (!values.overwrite && await pathExists(job.outputPath)) {
      throw new Error(`Output already exists: ${job.outputPath} (use --overwrite to replace it).`);
    }
  }

  const framePaths = new Map();
  const outputPaths = new Map();
  const browserJobs = jobs.map(job => {
    outputPaths.set(job.id, job.outputPath);
    const frames = job.frames.map(frame => {
      framePaths.set(`${job.id}:${frame.name}`, frame.path);
      return {
        url: `/frames/${job.id}/${encodeURIComponent(frame.name)}`,
        frameIndex: frame.frameIndex,
      };
    });
    return {
      id: job.id,
      label: relative(inputDirectory, job.directory) || basename(inputDirectory),
      outputName: basename(job.outputPath),
      frames,
    };
  });

  const server = createLocalServer(framePaths, outputPaths, values.overwrite);
  let browser;
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The local video server has no TCP address.');
    browser = await chromium.launch({
      headless: true,
      ...(process.env.MX_CHROME
        ? { executablePath: process.env.MX_CHROME }
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(30 * 60 * 1000);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const results = await page.evaluate(async ({ jobs, format, fps, bitrate, keyFrameInterval }) => {
      const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource } =
        await import('mediabunny');
      const withTimeout = (promise, description) => new Promise((resolveTimed, rejectTimed) => {
        const timer = setTimeout(() => rejectTimed(new Error(`${description} timed out.`)), 30 * 60 * 1000);
        promise.then(value => {
          clearTimeout(timer);
          resolveTimed(value);
        }, error => {
          clearTimeout(timer);
          rejectTimed(error);
        });
      });
      const results = [];

      for (const job of jobs) {
        const images = await Promise.all(job.frames.map(({ url }) => new Promise((resolveImage, rejectImage) => {
          const image = new Image();
          image.onload = () => resolveImage(image);
          image.onerror = () => rejectImage(new Error(`Could not load frame ${url}.`));
          image.src = url;
        })));
        const width = images[0].naturalWidth;
        const height = images[0].naturalHeight;
        if (!width || !height || images.some(image =>
          image.naturalWidth !== width || image.naturalHeight !== height)) {
          throw new Error(`${job.label} contains frames with empty or inconsistent dimensions.`);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The browser could not create a 2D canvas context.');
        const formatWriter = format === 'mp4'
          ? new Mp4OutputFormat({ fastStart: 'in-memory' })
          : new WebMOutputFormat();
        const target = new BufferTarget();
        const source = new CanvasSource(canvas, {
          codec: format === 'mp4' ? 'avc' : 'vp9',
          bitrate,
          keyFrameInterval,
          latencyMode: 'quality',
        });
        const output = new Output({ format: formatWriter, target });
        output.addVideoTrack(source, { frameRate: fps, maximumPacketCount: images.length });
        await output.start();
        const encodeStarted = performance.now();
        const firstFrameIndex = job.frames[0].frameIndex;
        let lastKeyFrameTime = -Infinity;
        for (let index = 0; index < images.length; index++) {
          context.drawImage(images[index], 0, 0);
          const frameIndex = job.frames[index].frameIndex;
          const nextFrameIndex = job.frames[index + 1]?.frameIndex ?? frameIndex + 1;
          const timestamp = (frameIndex - firstFrameIndex) / fps;
          const duration = (nextFrameIndex - frameIndex) / fps;
          const keyFrame = index === 0 || timestamp - lastKeyFrameTime >= keyFrameInterval - 1e-9;
          if (keyFrame) lastKeyFrameTime = timestamp;
          await source.add(timestamp, duration, { keyFrame });
        }
        source.close();
        await output.finalize();
        const encodeMs = Math.round(performance.now() - encodeStarted);
        if (!target.buffer) throw new Error(`${job.label} did not produce a finalized video.`);

        const mimeType = await output.getMimeType();
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.src = URL.createObjectURL(new Blob([target.buffer], { type: mimeType }));
        await withTimeout(new Promise((resolveMetadata, rejectMetadata) => {
          video.onloadedmetadata = resolveMetadata;
          video.onerror = () => rejectMetadata(new Error(`${job.label} video could not be opened by Chrome.`));
        }), `${job.label} video metadata`);
        const firstFrame = new Promise(resolveFrame => {
          video.requestVideoFrameCallback((_, metadata) => resolveFrame(metadata));
        });
        await video.play();
        const firstFrameMetadata = await withTimeout(firstFrame, `${job.label} first decoded frame`);
        if (Math.round(firstFrameMetadata.mediaTime * fps) !== 0) {
          throw new Error(`${job.label} video did not start at timestamp zero.`);
        }
        video.pause();
        URL.revokeObjectURL(video.src);

        const response = await fetch(`/save/${job.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: target.buffer,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error ?? `${job.label} output could not be saved (${response.status}).`);
        }
        const { bytes } = await response.json();
        results.push({
          id: job.id,
          label: job.label,
          output: job.outputName,
          frames: images.length,
          frameRange: [job.frames[0].frameIndex, job.frames.at(-1).frameIndex],
          resolution: `${width}x${height}`,
          durationSeconds: Number(video.duration.toFixed(3)),
          mimeType,
          encodedBytes: bytes,
          encodeMs,
        });
      }
      return results;
    }, { jobs: browserJobs, format: values.format, fps, bitrate, keyFrameInterval });

    for (const result of results) {
      const job = jobs.find(candidate => candidate.id === result.id);
      console.log(`${result.label}: ${result.frames} frames ${result.resolution}, ` +
        `${result.durationSeconds}s, ${result.encodedBytes} bytes, encoded in ${result.encodeMs} ms`);
      console.log(`  ${job.outputPath}`);
    }
  } finally {
    await browser?.close();
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close(error => error ? rejectClose(error) : resolveClose());
      });
    }
  }
}

main().catch(error => {
  console.error(`[video:frames] ${error.message}`);
  process.exitCode = 1;
});
