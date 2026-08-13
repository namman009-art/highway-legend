const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {}; 
const globalData = new Map(); 
const leaderboard = []; // 建立排行榜記憶體

io.on('connection', (socket) => {
    // 加入房間
    socket.on('join-room', (roomId, playerName) => {
        if (!rooms[roomId]) rooms[roomId] = { players: {} };
        socket.join(roomId);
        socket.currentRoom = roomId;
        rooms[roomId].players[socket.id] = { id: socket.id, name: playerName, x: 0, y: 0, angle: 0, lap: 1 };
        io.to(roomId).emit('update-room-users', rooms[roomId].players);
    });

    // 房主按下開始遊戲
    socket.on('start-online-match', (roomId) => {
        io.to(roomId).emit('launch-match');
    });

    // 獲取排行榜
    socket.on('get-leaderboard', () => {
        leaderboard.sort((a, b) => a.ms - b.ms); // 依秒數排序
        socket.emit('leaderboard-data', leaderboard.slice(0, 10)); // 回傳前 10 名
    });

    // 儲存進度與通關時間
    socket.on('save-progress', (data) => {
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        globalData.set(code, { name: data.name, progress: data.progress });
        
        if(data.time && data.time !== "00:00.000") {
            let parts = data.time.split(':');
            if(parts.length === 2) {
                let secs = parts[1].split('.');
                let ms = parseInt(parts[0]) * 60000 + parseInt(secs[0]) * 1000 + parseInt(secs[1]);
                leaderboard.push({ name: data.name, time: data.time, ms: ms });
            }
        }
        socket.emit('progress-saved', code);
    });

    socket.on('load-progress', (code) => {
        const data = globalData.get(code);
        socket.emit('progress-loaded', data || null);
    });

    socket.on('player-update', (data) => {
        if (socket.currentRoom && rooms[socket.currentRoom] && rooms[socket.currentRoom].players[socket.id]) {
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

server.listen(process.env.PORT || 3000, () => console.log('Server Live'));
