// Ambient module declaration for @moonshine-ai/moonshine-js, which ships no
// TypeScript types (its package.json only points `import` at dist/moonshine.min.js).
// Shapes mirror the package's own src/index.ts / src/transcriber.ts.
declare module "@moonshine-ai/moonshine-js" {
  export interface TranscriberCallbacks {
    onPermissionsRequested?: () => void;
    onError?: (error: unknown) => void;
    onModelLoadStarted?: () => void;
    onModelLoaded?: () => void;
    onTranscribeStarted?: () => void;
    onTranscribeStopped?: () => void;
    onTranscriptionUpdated?: (text: string | undefined) => void;
    onTranscriptionCommitted?: (text: string | undefined, buffer?: AudioBuffer) => void;
    onFrame?: (probability: unknown, frame: Float32Array, ema: number) => void;
    onSpeechStart?: () => void;
    onSpeechEnd?: () => void;
  }

  export interface Settings {
    BASE_ASSET_PATH: {
      MOONSHINE: string;
      ONNX_RUNTIME: string;
      SILERO_VAD: string;
    };
    VERBOSE_LOGGING: boolean;
  }

  export declare class Transcriber {
    constructor(
      modelURL: string,
      callbacks?: Partial<TranscriberCallbacks>,
      useVAD?: boolean,
      precision?: string
    );
    isActive: boolean;
    callbacks: Required<TranscriberCallbacks>;
    load(): Promise<void>;
    attachStream(stream: MediaStream): void;
    start(): Promise<void>;
    stop(): void;
  }

  export declare class MediaElementTranscriber extends Transcriber {
    constructor(
      mediaElement: HTMLMediaElement,
      modelURL: string,
      callbacks?: Partial<TranscriberCallbacks>,
      useVAD?: boolean,
      precision?: string
    );
  }

  export declare class VideoCaptioner extends MediaElementTranscriber {
    constructor(
      videoElement: HTMLVideoElement,
      modelURL: string,
      useVAD?: boolean,
      wrapperStyle?: Partial<CSSStyleDeclaration>,
      captionsStyle?: Partial<CSSStyleDeclaration>,
      commitElementStyle?: Partial<CSSStyleDeclaration>,
      updateElementStyle?: Partial<CSSStyleDeclaration>,
      precision?: string
    );
  }

  export declare const Settings: Settings;
}
