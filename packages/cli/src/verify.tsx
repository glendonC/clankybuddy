import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { pollForToken } from './auth.js';
import { openInBrowser } from './browser.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export type VerifyVerifiedPayload = {
  token: string;
  refresh_token: string;
  user_id: string;
  handle: string;
  color: string;
};

export function Verify({
  api_base,
  session_token,
  verify_url,
  expires_at,
  onVerified,
  onCancel,
  onTimeout,
}: {
  api_base: string;
  session_token: string;
  verify_url: string;
  expires_at: number;
  onVerified: (payload: VerifyVerifiedPayload) => void;
  onCancel: () => void;
  onTimeout: () => void;
}) {
  // Re-render once a second so the countdown ticks. Polling state is
  // separate (handled inside the polling effect; the spinner just renders).
  const [now, setNow] = useState(() => Date.now());
  const [frame, setFrame] = useState(0);
  // Tracks whether the polling effect has resolved — once it has, useInput
  // handlers go quiet because the parent will swap us out next paint.
  const settledRef = useRef(false);
  // AbortController so the polling loop wakes up immediately on Esc /
  // unmount instead of waiting out its current backoff sleep.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 90);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let cancelled = false;
    void (async () => {
      const result = await pollForToken(api_base, session_token, {
        expires_at,
        signal: ctrl.signal,
      });
      if (cancelled) return;
      settledRef.current = true;
      if (result.kind === 'verified') {
        onVerified({
          token: result.token,
          refresh_token: result.refresh_token,
          user_id: result.user_id,
          handle: result.handle,
          color: result.color,
        });
      } else if (result.kind === 'expired') {
        onTimeout();
      }
      // 'cancelled' is driven by the user pressing Esc — onCancel was
      // already invoked synchronously in the input handler, no double-fire.
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // session_token / api_base / expires_at form the polling-context
    // identity; if any change we want to restart the loop.
  }, [api_base, session_token, expires_at, onTimeout, onVerified]);

  useInput((_char, key) => {
    if (settledRef.current) return;
    if (key.escape) {
      abortRef.current?.abort();
      onCancel();
      return;
    }
    if (key.return) {
      openInBrowser(verify_url);
    }
  });

  const remainingMs = Math.max(0, expires_at - now);
  const totalSec = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const countdown = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
      <Text bold>verify your account</Text>
      <Text color="gray">a one-time browser visit to complete the captcha</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="gray">link:    </Text>
          <Text color="cyan">{verify_url}</Text>
        </Text>
        <Text>
          <Text color="gray">expires: </Text>
          <Text color={totalSec < 30 ? 'red' : 'yellow'}>{countdown}</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          <Text color="yellow">{SPINNER_FRAMES[frame] ?? '⠋'}</Text>
          <Text color="gray"> waiting for browser confirmation…</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          press [Enter] to open in browser  ·  [Esc] to cancel
        </Text>
      </Box>
    </Box>
  );
}
