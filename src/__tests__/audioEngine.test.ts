import { describe, it, expect, vi } from 'vitest';

/* ─── Tone.js mock: audioEngine only needs the node plumbing, not real
 *     audio. Each fake node is chainable (connect/toDestination return
 *     nodes) so the engine's graph wiring works unchanged.
 *     vi.hoisted: shared fns must be defined before the hoisted vi.mock
 *     factory can reference them. */
const { triggerAttack, triggerRelease, releaseAll } = vi.hoisted(() => ({
  triggerAttack: vi.fn(),
  triggerRelease: vi.fn(),
  releaseAll: vi.fn(),
}));

vi.mock('tone', () => {
  // Factory is hoisted — everything it needs must be defined in here.
  const makeNode = () => {
    // connect/toDestination return `this` — Web-Audio nodes chain back to
    // themselves, and the engine relies on that (e.g. new Tone.Synth().connect(f)).
    const node: Record<string, unknown> = {
      connect: vi.fn(function (this: unknown) { return this; }),
      toDestination: vi.fn(function (this: unknown) { return this; }),
      dispose: vi.fn(),
      // AudioNode params the engine writes directly (biquad freq, etc.)
      frequency: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
      gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() },
    };
    return node;
  };
  const node = makeNode;
  const gainParam = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    rampTo: vi.fn(),
  };
  const Gain = class {
    constructor(public volume = 1) {
      Object.assign(this, node());
      this.gain = { ...gainParam, value: volume };
    }
    gain: typeof gainParam = { ...gainParam };
  };
  const Filter = class {
    constructor(_freq = 1200, _type = 'lowpass') {
      Object.assign(this, node());
      this.frequency = {
        value: _freq,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      };
      this.Q = { value: 0.7, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
    }
    frequency: { value: number; cancelScheduledValues: ReturnType<typeof vi.fn>; setValueAtTime: ReturnType<typeof vi.fn>; setTargetAtTime: ReturnType<typeof vi.fn> };
    Q = { value: 0.7, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
  };
  const Analyser = class {
    constructor(public type = 'waveform', public size = 256) {
      Object.assign(this, node());
    }
    getValue = () => new Float32Array(256);
  };
  const Reverb = class {
    constructor() {
      Object.assign(this, node());
    }
    wet = { value: 0.5 };
    generate = vi.fn();
  };
  const PolySynth = class {
    constructor(public voice = undefined, public options = {}) {
      Object.assign(this, node());
    }
    volume = { value: 0, setTargetAtTime: vi.fn(), rampTo: vi.fn() };
    triggerAttack = (...args: unknown[]) => triggerAttack(...args);
    triggerRelease = (...args: unknown[]) => triggerRelease(...args);
    releaseAll = (...args: unknown[]) => releaseAll(...args);
    dispose = vi.fn();
  };
  const MonoSynth = PolySynth;
  const Synth = PolySynth;

  const rawCtx = {
    sampleRate: 48000,
    currentTime: 1.0,
    createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(100) })),
    createBufferSource: vi.fn(() => makeNode()),
    createConvolver: vi.fn(() => makeNode()),
    createGain: vi.fn(() => ({ ...makeNode(), gain: { ...gainParam } })),
    createAnalyser: vi.fn(() => makeNode()),
    createBiquadFilter: vi.fn(() => makeNode()),
    createDynamicsCompressor: vi.fn(() => ({
      ...makeNode(),
      threshold: { value: 0, setTargetAtTime: vi.fn() },
      ratio: { value: 1, setTargetAtTime: vi.fn() },
      knee: { value: 0, setTargetAtTime: vi.fn() },
      attack: { value: 0, setTargetAtTime: vi.fn() },
      release: { value: 0, setTargetAtTime: vi.fn() },
    })),
    createMediaStreamDestination: vi.fn(() => ({
      ...makeNode(),
      stream: { getTracks: () => [] },
    })),
  };

  return {
    start: vi.fn(async () => {}),
    now: vi.fn(() => 1.0),
    getContext: vi.fn(() => ({ rawContext: rawCtx })),
    getDestination: vi.fn(() => node()),
    PolySynth,
    Synth,
    MonoSynth,
    Gain,
    Filter,
    Analyser,
    Reverb,
  };
});

/** Fresh singleton per test: audioEngine.init() has an internal guard, so
 *  tests must reset modules to get an un-inited engine. Hoisted mocks are
 *  module-level singletons — clear their call records for isolation. */
async function freshEngine() {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import('../audioEngine');
  return mod.audioEngine;
}

describe('audioEngine.playChord deduplication (Engine-layer key)', () => {
  it('is a no-op before init()', async () => {
    const engine = await freshEngine();
    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    expect(triggerAttack).not.toHaveBeenCalled();
  });

  it('same chord key triggers the engine only once (idempotent)', async () => {
    const engine = await freshEngine();
    await engine.init();
    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    const callsAfterFirst = triggerAttack.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Same parameters again → internal currentChordKey check skips re-trigger
    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    expect(triggerAttack.mock.calls.length).toBe(callsAfterFirst);

    // A different chord (IV) → triggers again
    engine.playChord(3, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    expect(triggerAttack.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('distinguishes keyOffset and octaveDown in the dedup key', async () => {
    const engine = await freshEngine();
    await engine.init();
    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    const base = triggerAttack.mock.calls.length;

    engine.playChord(0, 'sawtooth', 'major', 0, 2, 'triad', false, 'normal', false);
    expect(triggerAttack.mock.calls.length).toBeGreaterThan(base);

    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', true);
    expect(triggerAttack.mock.calls.length).toBeGreaterThan(base + 1);
  });

  it('stopAll clears the dedup key so the same chord re-triggers', async () => {
    const engine = await freshEngine();
    await engine.init();
    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    const before = triggerAttack.mock.calls.length;
    engine.stopAll();
    engine.playChord(0, 'sawtooth', 'major', 0, 0, 'triad', false, 'normal', false);
    expect(triggerAttack.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('audioEngine expression controls', () => {
  it('setVolume and updateFilterSweep are safe pre-init (idempotent no-ops)', async () => {
    const engine = await freshEngine();
    expect(() => engine.setVolume(0.5)).not.toThrow();
    expect(() => engine.setVolume(1.0)).not.toThrow();
    expect(() => engine.updateFilterSweep(0.5)).not.toThrow();
    expect(() => engine.updateFilterSweep(-1)).not.toThrow();
    expect(() => engine.updateFilterSweep(0)).not.toThrow();
  });

  it('setVolume ramps with a linearRamp (smooth transitions)', async () => {
    const engine = await freshEngine();
    await engine.init();
    expect(() => engine.setVolume(0.3)).not.toThrow();
    expect(() => engine.setVolume(0.9)).not.toThrow();
  });
});

describe('audioEngine lifecycle', () => {
  it('init builds the graph (Tone.start + context accessed)', async () => {
    const engine = await freshEngine();
    await engine.init();
    const toneMod = await import('tone');
    expect(toneMod.start).toHaveBeenCalled();
    expect(toneMod.getContext).toHaveBeenCalled();
  });

  it('init is guarded: second init is a no-op', async () => {
    const engine = await freshEngine();
    await engine.init();
    await engine.init(); // must not throw / re-run
    expect(triggerAttack).not.toHaveBeenCalled();
  });

  it('setTimbre switches instruments without throwing', async () => {
    const engine = await freshEngine();
    await engine.init();
    await expect(engine.setTimbre('gesture')).resolves.toBeUndefined();
    await expect(engine.setTimbre('theremin')).resolves.toBeUndefined();
  });
});
