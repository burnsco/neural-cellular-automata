import { VERTEX_SHADER, UPDATE_SHADER, RENDER_SHADER } from "./shaders";

type UpdateUniforms = {
  state: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
  mouse: WebGLUniformLocation;
  mouseDelta: WebGLUniformLocation;
  mouseActive: WebGLUniformLocation;
  brushMode: WebGLUniformLocation;
  mutation: WebGLUniformLocation;
  seed: WebGLUniformLocation;
  brushSize: WebGLUniformLocation;
  flow: WebGLUniformLocation;
};

type RenderUniforms = {
  state: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
  bloom: WebGLUniformLocation;
  flow: WebGLUniformLocation;
  interaction: WebGLUniformLocation;
  palette: WebGLUniformLocation;
};

const BRUSH_BLOOM = 0;
const BRUSH_CARVE = 1;
const DESIGN_ORIGINAL = 0;
const DESIGN_HEX_BLOOM = 1;
const DESIGN_SPIRAL_ORBIT = 2;
const DESIGN_MIRROR_LATTICE = 3;

class NCASimulation {
  private static readonly OVERLAY_COLLAPSED_KEY = "nca-overlay-collapsed";

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly updateProgram: WebGLProgram;
  private readonly renderProgram: WebGLProgram;
  private readonly updateUniforms: UpdateUniforms;
  private readonly renderUniforms: RenderUniforms;
  private readonly stateInternalFormat: number;
  private readonly stateType: number;

  private textures: [WebGLTexture, WebGLTexture];
  private framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  private currentIdx = 0;

  private readonly quadBuffer: WebGLBuffer;

  private mousePos: [number, number] = [0, 0];
  private mouseDelta: [number, number] = [0, 0];
  private mouseActive = false;
  private brushMode = BRUSH_BLOOM;
  private hasPointerSample = false;

  private speed = 10;
  private mutation = 0.5;
  private brushSize = 42;
  private bloom = 0.8;
  private flow = 0.08;
  private palette = 0;
  private design = DESIGN_ORIGINAL;
  private paused = false;
  private overlayMinimized = false;
  private overlayEl: HTMLElement | null = null;
  private overlayToggleBtn: HTMLButtonElement | null = null;

  private seed = Math.random();
  private interaction = 0;

