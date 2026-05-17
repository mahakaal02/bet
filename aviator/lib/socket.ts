'use client';

import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { getToken } from './auth';

let current: Socket | null = null;

export function getSocket(): Socket {
  if (current && current.connected) return current;
  if (current) {
    current.disconnect();
    current = null;
  }
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
