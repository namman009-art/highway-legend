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
        leaderboard.sort((a, b) => a.ms - b.ms); // 依秒數由小到大排序 (計時最短優先)
        socket.emit('leaderboard-data', leaderboard.slice(0, 10)); // 僅回傳前 10 名
    });

    // 自動上傳成績事件 (加入賽道分類與防重複洗榜)
    socket.on('upload-score', (data) => {
        if(data.time && data.time !== "00:00.000" && data.time !== "00:00") {
            let parts = data.time.split(':');
            if(parts.length === 2) {
                let secs = parts[1].split('.');
                let ms = parseInt(parts[0]) * 60000 + parseInt(secs[0]) * 1000 + (secs[1] ? parseInt(secs[1]) : 0);

                // 檢查是否已有該玩家在「同一賽道」的成績
                let existingIndex = leaderboard.findIndex(r => r.name === data.name && r.track === data.track);
                if (existingIndex !== -1) {
                    // 若新成績比舊成績快，則覆蓋
                    if (ms < leaderboard[existingIndex].ms) {
                        leaderboard[existingIndex].time = data.time;
                        leaderboard[existingIndex].ms = ms;
                    }
                } else {
                    // 沒有紀錄則直接新增
                    leaderboard.push({ name: data.name, track: data.track, time: data.time, ms: ms });
                }
                // 重新排序
                leaderboard.sort((a, b) => a.ms - b.ms);
            }
        }
    });

    // 儲存雲端繼承碼進度
    socket.on('save-progress', (data) => {
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        globalData.set(code, { name: data.name, progress: data.progress });
        socket.emit('progress-saved', code);
    });

    // 讀取雲端繼承碼進度
    socket.on('load-progress', (code) => {
        const data = globalData.get(code);
        socket.emit('progress-loaded', data || null);
    });

    // 遊戲內即時座標同步
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
