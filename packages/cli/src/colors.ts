// Ink color resolution, pulls from the shared palette so adding a server
// color name only requires editing packages/shared/src/colors.ts.

import { COLOR_INK, isValidColor } from '../../shared/src/colors.js';

export function colorOf(name: string): string {
  return isValidColor(name) ? COLOR_INK[name] : 'white';
}
