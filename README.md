# Messenger Socket.IO Learning App

A small Messenger-style 1-to-1 chat app for learning Socket.IO.

## Features
- Register/login with bcrypt password hashing and JWT authentication
- Search users
- Send, accept, and reject friend requests
- 1-to-1 messaging
- Messages persisted in `data.json`
- Real-time messages with Socket.IO
- Online/offline presence
- Typing indicator
- Automatic Socket.IO authentication using the JWT
- Responsive UI that works on mobile

## Run in Termux / Node

```bash
cd messenger-socketio
npm install
npm start
```

Then open:

`http://127.0.0.1:3000`

For access from another device on the same network, run the server normally and open the computer/phone's LAN IP on port 3000. If your environment needs an explicit host, use a reverse proxy or set up your network accordingly.

## Test

```bash
npm test
```

The test creates two temporary users, verifies search, friend requests, accepting a request, Socket.IO connection/authentication, real-time message delivery, and message persistence. It removes the test `data.json` first.

## Important learning note

Socket.IO handles real-time communication. Express handles normal HTTP API requests. `data.json` is only a simple learning database; a production app should use a real database and stronger production security/configuration.
