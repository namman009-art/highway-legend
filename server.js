const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允許你的 Cloudflare 前端網址連線
        methods: ["GET", "POST"]
    }
});

// 定義 3 個房間，每個房間最多容納 4 人，並記錄裡面的玩家
const rooms = {
    room1: { players: {} },
    room2: { players: {} },
    room3: { players: {} }
};

io.on('connection', (socket) => {
    console.log(`有玩家連線進來了: ${socket.id}`);

    // 玩家請求加入房間
    socket.on('join-room', (roomId) => {
        if (!rooms[roomId]) {
            socket.emit('error-msg', '房間不存在！');
            return;
        }

        const roomPlayers = rooms[roomId].players;
        const playerKeys = Object.keys(roomPlayers);

        if (playerKeys.length >= 4) {
            socket.emit('room-full', '這個房間已經滿了（最多 4 人）！');
            return;
        }

        // 將玩家加入房間
        socket.join(roomId);
        socket.currentRoom = roomId;
        
        // 隨機指定一架賽車給玩家
        roomPlayers[socket.id] = {
            id: socket.id,
            x: 0,
            y: 0,
            angle: 0,
            lap: 1
        };

        console.log(`玩家 ${socket.id} 加入了 ${roomId} (目前人數: ${Object.keys(roomPlayers).length}/4)`);

        // 通知該房間所有人最新的玩家名單
        io.to(roomId).emit('update-room-users', roomPlayers);
    });

    // 接收玩家在賽道上的即時位置與狀態，並廣播給同房其他人
    socket.on('player-update', (data) => {
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            let p = rooms[roomId].players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.angle = data.angle;
            p.lap = data.lap;
            p.speed = data.speed;

            // 廣播給同房的其他對手
            socket.to(roomId).emit('opponent-move', rooms[roomId].players);
        }
    });

    // 玩家離開或斷線
    socket.on('disconnect', () => {
        console.log(`玩家斷線了: ${socket.id}`);
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            delete rooms[roomId].players[socket.id];
            // 更新房內其他人
            io.to(roomId).emit('update-room-users', rooms[roomId].players);
        }
    });
});

// 啟動伺服器 (Render 會自動指定 PORT)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`多人對戰伺服器已在 port ${PORT} 啟動運行！`);
});