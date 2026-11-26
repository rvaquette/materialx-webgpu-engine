import type { ImageShaderSettings } from '../materialx/engine-shaders.ts';

export function imageShaderUniformData(settings: ImageShaderSettings): Float32Array {
  return new Float32Array([
    settings.exposure, settings.contrast, settings.saturation, settings.vignette,
    settings.distortion ?? 0, settings.chromaticAberration ?? 0, 0, 0,
  ]);
}

export const imageShaderWgsl = /* wgsl */ `
struct Settings { values: vec4f, lens: vec4f };
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: Settings;

struct VertexOutput {
  @builtin(position) position: vec4f,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var output: VertexOutput;
  output.position = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return output;
}

fn sampleColor(uv: vec2f, dimensions: vec2f) -> vec3f {
  if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { return vec3f(0.0); }
  return textureLoad(source, vec2i(uv * dimensions), 0).rgb;
}

@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(source));
  let uv = position.xy / dimensions;
  let centered = (uv - vec2f(0.5)) * vec2f(dimensions.x / dimensions.y, 1.0);
  let radiusSquared = dot(centered, centered);
  let distorted = vec2f(0.5) + centered * vec2f(dimensions.y / dimensions.x, 1.0)
    * (1.0 + settings.lens.x * radiusSquared);
  let aberration = centered * vec2f(dimensions.y / dimensions.x, 1.0)
    * (settings.lens.y * radiusSquared);
  let red = sampleColor(distorted + aberration, dimensions).r;
  let green = sampleColor(distorted, dimensions).g;
  let blue = sampleColor(distorted - aberration, dimensions).b;
  var color = vec3f(red, green, blue) * exp2(settings.values.x);
  color = (color - vec3f(0.18)) * settings.values.y + vec3f(0.18);
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luminance), color, settings.values.z);
  let vignette = smoothstep(0.35, 0.75, sqrt(radiusSquared) * 1.41421356);
  color *= 1.0 - settings.values.w * vignette;
  return vec4f(color, 1.0);
}
`;

/** A post-display pass with a private source texture, never sampling its output target. */
export class DisplayImageShader {
  readonly #device: GPUDevice;
  readonly #format: GPUTextureFormat;
  #uniform: GPUBuffer | undefined;
  #pipeline: GPURenderPipeline | undefined;
  #settings: ImageShaderSettings | undefined;
  #texture: GPUTexture | undefined;
  #view: GPUTextureView | undefined;
  #bindGroup: GPUBindGroup | undefined;
  #width = 0;
  #height = 0;

  constructor(device: GPUDevice, format: GPUTextureFormat, settings: ImageShaderSettings | undefined) {
    this.#device = device;
    this.#format = format;
    this.#settings = undefined;
    if (settings) this.setSettings(settings);
  }

  get enabled(): boolean {
    return this.#settings !== undefined;
  }

  setSettings(settings: ImageShaderSettings | undefined): void {
    this.#settings = settings ? { ...settings } : undefined;
    if (this.#settings) {
      this.#ensurePipeline();
      this.#device.queue.writeBuffer(this.#uniform!, 0, imageShaderUniformData(this.#settings));
    } else this.resize();
  }

  #ensurePipeline(): void {
    if (this.#pipeline) return;
    const module = this.#device.createShaderModule({ label: 'Post-display image shader', code: imageShaderWgsl });
    this.#pipeline = this.#device.createRenderPipeline({
      label: 'Post-display image shader',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.#format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.#uniform = this.#device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  targetView(width: number, height: number, output: GPUTextureView): GPUTextureView {
    if (!this.enabled) return output;
    this.#ensurePipeline();
    if (width !== this.#width || height !== this.#height) {
      const texture = this.#device.createTexture({
        label: 'Post-display image shader source',
        size: [width, height],
        format: this.#format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      let view: GPUTextureView;
      let bindGroup: GPUBindGroup;
      try {
        view = texture.createView();
        bindGroup = this.#device.createBindGroup({
          layout: this.#pipeline!.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: view },
            { binding: 1, resource: { buffer: this.#uniform! } },
          ],
        });
      } catch (error) {
        texture.destroy();
        throw error;
      }
      this.#texture?.destroy();
      this.#texture = texture;
      this.#view = view;
      this.#bindGroup = bindGroup;
      this.#width = width;
      this.#height = height;
    }
    return this.#view!;
  }

  resize(): void {
    this.#texture?.destroy();
    this.#texture = undefined;
    this.#view = undefined;
    this.#bindGroup = undefined;
    this.#width = 0;
    this.#height = 0;
  }

  record(encoder: GPUCommandEncoder, output: GPUTextureView): void {
    if (!this.enabled || !this.#pipeline || !this.#bindGroup) return;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: output, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, this.#bindGroup);
    pass.draw(3);
    pass.end();
  }

  apply(target: GPUTextureView, width: number, height: number): void {
    if (!this.enabled) return;
    if (width !== this.#width || height !== this.#height || !this.#bindGroup) {
      throw new Error('The image-shader source texture must match the display dimensions.');
    }
    const encoder = this.#device.createCommandEncoder();
    this.record(encoder, target);
    this.#device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.resize();
    this.#uniform?.destroy();
  }
}
