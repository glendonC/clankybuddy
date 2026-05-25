import { PERSONA_IDS } from '@clankybuddy/shared/personas';

let activeChar = PERSONA_IDS[0];

export function getActiveChar() {
  return activeChar;
}

export function setActiveCharId(id) {
  activeChar = id;
}
