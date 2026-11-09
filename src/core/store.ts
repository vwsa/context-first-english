import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {Capture, Explanation, Message, SavedEntry} from '../shared/types';
import {assertCapture, assertConversation, assertExplanation, assertSavedEntry} from './validation';

export interface Snapshot {capture: Capture; explanation: Explanation | null; conversation: Message[]}

/** A single desktop process owns this store. Every write is serialized and atomic. */
export class Store {
  private entries: SavedEntry[] = [];
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly filePath: string;

  constructor(private readonly dataDir: string) {this.filePath = path.join(dataDir, 'library.json');}

  init(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      await fs.mkdir(this.dataDir, {recursive: true});
      let bytes: string;
      try {bytes = await fs.readFile(this.filePath, 'utf8');}
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {this.initialized = true; return;}
        throw error;
      }
      try {
        const parsed: unknown = JSON.parse(bytes);
        if (!Array.isArray(parsed)) throw new Error('收藏库必须是数组');
        const ids = new Set<string>(), captureIds = new Set<string>();
        for (const entry of parsed) {
          assertSavedEntry(entry);
          if (ids.has(entry.id) || captureIds.has(entry.capture.id)) throw new Error('收藏 ID 重复');
          ids.add(entry.id); captureIds.add(entry.capture.id);
        }
        this.entries = parsed;
        this.initialized = true;
      } catch (error) {
        throw new Error(`收藏库无法读取，原文件未被覆盖：${error instanceof Error ? error.message : '格式错误'}`);
      }
    })().catch(error => {this.initialization = null; throw error;});
    return this.initialization;
  }

  private ready(): void {if (!this.initialized) throw new Error('收藏库尚未初始化');}
  list(): SavedEntry[] {
    this.ready();
    return structuredClone(this.entries).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  }
  getByCapture(captureId: string): SavedEntry | undefined {
    this.ready();
    const entry = this.entries.find(item => item.capture.id === captureId);
    return entry ? structuredClone(entry) : undefined;
  }
  export(): SavedEntry[] {return this.list();}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {this.ready(); return task();});
    this.queue = result.catch(() => undefined);
    return result;
  }

  private merged(snapshot: Snapshot, previous?: SavedEntry): SavedEntry {
    assertCapture(snapshot.capture);
    if (snapshot.explanation !== null) assertExplanation(snapshot.explanation, snapshot.capture);
    assertConversation(snapshot.conversation);
    if (previous && !isDeepStrictEqual(previous.capture, snapshot.capture)) throw new Error('已保存的原文快照不能被修改');
    if (previous?.explanation && snapshot.explanation && !isDeepStrictEqual(previous.explanation, snapshot.explanation)) {
      throw new Error('已完成的解释不能被自动覆盖');
    }
    const oldMessages = previous?.conversation ?? [];
    for (let i = 0; i < Math.min(oldMessages.length, snapshot.conversation.length); i++) {
      if (!isDeepStrictEqual(oldMessages[i], snapshot.conversation[i])) throw new Error('已保存的讨论消息不能被修改');
    }
    const conversation = oldMessages.length > snapshot.conversation.length ? oldMessages : snapshot.conversation;
    const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) : 0)).toISOString();
    const entry: SavedEntry = {
      schemaVersion: '0.1', id: previous?.id ?? randomUUID(), capture: snapshot.capture,
      explanation: previous?.explanation ?? snapshot.explanation, conversation,
      savedAt: previous?.savedAt ?? now, updatedAt: now,
    };
    assertSavedEntry(entry);
    return structuredClone(entry);
  }

  private async write(entries: SavedEntry[]): Promise<void> {
    const temp = path.join(this.dataDir, `.library-${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(entries, null, 2) + '\n', 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      await fs.rename(temp, this.filePath);
      this.entries = entries;
      // The file is committed at rename. Directory fsync is not supported on Windows.
      if (process.platform !== 'win32') {
        const directory = await fs.open(this.dataDir, 'r');
        try {await directory.sync();} finally {await directory.close();}
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temp).catch(error => {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;});
    }
  }

  save(snapshot: Snapshot): Promise<SavedEntry> {
    const copy = structuredClone(snapshot);
    return this.enqueue(async () => {
      const index = this.entries.findIndex(item => item.capture.id === copy.capture.id);
      const previous = index < 0 ? undefined : this.entries[index];
      const entry = this.merged(copy, previous);
      if (previous && isDeepStrictEqual({...entry, updatedAt: previous.updatedAt}, previous)) return structuredClone(previous);
      const next = structuredClone(this.entries);
      if (index < 0) next.push(entry); else next[index] = entry;
      await this.write(next);
      return structuredClone(entry);
    });
  }

  updateIfSaved(snapshot: Snapshot): Promise<void> {
    const copy = structuredClone(snapshot);
    return this.enqueue(async () => {
      const index = this.entries.findIndex(item => item.capture.id === copy.capture.id);
      if (index < 0) return;
      const previous = this.entries[index];
      const entry = this.merged(copy, previous);
      if (isDeepStrictEqual({...entry, updatedAt: previous.updatedAt}, previous)) return;
      const next = structuredClone(this.entries); next[index] = entry;
      await this.write(next);
    });
  }

  remove(entryId: string): Promise<void> {
    return this.enqueue(async () => {
      const next = this.entries.filter(item => item.id !== entryId);
      if (next.length !== this.entries.length) await this.write(next);
    });
  }
}
