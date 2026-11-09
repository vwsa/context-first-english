export interface Capture {
  id: string;
  capturedAt: string;
  selectedText: string;
  context: {
    text: string; selectionStart: number; selectionEnd: number;
    coverage: 'selection-only' | 'excerpt'; sentenceRange: {start: number; end: number} | null;
  };
  source: {
    kind: 'browser' | 'vscode'; title: string | null; url: string | null;
    documentUri: string | null; languageId: string | null;
    lineStart: number | null; lineEnd: number | null;
  };
}
export interface ExplanationResult {
  meaning: string; sentenceTranslation: string | null; contextNote: string; limitations: string[];
}
export interface Explanation extends ExplanationResult {
  provider: string; model: string | null; generatedAt: string;
}
export interface Message {id: string; role: 'user' | 'assistant'; text: string; createdAt: string}
export interface SavedEntry {
  schemaVersion: '0.1'; id: string; capture: Capture; explanation: Explanation | null;
  conversation: Message[]; savedAt: string; updatedAt: string;
}
export interface ProviderContext {
  capture: Capture; explanation: Explanation | null; conversation: Message[];
}
export interface ProviderOptions {signal: AbortSignal; onDelta?: (text: string) => void}
export interface AIProvider {
  explain(capture: Capture, options: ProviderOptions): Promise<Explanation>;
  discuss(context: ProviderContext, options: ProviderOptions): Promise<string>;
  dispose(): void | Promise<void>;
}
export interface Session {
  capture: Capture; explanation: Explanation | null; conversation: Message[];
  status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null;
  discussing: boolean; discussionError: string | null; partialReply: string;
  draft: string; saved: boolean;
}
export interface Settings {codexPath: string; model: string}
export interface AppState {
  session: Session | null; library: SavedEntry[]; settings: Settings;
  connection: {port: number; token: string}; notice: string | null;
}
export type AppAction =
  | {type: 'retry'; captureId: string} | {type: 'cancel'; captureId: string} | {type: 'toggle-save'; captureId: string}
  | {type: 'draft'; captureId: string; text: string} | {type: 'discuss'; captureId: string; text: string; retry?: boolean}
  | {type: 'open-entry'; id: string} | {type: 'delete-entry'; id: string}
  | {type: 'settings'; settings: Settings} | {type: 'open-source'; captureId: string}
  | {type: 'export'} | {type: 'close'} | {type: 'example'} | {type: 'copy-token'} | {type: 'resize'; height:number};
export interface DesktopAPI {
  getState(): Promise<AppState>;
  action(action: AppAction): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
}
