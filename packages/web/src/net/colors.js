// Web-side handle color resolution, pulls from the shared palette so adding
// a server color name only requires editing @clankybuddy/shared/colors.

import { COLOR_HEX, isValidColor } from '@clankybuddy/shared/colors';

export function colorOf(name) {
  return isValidColor(name) ? COLOR_HEX[name] : COLOR_HEX.white;
}