  private lastFpsTime = performance.now();
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }
    this.gl = gl;

    const floatTargets = this.supportsFloatTargets();
    this.stateInternalFormat = floatTargets ? gl.RGBA32F : gl.RGBA8;
    this.stateType = floatTargets ? gl.FLOAT : gl.UNSIGNED_BYTE;

    this.updateProgram = this.createProgram(VERTEX_SHADER, UPDATE_SHADER);
    this.renderProgram = this.createProgram(VERTEX_SHADER, RENDER_SHADER);

    this.updateUniforms = {
      state: this.uniform(this.updateProgram, "u_state"),
      resolution: this.uniform(this.updateProgram, "u_resolution"),
      time: this.uniform(this.updateProgram, "u_time"),
      mouse: this.uniform(this.updateProgram, "u_mouse"),
      mouseDelta: this.uniform(this.updateProgram, "u_mouse_delta"),
      mouseActive: this.uniform(this.updateProgram, "u_mouse_active"),
      brushMode: this.uniform(this.updateProgram, "u_brush_mode"),
      mutation: this.uniform(this.updateProgram, "u_mutation"),
      seed: this.uniform(this.updateProgram, "u_seed"),
      brushSize: this.uniform(this.updateProgram, "u_brush_size"),
      flow: this.uniform(this.updateProgram, "u_flow"),
    };

    this.renderUniforms = {
      state: this.uniform(this.renderProgram, "u_state"),
      resolution: this.uniform(this.renderProgram, "u_resolution"),
      time: this.uniform(this.renderProgram, "u_time"),
      bloom: this.uniform(this.renderProgram, "u_bloom"),
      flow: this.uniform(this.renderProgram, "u_flow"),
      interaction: this.uniform(this.renderProgram, "u_interaction"),
      palette: this.uniform(this.renderProgram, "u_palette"),
    };

    this.textures = [this.createTexture(), this.createTexture()];
    this.framebuffers = [
      this.createFramebuffer(this.textures[0]),
      this.createFramebuffer(this.textures[1]),
    ];

    this.quadBuffer = this.createQuadBuffer();

    this.initEvents();
    this.resize();
    this.reset();
    requestAnimationFrame(this.loop);
  }

  private supportsFloatTargets(): boolean {
    const gl = this.gl;
    if (!gl.getExtension("EXT_color_buffer_float")) {
      return false;
    }

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);

    if (!ok) {
      console.warn("Float render targets unavailable; falling back to RGBA8 state textures.");
    }

    return ok;
  }

  private readonly loop = () => {
    if (!this.paused) {
      for (let i = 0; i < this.speed; i += 1) {
        this.update();
      }
    }

    this.updateInteraction();
    this.render();
    this.updateFps();
    requestAnimationFrame(this.loop);
  };

  private uniform(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(program, name);
    if (!location) {
      throw new Error(`Missing uniform: ${name}`);
    }
    return location;
  }

  private createQuadBuffer(): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    if (!buffer) {
      throw new Error("Unable to create quad buffer");
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      this.gl.STATIC_DRAW,
    );

    return buffer;
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create shader");
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }

    return shader;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const vs = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);

    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Unable to create WebGL program");
    }

    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);

    this.gl.deleteShader(vs);
    this.gl.deleteShader(fs);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${this.gl.getProgramInfoLog(program)}`);
    }

    return program;
  }

  private createTexture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error("Unable to create texture");
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.stateInternalFormat,
      this.canvas.width,
      this.canvas.height,
      0,
      this.gl.RGBA,
      this.stateType,
      null,
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);

    return texture;
  }

  private createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const fbo = this.gl.createFramebuffer();
    if (!fbo) {
      throw new Error("Unable to create framebuffer");
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0,
    );

    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer is incomplete");
    }

    return fbo;
  }

  private initEvents() {
    window.addEventListener("resize", () => this.resize());
    this.initOverlayToggle();
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    this.canvas.addEventListener("pointerdown", (event) => {
      this.mouseActive = true;
      this.setBrushMode(event.button === 2 ? BRUSH_CARVE : BRUSH_BLOOM);
      this.canvas.setPointerCapture(event.pointerId);
      this.updatePointer(event.clientX, event.clientY);
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (this.mouseActive && event.pointerType === "mouse") {
        this.setBrushMode((event.buttons & 2) !== 0 ? BRUSH_CARVE : BRUSH_BLOOM);
      }
      this.updatePointer(event.clientX, event.clientY);
    });

    this.canvas.addEventListener("pointerup", () => {
      this.releasePointer();
    });

    this.canvas.addEventListener("pointercancel", () => this.releasePointer());
    this.canvas.addEventListener("lostpointercapture", () => this.releasePointer());
    this.canvas.addEventListener("pointerleave", () => this.releasePointer());

    document.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        this.togglePause();
      } else if (event.key.toLowerCase() === "r") {
        this.reset();
      } else if (event.key.toLowerCase() === "n") {
        this.randomizeSeed();
      } else if (event.key.toLowerCase() === "m") {
        this.toggleOverlay();
      }
    });

    this.bindRange("speed", "speed-val", (value) => {
      this.speed = Math.max(1, Math.floor(value));
      return `${this.speed}`;
    });

    this.bindRange("mutation", "mutation-val", (value) => {
      this.mutation = value;
      return this.mutation.toFixed(2);
    });

    this.bindRange("brush", "brush-val", (value) => {
      this.brushSize = Math.floor(value);
      return `${this.brushSize}`;
    });

    this.bindRange("bloom", "bloom-val", (value) => {
      this.bloom = value;
      return this.bloom.toFixed(2);
    });

    this.bindRange("flow", "flow-val", (value) => {
      this.flow = value;
      return this.flow.toFixed(2);
    });

    const paletteInput = document.getElementById("palette") as HTMLSelectElement | null;
    paletteInput?.addEventListener("change", () => {
      this.palette = parseInt(paletteInput.value, 10) || 0;
    });

    const designInput = document.getElementById("design") as HTMLSelectElement | null;
    designInput?.addEventListener("change", () => {
      this.design = parseInt(designInput.value, 10) || DESIGN_ORIGINAL;
      this.reset();
    });

    const pauseBtn = document.getElementById("pause-btn");
    pauseBtn?.addEventListener("click", () => this.togglePause());

    document.getElementById("reset-btn")?.addEventListener("click", () => this.reset());
    document.getElementById("seed-btn")?.addEventListener("click", () => this.randomizeSeed());

    this.updateStatus();
  }

  private initOverlayToggle() {
    this.overlayEl = document.getElementById("control-overlay");
    this.overlayToggleBtn = document.getElementById("menu-toggle-btn") as HTMLButtonElement | null;
    if (!this.overlayEl || !this.overlayToggleBtn) {
      return;
    }

    try {
      this.overlayMinimized =
        window.localStorage.getItem(NCASimulation.OVERLAY_COLLAPSED_KEY) === "1";
    } catch {
      this.overlayMinimized = false;
    }

    this.overlayToggleBtn.addEventListener("click", () => this.toggleOverlay());
    this.applyOverlayState();
  }

  private toggleOverlay() {
    this.overlayMinimized = !this.overlayMinimized;
    this.applyOverlayState();

    try {
      window.localStorage.setItem(
        NCASimulation.OVERLAY_COLLAPSED_KEY,
        this.overlayMinimized ? "1" : "0",
      );
    } catch {
      // localStorage may be blocked in some browsing modes
    }
  }

  private applyOverlayState() {
    if (!this.overlayEl || !this.overlayToggleBtn) {
      return;
    }

    const expanded = !this.overlayMinimized;
    this.overlayEl.classList.toggle("is-minimized", this.overlayMinimized);
    this.overlayEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    this.overlayToggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    this.overlayToggleBtn.textContent = expanded ? "Minimize" : "Expand";
  }

  private bindRange(inputId: string, valueId: string, onValue: (value: number) => string) {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const valueNode = document.getElementById(valueId);
    if (!input || !valueNode) {
      return;
    }

    const apply = () => {
      const value = parseFloat(input.value);
      valueNode.textContent = onValue(value);
    };

    input.addEventListener("input", apply);
    apply();
  }

  private setBrushMode(mode: number) {
    this.brushMode = mode;
    const brushModeVal = document.getElementById("brush-mode-val");
    if (brushModeVal) {
      brushModeVal.textContent = mode === BRUSH_CARVE ? "Carve" : "Bloom";
    }
  }

  private releasePointer() {
    this.mouseActive = false;
    this.mouseDelta = [0, 0];
    this.hasPointerSample = false;
  }

  private updatePointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (rect.height - (clientY - rect.top)) * scaleY;

    if (this.hasPointerSample) {
      this.mouseDelta = [x - this.mousePos[0], y - this.mousePos[1]];
    } else {
      this.mouseDelta = [0, 0];
      this.hasPointerSample = true;
    }

    this.mousePos = [x, y];
  }

  private updateInteraction() {
    if (this.mouseActive) {
      const motion = Math.hypot(this.mouseDelta[0], this.mouseDelta[1]);
      const target = Math.min(1, 0.2 + motion / Math.max(this.brushSize * 0.7, 1));
      this.interaction += (target - this.interaction) * 0.2;
    } else {
      this.interaction *= 0.94;
    }

    this.mouseDelta = [this.mouseDelta[0] * 0.8, this.mouseDelta[1] * 0.8];
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));

    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);

    this.disposeTargets();
    this.textures = [this.createTexture(), this.createTexture()];
    this.framebuffers = [
      this.createFramebuffer(this.textures[0]),
      this.createFramebuffer(this.textures[1]),
    ];

    this.currentIdx = 0;
    this.reset();
  }

  private disposeTargets() {
    for (const texture of this.textures ?? []) {
      this.gl.deleteTexture(texture);
    }
    for (const framebuffer of this.framebuffers ?? []) {
      this.gl.deleteFramebuffer(framebuffer);
    }
  }

  private randomizeSeed() {
    this.seed = Math.random();
    this.reset();
  }

  private togglePause() {
    this.paused = !this.paused;
    this.updateStatus();
  }

  private updateStatus() {
    const pauseBtn = document.getElementById("pause-btn");
    const stateVal = document.getElementById("state-val");

    if (pauseBtn) {
      pauseBtn.textContent = this.paused ? "Resume" : "Pause";
    }
    if (stateVal) {
      stateVal.textContent = this.paused ? "Paused" : "Running";
    }
  }

  private updateFps() {
    this.fpsFrames += 1;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;

    if (elapsed >= 500) {
      const fps = Math.round((this.fpsFrames * 1000) / elapsed);
      const fpsVal = document.getElementById("fps-val");
      if (fpsVal) {
        fpsVal.textContent = `${fps}`;
      }
      this.fpsFrames = 0;
      this.lastFpsTime = now;
    }
  }

  private reset() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const state = new Float32Array(width * height * 4);

    // Gray-Scott initial state: A=1 (full substrate), B=0 everywhere
    for (let i = 0; i < width * height; i += 1) {
      state[i * 4 + 0] = 1.0; // A — substrate
      state[i * 4 + 1] = 0.0; // B — reactant
      state[i * 4 + 2] = 0.0; // pigment
      state[i * 4 + 3] = 0.18; // vitality
    }

    // Seed clusters: set A=0.5, B=0.25 in small discs
    const placeSeed = (cx: number, cy: number, r: number) => {
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const x = ix + dx;
          const y = iy + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const idx = (y * width + x) * 4;
          state[idx + 0] = 0.5 + (Math.random() - 0.5) * 0.08;
          state[idx + 1] = 0.25 + (Math.random() - 0.5) * 0.06;
          state[idx + 2] = 0.0;
          state[idx + 3] = 0.62 + (Math.random() - 0.5) * 0.08;
        }
      }
    };

    const cx = width * 0.5;
    const cy = height * 0.5;
    const minDim = Math.min(width, height);
    const randomRadius = (min: number, max: number) =>
      min + Math.floor(Math.random() * (max - min + 1));
    const scatterSeeds = (count: number, minRadius: number, maxRadius: number) => {
      for (let i = 0; i < count; i += 1) {
        placeSeed(
          Math.random() * width,
          Math.random() * height,
          randomRadius(minRadius, maxRadius),
        );
      }
    };

    switch (this.design) {
      case DESIGN_HEX_BLOOM: {
        placeSeed(cx, cy, 12);
        for (let ring = 1; ring <= 3; ring += 1) {
          const count = ring * 6;
          const radius = minDim * (0.08 * ring + 0.015 * ring * ring);
          for (let i = 0; i < count; i += 1) {
            const angle = (i / count) * Math.PI * 2 + ((ring % 2) * Math.PI) / count;
            placeSeed(
              cx + Math.cos(angle) * radius,
              cy + Math.sin(angle) * radius,
              randomRadius(4, 7),
            );
          }
        }

        for (let i = 0; i < 6; i += 1) {
          const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const radius = minDim * 0.34;
          placeSeed(
            cx + Math.cos(angle) * radius,
            cy + Math.sin(angle) * radius,
            randomRadius(5, 8),
          );
        }

        scatterSeeds(18, 2, 4);
        break;
      }
      case DESIGN_SPIRAL_ORBIT: {
        placeSeed(cx, cy, 9);
        const goldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));
        for (let i = 0; i < 42; i += 1) {
          const angle = i * goldenAngle;
          const radius = minDim * (0.025 + i * 0.0075);
          const jitter = minDim * 0.004;
          placeSeed(
            cx + Math.cos(angle) * radius + (Math.random() - 0.5) * jitter,
            cy + Math.sin(angle) * radius + (Math.random() - 0.5) * jitter,
            randomRadius(3, 6),
          );
        }

        for (let i = 0; i < 20; i += 1) {
          const angle = (i / 20) * Math.PI * 2 + Math.random() * 0.18;
          const radius = minDim * (0.24 + 0.05 * Math.sin(i * 1.7));
          placeSeed(
            cx + Math.cos(angle) * radius,
            cy + Math.sin(angle) * radius,
            randomRadius(3, 5),
          );
        }

        scatterSeeds(12, 2, 4);
        break;
      }
      case DESIGN_MIRROR_LATTICE: {
        placeSeed(cx, cy, 10);
        const steps = [-0.33, -0.2, -0.1, 0.1, 0.2, 0.33];
        for (const offsetX of steps) {
          for (const offsetY of steps) {
            if (Math.abs(offsetX) === Math.abs(offsetY)) {
              continue;
            }
            placeSeed(cx + width * offsetX, cy + height * offsetY, randomRadius(3, 5));
          }
        }

        for (let i = 0; i < 10; i += 1) {
          const t = (i + 1) / 11;
          const dx = width * (0.08 + t * 0.28);
          const dy = height * (0.06 + t * 0.2);
          placeSeed(cx + dx, cy + dy, randomRadius(3, 6));
          placeSeed(cx - dx, cy + dy, randomRadius(3, 6));
          placeSeed(cx + dx, cy - dy, randomRadius(3, 6));
          placeSeed(cx - dx, cy - dy, randomRadius(3, 6));
        }

        scatterSeeds(10, 2, 3);
        break;
      }
      case DESIGN_ORIGINAL:
      default: {
        placeSeed(cx, cy, 10);

        for (let i = 0; i < 14; i += 1) {
          const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
          const radius = minDim * (0.1 + Math.random() * 0.12);
          placeSeed(
            cx + Math.cos(angle) * radius,
            cy + Math.sin(angle) * radius,
            randomRadius(5, 7),
          );
        }

        scatterSeeds(30, 3, 5);
        break;
      }
    }

    const uploadState = this.stateType === this.gl.FLOAT ? state : this.toByteState(state);

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.currentIdx]);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.stateInternalFormat,
      width,
      height,
      0,
      this.gl.RGBA,
      this.stateType,
      uploadState,
    );
  }

  private toByteState(source: Float32Array): Uint8Array {
    const out = new Uint8Array(source.length);
    for (let i = 0; i < source.length; i += 1) {
      const v = Math.max(0, Math.min(1, source[i]));
      out[i] = Math.round(v * 255);
    }
    return out;
  }

  private update() {
    const nextIdx = 1 - this.currentIdx;

    this.gl.useProgram(this.updateProgram);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.currentIdx]);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[nextIdx]);

    this.gl.uniform1i(this.updateUniforms.state, 0);
    this.gl.uniform2f(this.updateUniforms.resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(this.updateUniforms.time, performance.now() * 0.001);
    this.gl.uniform2f(this.updateUniforms.mouse, this.mousePos[0], this.mousePos[1]);
    this.gl.uniform2f(this.updateUniforms.mouseDelta, this.mouseDelta[0], this.mouseDelta[1]);
    this.gl.uniform1f(this.updateUniforms.mouseActive, this.mouseActive ? 1 : 0);
    this.gl.uniform1i(this.updateUniforms.brushMode, this.brushMode);
    this.gl.uniform1f(this.updateUniforms.mutation, this.mutation);
    this.gl.uniform1f(this.updateUniforms.seed, this.seed);
    this.gl.uniform1f(this.updateUniforms.brushSize, this.brushSize);
    this.gl.uniform1f(this.updateUniforms.flow, this.flow);

    this.drawQuad(this.updateProgram);
    this.currentIdx = nextIdx;
  }

  private render() {
    this.gl.useProgram(this.renderProgram);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.currentIdx]);

    this.gl.uniform1i(this.renderUniforms.state, 0);
    this.gl.uniform2f(this.renderUniforms.resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(this.renderUniforms.time, performance.now() * 0.001);
    this.gl.uniform1f(this.renderUniforms.bloom, this.bloom);
    this.gl.uniform1f(this.renderUniforms.flow, this.flow);
    this.gl.uniform1f(this.renderUniforms.interaction, this.interaction);
    this.gl.uniform1i(this.renderUniforms.palette, this.palette);

    this.drawQuad(this.renderProgram);
  }

  private drawQuad(program: WebGLProgram) {
    const position = this.gl.getAttribLocation(program, "position");
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.enableVertexAttribArray(position);
    this.gl.vertexAttribPointer(position, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("nca-canvas") as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error("Missing #nca-canvas");
  }

  new NCASimulation(canvas);
});
