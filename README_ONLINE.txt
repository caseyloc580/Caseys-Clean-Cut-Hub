CASEY'S CLEAN CUT: TURF KART MOWERS - ONLINE BACKEND BUILD

This package adds a real Socket.IO signaling/game-state backend.

FILES
- server.js: Node/Express/Socket.IO backend
- public/index.html: 3D browser game client
- package.json: dependencies/start script

LOCAL TEST
1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Open:
   http://localhost:3000
5. Choose Online Room.
6. Host creates a room and copies the invite link.
7. Open the invite link on another phone/computer on the same network, or deploy the server for internet play.

HOSTING FOR REAL ONLINE PLAY
You must host this whole folder on a Node-capable host. A static file host is not enough.
Good options include a VPS, Render, Railway, Fly.io, or any Node server.

IMPORTANT
- Online play now uses a real backend.
- Host is authoritative and streams game state to the guest.
- Guest sends input to host through Socket.IO.
- Voice chat signaling hooks are in server.js, but the WebRTC microphone UI is not fully wired yet.
- For public internet play, deploy this server and use the deployed URL.
