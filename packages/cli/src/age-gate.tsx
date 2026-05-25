// Ink age-gate screen. Renders the same legal copy as the web modal —
// strings imported from @clankybuddy/shared/age-gate so the prompt's legal
// meaning never drifts between surfaces. On confirm we persist a record
// into the v2 config blob (see config.ts comment) and the parent flips
// Phase from 'age_gate' onward. On decline we exit cleanly via useApp().
//
// Selection UX:
//   ← / →             move highlight between Yes / No
//   Enter / Space     activate the highlighted option
//   Y / y             confirm (shortcut, regardless of highlight)
//   N / n / Esc       decline (shortcut, regardless of highlight)
//   Ctrl-C / Ctrl-D   hard exit
//
// Visuals:
//   - Title is a 3-row block-letter rendering of "clankybuddy" via
//     ink-big-text (font: 'tiny' so it fits in ~50-col terminals) with a
//     cyan→blue gradient.
//   - Selected button is a solid cyan pill with bold dark text;
//     unselected is a recessed dark pill so both options read as
//     "buttons" but the selected one pops.
//   - The consent disclosure is one continuous Text run with ANSI
//     escapes embedded inline so Ink wraps it across the available width
//     instead of fragmenting "Terms of Service" / "Privacy Policy"
//     across multiple Text siblings.

import { Box, Text, useApp, useInput } from 'ink';
import { useState } from 'react';
import {
  AGE_GATE_DECLINE,
  AGE_GATE_CONFIRM_LABEL,
  AGE_GATE_DECLINE_LABEL,
} from '../../shared/src/age-gate.js';
import { TOS_URL, PRIVACY_URL } from '../../shared/src/urls.js';
import { ShimmerTitle } from './shimmer-title.js';

type Choice = 'yes' | 'no';

// ANSI escape helpers. We embed these directly in a single Text run so
// Ink's word-wrap operates on a continuous string instead of trying to
// flow across multiple Text siblings (which produced the fragmentation
// in the original layout).
const ESC = '';
const BEL = '';
const CYAN = `${ESC}[36m`;
const RESET_FG = `${ESC}[39m`;
const UNDERLINE = `${ESC}[4m`;
const RESET_UL = `${ESC}[24m`;

// OSC 8 hyperlink wrapper. iTerm2, macOS Terminal (Sonoma+), Wezterm,
// Kitty, Alacritty, GNOME Terminal, and Konsole all honor this; the rest
// drop the escape and render plain text — which is fine, the link words
// are also styled with cyan + underline so they read as links visually
// either way.
function link(label: string, url: string): string {
  const open = `${ESC}]8;;${url}${BEL}`;
  const close = `${ESC}]8;;${BEL}`;
  return `${CYAN}${UNDERLINE}${open}${label}${close}${RESET_UL}${RESET_FG}`;
}

const CONSENT_LINE =
  `By continuing you accept the ${link('Terms of Service', TOS_URL)} and ${link('Privacy Policy', PRIVACY_URL)}.`;

export function AgeGate({
  onConfirm,
  onDecline,
}: {
  onConfirm: () => void;
  onDecline?: () => void;
}) {
  const { exit } = useApp();
  const [declined, setDeclined] = useState(false);
  // Default to 'yes' — most users are 13+, this is the path forward.
  // 'no' is destructive (quits the app), so don't surface it as default.
  const [choice, setChoice] = useState<Choice>('yes');

  const confirm = () => onConfirm();
  const decline = () => {
    setDeclined(true);
    onDecline?.();
    // Brief render of the goodbye copy, then exit. setTimeout keeps the
    // text on screen long enough for the user to read it; Ink's app
    // exits cleanly on the next tick.
    setTimeout(() => exit(), 800);
  };

  useInput((char, key) => {
    if (declined) return;
    if (key.ctrl && (char === 'c' || char === 'd')) {
      exit();
      return;
    }
    // Direct shortcuts — work regardless of current highlight.
    if (char === 'y' || char === 'Y') {
      confirm();
      return;
    }
    if (char === 'n' || char === 'N' || key.escape) {
      decline();
      return;
    }
    // Arrow / hjkl / Tab navigation.
    if (key.leftArrow || char === 'h') {
      setChoice('yes');
      return;
    }
    if (key.rightArrow || char === 'l') {
      setChoice('no');
      return;
    }
    if (key.tab) {
      setChoice((c) => (c === 'yes' ? 'no' : 'yes'));
      return;
    }
    // Activate the highlighted choice.
    if (key.return || char === ' ') {
      if (choice === 'yes') confirm();
      else decline();
      return;
    }
  });

  if (declined) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <ShimmerTitle text="bye." />
        <Box marginTop={1}><Text>{AGE_GATE_DECLINE}</Text></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
      <ShimmerTitle text="clankybuddy" />
      <Box marginTop={1}><Text color="white">you're 13 or over, right?</Text></Box>
      <Box marginTop={1}>
        {/* Single Text run so Ink can wrap normally. ANSI escapes inline
            color the link words and OSC-8 makes them clickable on
            terminals that support it. */}
        <Text>{CONSENT_LINE}</Text>
      </Box>
      <Box marginTop={1}>
        <Pill label={AGE_GATE_CONFIRM_LABEL} selected={choice === 'yes'} shortcut="Y" />
        <Box width={2} />
        <Pill label={AGE_GATE_DECLINE_LABEL} selected={choice === 'no'} shortcut="N" />
      </Box>
      <Box marginTop={1}>
        <Text color="white">← → choose  ·  Enter confirm  ·  Esc decline</Text>
      </Box>
    </Box>
  );
}

// Filled pill button. Selected = bright cyan fill, bold dark text.
// Unselected = recessed dark fill, dim text. The leading/trailing spaces
// give the pill horizontal padding without needing a Box wrapper (Box
// doesn't paint a background fill in Ink — only Text does).
function Pill({
  label,
  selected,
  shortcut,
}: {
  label: string;
  selected: boolean;
  shortcut: string;
}) {
  if (selected) {
    return (
      <Text backgroundColor="cyan" color="black" bold>
        {`  ${label}  [${shortcut}]  `}
      </Text>
    );
  }
  return (
    <Text backgroundColor="blackBright" color="white">
      {`  ${label}  [${shortcut}]  `}
    </Text>
  );
}
