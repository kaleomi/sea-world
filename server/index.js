import { startServer } from './Server.js';

// Tidewater's multiplayer server.
//   cd server && npm install && npm start      ws://127.0.0.1:5191
//   PORT=6000 npm start / HOST=0.0.0.0 npm start (reachable from other machines)
// In the game: the Online panel (I, then "Online"), or ?server=ws://127.0.0.1:5191 in the address.
startServer();
