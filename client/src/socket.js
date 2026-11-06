import { io } from 'socket.io-client';

export function connectSocket(auth) {
  return io('/', {
    auth,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    transports: ['websocket', 'polling'],
  });
}
