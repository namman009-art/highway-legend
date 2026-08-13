const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 動態房間管理
const rooms = {};

// 持久化檔案路徑
const DATA_FILE = path.join(__dirname, 'game-data.json');

// 載入持久化資料
let savedProgress = {};
let leaderboard = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        savedProgress = data.savedProgress || {};
        leaderboard = data.leaderboard || [];
        console.log(`已載入存檔資料：${Object.keys(savedProgress).length} 筆進度、${leaderboard.length} 筆排行榜`);
    }
} catch(e) { console.log('載入存檔失敗，使用空資料', e.message); }

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ savedProgress, leaderboard }));
    } catch(e) { console.log('存檔失敗', e.message); }
}

io.on('connection', (socket) => {
    console.log(`有玩家連線進來了: ${socket.id}`);

    // 玩家請求加入房間（支援動態建立）
    socket.on('join-room', (roomId, playerName) => {
        if (!rooms[roomId]) {
            rooms[roomId] = { players: {}, hostId: socket.id };
        }

        const roomPlayers = rooms[roomId].players;
        const playerKeys = Object.keys(roomPlayers);

        if (playerKeys.length >= 4) {
            socket.emit('room-full', '這個房間已經滿了（最多 4 人）！');
            return;
        }

        socket.join(roomId);
        socket.currentRoom = roomId;

        roomPlayers[socket.id] = {
            id: socket.id,
            name: playerName || '車手',
            x: 0, y: 0, angle: 0,
            lap: 1, prevWaypoint: 0,
            isRacing: false, isReady: false,
            model: 'ae86'
        };

        // 如果房間沒有房主（原房主離開），指定新房主
        if (!rooms[roomId].hostId || !roomPlayers[rooms[roomId].hostId]) {
            rooms[roomId].hostId = socket.id;
        }

        console.log(`玩家 ${socket.id} (${playerName}) 加入了 ${roomId} (目前人數: ${playerKeys.length + 1}/4, 房主: ${rooms[roomId].hostId})`);

        // 廣播時附帶房主資訊
        io.to(roomId).emit('update-room-users', roomPlayers, rooms[roomId].hostId);
    });

    // 接收玩家在賽道上的即時位置與狀態，並廣播給同房其他人
    socket.on('player-update', (data) => {
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            let p = rooms[roomId].players[socket.id];
            if (data.x !== undefined) p.x = data.x;
            if (data.y !== undefined) p.y = data.y;
            if (data.angle !== undefined) p.angle = data.angle;
            if (data.lap !== undefined) p.lap = data.lap;
            if (data.speed !== undefined) p.speed = data.speed;
            if (data.prevWaypoint !== undefined) p.prevWaypoint = data.prevWaypoint;
            if (data.model !== undefined) p.model = data.model;
            if (data.isRacing !== undefined) p.isRacing = data.isRacing;
            if (data.isReady !== undefined) p.isReady = data.isReady;
            if (data.inputs !== undefined) p.inputs = data.inputs;

            socket.to(roomId).emit('opponent-move', rooms[roomId].players);
        }
    });

    // 房主請求開始比賽（可附帶賽道索引供同步）
    socket.on('start-online-match', (roomId, trackIdx) => {
        if (!rooms[roomId]) return;
        const count = Object.keys(rooms[roomId].players).length;
        if (count < 2) {
            socket.emit('error-msg', '至少需要 2 名玩家才能開始比賽！');
            return;
        }
        // 只有房主可以開賽
        if (rooms[roomId].hostId !== socket.id) return;
        io.to(roomId).emit('launch-match', trackIdx || 0);
    });

    // 儲存遊戲進度並產生繼承碼
    socket.on('save-progress', (data) => {
        const code = 'INH-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        savedProgress[code] = {
            name: data.name,
            progress: data.progress,
            time: data.time
        };
        socket.emit('progress-saved', code);
        saveData();
    });

    // 載入遊戲進度
    socket.on('load-progress', (code) => {
        const data = savedProgress[code];
        socket.emit('progress-loaded', data || null);
    });

    // 取得排行榜資料（從 leaderboard 陣列讀取）
    socket.on('get-leaderboard', () => {
        let list = leaderboard.map(e => ({ track: e.track, name: e.name, time: e.time }));
        list.sort((a, b) => {
            let ta = a.time.split(':');
            let tb = b.time.split(':');
            return (parseInt(ta[0]) * 60 + parseInt(ta[1]) + (parseFloat(ta[2]) || 0)) - (parseInt(tb[0]) * 60 + parseInt(tb[1]) + (parseFloat(tb[2]) || 0));
        });
        socket.emit('leaderboard-data', list.slice(0, 30));
    });

    // 上傳通關成績
    socket.on('upload-score', (data) => {
        if(!data || !data.track || !data.name || !data.time) return;
        let existing = leaderboard.find(e => e.track === data.track && e.name === data.name);
        if (existing) {
            let ta = data.time.split(':');
            let to = existing.time.split(':');
            let curSec = parseInt(ta[0]) * 60 + parseInt(ta[1]) + (parseFloat(ta[2]) || 0);
            let oldSec = parseInt(to[0]) * 60 + parseInt(to[1]) + (parseFloat(to[2]) || 0);
            if (curSec < oldSec) {
                existing.time = data.time;
            }
        } else {
            leaderboard.push({ track: data.track, name: data.name, time: data.time });
        }
        saveData();
        console.log(`排行榜更新: ${data.name} - ${data.track} - ${data.time}`);
    });

    // 玩家離開或斷線
    socket.on('disconnect', () => {
        console.log(`玩家斷線了: ${socket.id}`);
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            delete rooms[roomId].players[socket.id];
            // 若房主離開，自動指定新房主
            let remaining = Object.keys(rooms[roomId].players);
            if (remaining.length > 0) {
                if (!rooms[roomId].hostId || !rooms[roomId].players[rooms[roomId].hostId]) {
                    rooms[roomId].hostId = remaining[0];
                }
                io.to(roomId).emit('update-room-users', rooms[roomId].players, rooms[roomId].hostId);
            } else {
                delete rooms[roomId];
            }
        }
    });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`多人對戰伺服器已在 port ${PORT} 啟動運行！`);
});
