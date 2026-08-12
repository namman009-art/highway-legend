const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = { room1: { players: {} }, room2: { players: {} }, room3: { players: {} } };
const globalData = new Map(); // 用來存儲繼承碼對應的進度 { code: {name, progress} }

io.on('connection', (socket) => {
    // 玩家加入房間
    socket.on('join-room', (roomId, playerName) => {
        if (!rooms[roomId]) return;
        socket.join(roomId);
        socket.currentRoom = roomId;
        rooms[roomId].players[socket.id] = { id: socket.id, name: playerName, x: 0, y: 0, angle: 0, lap: 1 };
        io.to(roomId).emit('update-room-users', rooms[roomId].players);
    });

    // 存儲進度並生成繼承碼
    socket.on('save-progress', (data) => {
        const code = Math.random().toString(36).substring(2, 10).toUpperCase(); // 產生 8 碼隨機碼
        globalData.set(code, { name: data.name, progress: data.progress });
        socket.emit('progress-saved', code);
    });

    // 讀取進度
    socket.on('load-progress', (code) => {
        const data = globalData.get(code);
        socket.emit('progress-loaded', data || null);
    });

    socket.on('player-update', (data) => {
        if (socket.currentRoom && rooms[socket.currentRoom].players[socket.id]) {
            rooms[socket.currentRoom].players[socket.id] = { ...rooms[socket.currentRoom].players[socket.id], ...data };
            socket.to(socket.currentRoom).emit('opponent-move', rooms[socket.currentRoom].players);
        }
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom && rooms[socket.currentRoom]) {
            delete rooms[socket.currentRoom].players[socket.id];
            io.to(socket.currentRoom).emit('update-room-users', rooms[socket.currentRoom].players);
        }
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server Live on Port 10000'));
