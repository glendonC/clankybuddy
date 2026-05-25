// Mock ChatClient · same interface as ws.ts createChatClient but driven by
// a scripted timeline instead of a real WebSocket. Used when isDemoMode().
// No network traffic; no risk of polluting the real room.

import type { ServerEvent } from '../../../shared/src/chat.js';
import type { Config } from '../config.js';
import type { ChatClient, ChatClientEvents } from '../ws.js';
import {
  buildChatScript,
  buildSeedHistory,
} from '../../../shared/src/stats/fixtures/index.js';
import { getScenarioSpec } from './index.js';

export function createMockChatClient(
  config: Config,
  events: ChatClientEvents,
): ChatClient {
  const spec = getScenarioSpec();
  let connected = false;
  let closed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let ownMsgIdx = 0;

  function dispatch(ev: ServerEvent) {
    if (closed) return;
    events.onEvent(ev);
  }

  function scheduleScript() {
    const script = buildChatScript(spec);
    for (const item of script) {
      timers.push(setTimeout(() => dispatch(item.event), item.at));
    }
  }

  function start() {
    // Mimic the connect → connected → history sequence the real client
    // walks through. Status transitions give the Chat header its spinner.
    events.onStatus('connecting');
    timers.push(
      setTimeout(() => {
        if (closed) return;
        connected = true;
        events.onStatus('connected');
        const { history, roomCount } = buildSeedHistory(spec);
        dispatch({ type: 'history', messages: history, roomCount });
        scheduleScript();
      }, 350),
    );
  }

  start();

  return {
    send(content: string) {
      if (!connected || closed) return;
      // Echo the user's own send back as a normal `message` event so the
      // chat surface paints it in inverse like a real round-trip. Delay
      // a hair to match real-world send→broadcast latency.
      const now = Date.now();
      const msg_id = `demo-self-${ownMsgIdx++}-${now}`;
      timers.push(
        setTimeout(() => {
          dispatch({
            type: 'message',
            msg_id,
            handle: config.handle,
            color: config.color,
            content,
            timestamp: new Date().toISOString(),
          });
        }, 80),
      );
    },
    close() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      events.onStatus('disconnected');
    },
    forceReconnect() {
      // Reset and restart the script so /reconnect feels real in demo mode.
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      connected = false;
      events.onStatus('reconnecting');
      timers.push(setTimeout(start, 600));
    },
    hasConnectedOnce() {
      return connected;
    },
  };
}
