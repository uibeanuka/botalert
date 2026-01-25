import { io } from 'socket.io-client';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
let socket;

export function getSocket() {
  if (!socket) {
    socket = io(backendUrl, { transports: ['websocket'] });
  }
  return socket;
}
