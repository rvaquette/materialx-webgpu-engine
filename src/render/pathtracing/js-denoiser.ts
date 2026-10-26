export interface DenoiserModel {
  width: number;
  height: number;
  quality: string;
  hdr: boolean;
  srgb: boolean;
  useTiling: boolean;
  tileSize: number;
  batchSize: number;
  weightsUrl: string;
  outputMode: string;
  flipOutputY: boolean;
  onBackendReady(callback: () => void): () => void;
  execute(input: ImageData): Promise<unknown>;
  abort(): void;
  dispose(): void;
}

interface DenoiserModule {
  Denoiser: new (backend: string, device: GPUDevice) => DenoiserModel;
}

function isDenoiserModule(value: unknown): value is DenoiserModule {
  return typeof value === 'object' && value !== null && 'Denoiser' in value && typeof value.Denoiser === 'function';
}

let instanceId = 0;
export async function loadDenoiser(device: GPUDevice): Promise<DenoiserModel> {
  // The bundle owns a TensorFlow singleton: isolate it across device recoveries.
  const url = new URL(`${import.meta.env.BASE_URL}denoiser/denoiser.js?instance=${++instanceId}`, document.baseURI).href;
  const module: unknown = await import(/* @vite-ignore */ url);
  if (!isDenoiserModule(module)) throw new Error('Invalid JS denoiser module: missing Denoiser export.');
  const model = new module.Denoiser('webgpu', device);
  model.weightsUrl = new URL(`${import.meta.env.BASE_URL}denoiser`, document.baseURI).href;
  model.quality = 'fast';
  model.hdr = false;
  model.srgb = true;
  model.useTiling = true;
  model.tileSize = 256;
  model.batchSize = 1;
  model.outputMode = 'imgData';
  model.flipOutputY = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let detach = () => {};
      let ready = false;
      const timeout = setTimeout(() => { detach(); reject(new Error('JS denoiser WebGPU initialization timed out.')); }, 20000);
      try {
        detach = model.onBackendReady(() => { ready = true; clearTimeout(timeout); detach(); resolve(); });
        if (ready) detach();
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    return model;
  } catch (error) {
    model.dispose();
    throw error;
  }
}

/** One lazy model and one inference at a time; disposal waits for in-flight work. */
export class JsDenoiser {
  #model: DenoiserModel | undefined;
  #loading: Promise<DenoiserModel> | undefined;
  #busy = false;
  #disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly load: (device: GPUDevice) => Promise<DenoiserModel> = loadDenoiser,
  ) {}

  get busy(): boolean {
    return this.#busy;
  }

  async run(input: ImageData): Promise<ImageData> {
    if (this.#disposed) throw new Error('JS denoiser is disposed.');
    if (this.#busy) throw new Error('JS denoiser is already running.');
    this.#busy = true;
    try {
      this.#loading ??= this.load(this.device);
      this.#model = await this.#loading;
      if (this.#disposed) throw new Error('JS denoiser disposed during loading.');
      this.#model.width = input.width;
      this.#model.height = input.height;
      const output = await this.#model.execute(input);
      if (this.#disposed) throw new Error('JS denoiser disposed during inference.');
      if (!(output instanceof ImageData) || output.width !== input.width || output.height !== input.height) {
        throw new Error('JS denoiser returned an invalid image.');
      }
      return output;
    } catch (error) {
      if (!this.#model) this.#loading = undefined;
      throw error;
    } finally {
      this.#busy = false;
      if (this.#disposed) this.#release();
    }
  }

  abort(): void {
    this.#model?.abort();
  }

  dispose(): void {
    this.#disposed = true;
    this.abort();
    if (!this.#busy) this.#release();
  }

  #release(): void {
    this.#model?.dispose();
    this.#model = undefined;
    this.#loading = undefined;
  }
}
