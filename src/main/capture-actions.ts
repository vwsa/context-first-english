import type {SessionController} from '../core/session-controller';
import type {AppAction} from '../shared/types';

const captureActionTypes = new Set(['retry', 'cancel', 'toggle-save', 'draft', 'discuss', 'open-source']);

/** Dispatch against the capture the renderer actually displayed, never a later one. */
export async function dispatchCaptureAction(
  action: AppAction,
  controller: SessionController,
  openSource: () => Promise<void>,
): Promise<boolean> {
  if (!captureActionTypes.has(action.type)) return false;
  const captureId = 'captureId' in action ? action.captureId : undefined;
  if (typeof captureId !== 'string' || !captureId) throw new Error('操作缺少原文标识，请重新选择表达');
  if (captureId !== controller.current?.capture.id) {
    // A delayed keystroke or cancellation is safe to discard. Explicit user actions
    // must report the change so they are not mistaken for a successful save/send.
    if (action.type === 'draft' || action.type === 'cancel') return true;
    throw new Error('表达已切换，请在当前表达中重试此操作');
  }
  switch (action.type) {
    case 'retry': await controller.retry(); break;
    case 'cancel': controller.cancel(); break;
    case 'toggle-save': await controller.toggleSave(); break;
    case 'draft':
      if (typeof action.text !== 'string' || action.text.length > 4000) throw new Error('追问最多输入 4000 个字符');
      controller.setDraft(action.text); break;
    case 'discuss':
      if (typeof action.text !== 'string' || action.text.length > 4000) throw new Error('问题过长');
      await controller.discuss(action.text, action.retry); break;
    case 'open-source': await openSource(); break;
  }
  return true;
}
