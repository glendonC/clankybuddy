// Protocol identity for the chat WS hello frame. Tiny module exists so
// the version string is read in exactly one place and the import graph
// stays one-way (chat-client → protocol-version → shared/chat).
//
// PROTOCOL_VERSION is the wire-shape major version, shared with the
// worker via packages/shared. WEB_CLIENT_VERSION is the surface version
// (web build), distinct from PROTOCOL_VERSION because web releases
// often happen without a wire change. Read from package.json so we
// can't forget to bump it independently.

import { PROTOCOL_VERSION } from '@clankybuddy/shared/chat';
// Vite supports JSON imports natively. Pulling the web package.json keeps
// the surface version single-sourced, bumping `npm version` updates
// the hello frame automatically.
import pkg from '../../package.json';

export { PROTOCOL_VERSION };

export const CLIENT_KIND = 'web';

export const WEB_CLIENT_VERSION = pkg.version || '0.0.0';
