import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {AIProvider, Capture, Message, Session} from '../shared/types';
import {Store, type Snapshot} from './store';
import {assertCapture, assertExplanation} from './validation';

interface Job {kind: 'explanation' | 'discussion'; abort: AbortController}
interface Runtime {session: Session; job?: Job}
const errorText = (error: unknown): string => error instanceof Error ? error.message : '操作失败，请重试';

export class SessionController {
  private readonly sessions = new Map<string, Runtime>();
  private currentId: string | null = null;
  private disposed = false;
  private storageOps: Promise<unknown> = Promise.resolve();

  constructor(private provider: AIProvider, private readonly store: Store, private readonly onChange: () => void) {}

  get current(): Session | null {
    const runtime = this.currentId ? this.sessions.get(this.currentId) : undefined;
    return runtime ? structuredClone(runtime.session) : null;
  }
  private active(): Runtime {
    if (this.disposed) throw new Error('应用正在退出');
    const runtime = this.currentId ? this.sessions.get(this.currentId) : undefined;
    if (!runtime) throw new Error('请先选择一个表达');
    return runtime;
  }
  private notify(): void {
    if (this.disposed) return;
    this.onChange();
  }
  private snapshot(runtime: Runtime): Snapshot {
    return structuredClone({capture: runtime.session.capture, explanation: runtime.session.explanation, conversation: runtime.session.conversation});
  }
  private isLive(runtime: Runtime, job: Job): boolean {
    return !this.disposed && this.currentId === runtime.session.capture.id && runtime.job === job && !job.abort.signal.aborted;
  }
  private stop(runtime: Runtime, userInitiated = false): void {
    const job = runtime.job;
    if (!job) return;
    runtime.job = undefined;
    job.abort.abort();
    if (job.kind === 'explanation') {
      runtime.session.status = runtime.session.explanation ? 'ready' : userInitiated ? 'error' : 'idle';
      runtime.session.error = userInitiated ? '解释已取消，可以重试' : null;
    } else {
      runtime.session.discussing = false;
      runtime.session.partialReply = '';
      runtime.session.discussionError = '回复已中断，可以重试';
    }
  }
  private switchTo(runtime: Runtime): void {
    if (this.currentId && this.currentId !== runtime.session.capture.id) {
      const old = this.sessions.get(this.currentId);
      if (old) this.stop(old);
    }
    this.currentId = runtime.session.capture.id;
    runtime.session.saved = !!this.store.getByCapture(runtime.session.capture.id);
  }
  private storage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageOps.then(operation);
    this.storageOps = result.catch(() => undefined);
    return result;
  }
  private async persist(runtime: Runtime, discussion = false): Promise<void> {
    const snapshot = this.snapshot(runtime);
    try {
      await this.storage(() => this.store.updateIfSaved(snapshot));
      runtime.session.saved = !!this.store.getByCapture(snapshot.capture.id);
    } catch (error) {
      const message = `收藏未能更新：${errorText(error)}`;
      if (discussion) runtime.session.discussionError = message; else runtime.session.error = message;
    }
  }

  async receive(capture: Capture): Promise<void> {
    if (this.disposed) throw new Error('应用正在退出');
    assertCapture(capture);
    let runtime = this.sessions.get(capture.id);
    const saved = this.store.getByCapture(capture.id);
    const known = runtime?.session.capture ?? saved?.capture;
    if (known && !isDeepStrictEqual(known, capture)) throw new Error('捕获 ID 已被其他原文使用');
    if (!runtime) {
      runtime = {session: {
        capture: structuredClone(capture), explanation: saved?.explanation ?? null, conversation: saved?.conversation ?? [],
        status: saved?.explanation ? 'ready' : 'idle', error: null,
        discussing: false, discussionError: null, partialReply: '', draft: '', saved: !!saved,
      }};
      this.sessions.set(capture.id, runtime);
    }
    this.switchTo(runtime);
    this.notify();
    if (!runtime.session.explanation && !runtime.job) this.startExplanation(runtime);
  }

  private startExplanation(runtime: Runtime): void {
    this.stop(runtime);
    const job: Job = {kind: 'explanation', abort: new AbortController()};
    runtime.job = job;
    runtime.session.status = 'loading'; runtime.session.error = null;
    const provider = this.provider;
    this.notify();
    void (async () => {
      try {
        const explanation = await provider.explain(structuredClone(runtime.session.capture), {signal: job.abort.signal});
        if (!this.isLive(runtime, job)) return;
        assertExplanation(explanation, runtime.session.capture);
        runtime.session.explanation = structuredClone(explanation);
        runtime.session.status = 'ready'; runtime.session.error = null;
        runtime.job = undefined;
        this.notify();
        await this.persist(runtime);
        this.notify();
      } catch (error) {
        if (!this.isLive(runtime, job)) return;
        runtime.job = undefined;
        runtime.session.status = 'error'; runtime.session.error = errorText(error);
        this.notify();
      }
    })();
  }

  async retry(): Promise<void> {
    const runtime = this.active();
    if (runtime.session.explanation) return;
    this.startExplanation(runtime);
  }
  cancel(): void {this.stop(this.active(), true); this.notify();}

  toggleSave(): Promise<void> {
    const runtime = this.active();
    return this.storage(async () => {
      const entry = this.store.getByCapture(runtime.session.capture.id);
      if (entry) await this.store.remove(entry.id); else await this.store.save(this.snapshot(runtime));
      runtime.session.saved = !!this.store.getByCapture(runtime.session.capture.id);
      this.notify();
    });
  }

  setDraft(text: string): void {
    if (typeof text !== 'string' || text.length > 4000) throw new Error('追问最多输入 4000 个字符');
    this.active().session.draft = text;
    this.notify();
  }

  async discuss(text: string, retry = false): Promise<void> {
    const runtime = this.active();
    if (runtime.job) throw new Error('请等待当前请求完成，或先取消');
    let question: Message;
    if (retry) {
      const last = runtime.session.conversation.at(-1);
      if (!last || last.role !== 'user') throw new Error('没有可以重试的问题');
      question = last;
    } else {
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('请输入不超过 4000 个字符的问题');
      question = {id: randomUUID(), role: 'user', text: text.trim(), createdAt: new Date().toISOString()};
      runtime.session.conversation.push(question);
      runtime.session.draft = '';
    }
    const job: Job = {kind: 'discussion', abort: new AbortController()};
    runtime.job = job;
    runtime.session.discussing = true; runtime.session.discussionError = null; runtime.session.partialReply = '';
    const provider = this.provider;
    this.notify();
    // Persist the submitted question before starting the response. This remains safe if
    // the user switches capture or removes the bookmark while a disk write is pending.
    await this.persist(runtime, true);
    if (!this.isLive(runtime, job)) return;
    const context = this.snapshot(runtime);
    void (async () => {
      try {
        const reply = await provider.discuss(context, {
          signal: job.abort.signal,
          onDelta: delta => {
            if (!this.isLive(runtime, job)) return;
            if (runtime.session.partialReply.length + delta.length > 20000) {
              this.stop(runtime, true);
              runtime.session.discussionError = '回复过长，请缩小问题后重试';
            } else runtime.session.partialReply += delta;
            this.notify();
          },
        });
        if (!this.isLive(runtime, job)) return;
        if (typeof reply !== 'string' || !reply.trim() || reply.length > 20000) throw new Error('AI 回复内容无效，请重试');
        runtime.session.conversation.push({id: randomUUID(), role: 'assistant', text: reply, createdAt: new Date().toISOString()});
        runtime.session.discussing = false; runtime.session.partialReply = ''; runtime.session.discussionError = null;
        runtime.job = undefined;
        this.notify();
        await this.persist(runtime, true);
        this.notify();
      } catch (error) {
        if (!this.isLive(runtime, job)) return;
        runtime.job = undefined;
        runtime.session.discussing = false; runtime.session.partialReply = '';
        runtime.session.discussionError = errorText(error);
        this.notify();
      }
    })();
  }

  async openEntry(id: string): Promise<void> {
    const entry = this.store.list().find(item => item.id === id);
    if (!entry) throw new Error('这条收藏已不存在');
    await this.receive(entry.capture);
  }
  deleteEntry(id: string): Promise<void> {
    return this.storage(async () => {
      const entry = this.store.list().find(item => item.id === id);
      await this.store.remove(id);
      if (entry) {
        const runtime = this.sessions.get(entry.capture.id);
        if (runtime) runtime.session.saved = false;
      }
      this.notify();
    });
  }
  async setProvider(provider: AIProvider): Promise<void> {
    for (const runtime of this.sessions.values()) this.stop(runtime);
    const old = this.provider;
    this.provider = provider;
    this.notify();
    if (old !== provider) await old.dispose();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const runtime of this.sessions.values()) this.stop(runtime);
    await this.storageOps;
    await this.provider.dispose();
  }
}
