'use client';

import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { getToken } from './auth';

let current: Socket | null = null;

export function getSocket(): Socket {
  // Return the existing instance whenever we have one — even while it's
  // mid-reconnect (`current.connected === false`). socket.io's built-in
  // reconnection (reconnection: true) transparently re-establishes the
  // SAME socket, so tearing it down here would (a) fight that machinery
  // and (b) orphan every listener `useAviator` bound to the original
  // instance — silently killing the live feed (chat, roster, multiplier)
  // until a full remount. A caller that hits this during a transient drop
  // (e.g. ChatPanel's send → getSocket) must get back the live socket,
  // not a fresh listener-less one. Explicit teardown is `disconnectSocket`.
  if (current) return current;
  const token = getToken();
  current = io(api.baseUrl, {
    path: '/aviator/socket.io',
    auth: { token: token ?? '' },
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5_000,
  });
  return current;
}

export function disconnectSocket() {
  current?.disconnect();
  current = null;
}
