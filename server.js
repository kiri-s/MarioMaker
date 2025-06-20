const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(express.static(path.join(__dirname, 'public')));

const GAME_CONFIG = {
    WORLD_WIDTH: 3200,
    WORLD_HEIGHT: 600,
    BLOCK_SIZE: 32,
    GAME_TIME: 90000,
    MAX_PLAYERS: 8
};

let gameState = {
    players: {},
    enemies: [],
    course: [],
    gameStarted: false,
    gameTimer: null,
    startTime: null,
    finishedPlayers: [],
    checkpoints: []
};

let readyPlayers = new Set();

function generateCourse() {
    const course = [];
    const enemies = [];
    const checkpoints = [];

    // 地面（穴あり）
    for (let x = 0; x < GAME_CONFIG.WORLD_WIDTH; x += GAME_CONFIG.BLOCK_SIZE) {
        if (Math.random() < 0.1) {
            x += GAME_CONFIG.BLOCK_SIZE * 2;
            continue;
        }
        for (let y = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 2; y < GAME_CONFIG.WORLD_HEIGHT; y += GAME_CONFIG.BLOCK_SIZE) {
            course.push({
                x: x,
                y: y,
                type: 'ground',
                width: GAME_CONFIG.BLOCK_SIZE,
                height: GAME_CONFIG.BLOCK_SIZE
            });
        }
    }

    // 浮島（ジャンプで届く＋段差）
    for (let x = 200; x < GAME_CONFIG.WORLD_WIDTH - 200; x += 180) {
        const baseY = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 2;
        const jumpHeight = GAME_CONFIG.BLOCK_SIZE * 5;
        const platformY = baseY - (Math.random() < 0.7 ? jumpHeight : jumpHeight * 2);
        const width = 64 + Math.random() * 64;
        for (let px = x; px < x + width; px += GAME_CONFIG.BLOCK_SIZE) {
            course.push({
                x: px,
                y: platformY,
                type: 'platform',
                width: GAME_CONFIG.BLOCK_SIZE,
                height: GAME_CONFIG.BLOCK_SIZE
            });
        }
    }

    for (let i = 1; i < 4; i++) {
        const checkpointX = (GAME_CONFIG.WORLD_WIDTH / 4) * i;
        checkpoints.push({
            x: checkpointX,
            y: GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 3,
            width: GAME_CONFIG.BLOCK_SIZE,
            height: GAME_CONFIG.BLOCK_SIZE * 3,
            id: i
        });
    }

    course.push({
        x: GAME_CONFIG.WORLD_WIDTH - GAME_CONFIG.BLOCK_SIZE * 2,
        y: GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 4,
        type: 'goal',
        width: GAME_CONFIG.BLOCK_SIZE * 2,
        height: GAME_CONFIG.BLOCK_SIZE * 2
    });

    course.push({x:0,y:GAME_CONFIG.WORLD_HEIGHT-GAME_CONFIG.BLOCK_SIZE*2,type:'ground',width:GAME_CONFIG.BLOCK_SIZE,height:GAME_CONFIG.BLOCK_SIZE});
    // 各チェックポイント
    checkpoints.forEach(cp=>{
        course.push({x:cp.x, y:GAME_CONFIG.WORLD_HEIGHT-GAME_CONFIG.BLOCK_SIZE*2, type:'ground', width:GAME_CONFIG.BLOCK_SIZE, height:GAME_CONFIG.BLOCK_SIZE});
    });

    // 敵をランダムな位置に空中出現させる
    for (let i = 0; i < 20; i++) {
        const type = Math.random() < 0.2 ? 'bird' : (Math.random() < 0.5 ? 'jumper' : 'goomba');
        const spawnX = 100 + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 200);

        let spawnY;
        if (type === 'bird') {
            const minY = GAME_CONFIG.WORLD_HEIGHT * 0.25;
            const maxY = GAME_CONFIG.WORLD_HEIGHT * 0.75;
            spawnY = minY + Math.random() * (maxY - minY);
        } else {
            spawnY = 50 + Math.random() * 100; // 従来の敵（空中または地面近く）
        }

        enemies.push({
            id: Math.random().toString(36).substr(2, 9),
            x: spawnX,
            y: spawnY,
            width: GAME_CONFIG.BLOCK_SIZE,
            height: GAME_CONFIG.BLOCK_SIZE,
            velocityX: (Math.random() < 0.5 ? -1 : 1) * (type === 'bird' ? 1.5 : 0.3 + Math.random() * 0.3),
            velocityY: 0,
            onGround: false,
            type: type,
            jumpCooldown: 100,
            active: true,
            baseY: spawnY,
            time: 0,
            turnCount: 0
        });
    }


    // リスポーン・スタート地点周辺は強制的に地面を生成
    const protectedXs = [0, 50, ...checkpoints.map(cp => cp.x)];
    protectedXs.forEach(x => {
        for (let y = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 2; y < GAME_CONFIG.WORLD_HEIGHT; y += GAME_CONFIG.BLOCK_SIZE) {
            course.push({
                x: x,
                y: y,
                type: 'ground',
                width: GAME_CONFIG.BLOCK_SIZE,
                height: GAME_CONFIG.BLOCK_SIZE
            });
        }
    });

    return { course, enemies, checkpoints };
}

function startGame() {
    if (gameState.gameStarted) return; // 多重呼び出し防止
    const { course, enemies, checkpoints } = generateCourse();
    gameState.course = course;
    gameState.enemies = enemies;
    gameState.checkpoints = checkpoints;
    gameState.gameStarted = true;
    gameState.startTime = Date.now();
    gameState.finishedPlayers = [];

    Object.values(gameState.players).forEach(player => {
        if (player.isSpectator) return;
        player.x = 50;
        player.y = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 3;
        player.velocityX = 0;
        player.velocityY = 0;
        player.finished = false;
        player.finishTime = null;
        player.currentCheckpoint = 0;
    });

    io.emit('gameStart', {
        course: gameState.course,
        enemies: gameState.enemies,
        checkpoints: gameState.checkpoints,
        players: gameState.players
    });

    gameState.gameTimer = setTimeout(() => endGame(), GAME_CONFIG.GAME_TIME);
    startEnemyUpdate();
}

function endGame() {
    gameState.gameStarted = false;
    if (gameState.gameTimer) clearTimeout(gameState.gameTimer);
    io.emit('gameEnd', {
        results: gameState.finishedPlayers,
        allPlayers: Object.values(gameState.players)
    });
}

function startEnemyUpdate() {
    setInterval(() => {
        if (!gameState.gameStarted) return;

        gameState.enemies.forEach(enemy => {
            if (!enemy.active) return;

            if (enemy.y > GAME_CONFIG.WORLD_HEIGHT + 200) {
                enemy.x = 100 + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 200);
                enemy.y = 50 + Math.random() * 100;
                enemy.velocityX = (Math.random() < 0.5 ? -1 : 1) * (enemy.type === 'bird' ? 1.5 : 0.3 + Math.random() * 0.3);
                enemy.velocityY = 0;
                enemy.onGround = false;
                enemy.jumpCooldown = 100;

                // bird 用プロパティ
                enemy.time = 0;
                enemy.baseY = enemy.y;

                // 🔧 折り返し回数をリセット（← 重要！）
                enemy.turnCount = 0;

                return;
            }

            // 🐦 鳥タイプ（空中をふわふわ左右移動）
            if (enemy.type === 'bird') {
                enemy.time += 0.05;
                enemy.y = enemy.baseY + Math.sin(enemy.time) * 40;
                enemy.x += enemy.velocityX;

                const outOfScreen = enemy.x + enemy.width < 0 || enemy.x > GAME_CONFIG.WORLD_WIDTH;

                if (outOfScreen) {
                    // bird を goomba/jumper に変身して再出現
                    const newType = Math.random() < 0.5 ? 'goomba' : 'jumper';
                    const spawnX = 100 + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 200);
                    const spawnY = 50 + Math.random() * 100;

                    enemy.type = newType;
                    enemy.x = spawnX;
                    enemy.y = spawnY;
                    enemy.baseY = undefined;
                    enemy.time = undefined;
                    enemy.velocityX = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.3);
                    enemy.velocityY = 0;
                    enemy.onGround = false;
                    enemy.jumpCooldown = 100;
                    enemy.turnCount = 0; // ← ここ！
                }

                return;
            }

            // jumper のみ地面チェックで折り返す
            if (enemy.type === 'jumper') {
                const lookAheadX = enemy.velocityX > 0
                    ? enemy.x + enemy.width + 2
                    : enemy.x - 2;

                const groundAhead = gameState.course.some(b =>
                    (b.type === 'ground' || b.type === 'platform') &&
                    b.x < lookAheadX &&
                    lookAheadX < b.x + b.width &&
                    Math.abs((enemy.y + enemy.height) - b.y) <= 2
                );

                if (!groundAhead || enemy.x <= 0 || enemy.x + enemy.width >= GAME_CONFIG.WORLD_WIDTH) {
                    enemy.velocityX *= -1;
                }
            } else {
                // goomba は端のみ折り返す
                if (enemy.x <= 0 || enemy.x + enemy.width >= GAME_CONFIG.WORLD_WIDTH) {
                    enemy.velocityX *= -1;
                }
            }

            enemy.x += enemy.velocityX;

            const nextY = enemy.y + enemy.velocityY;
            const solidBelow = gameState.course.some(b => {
                const withinX = (enemy.x + 2) < (b.x + b.width) &&
                                (enemy.x + enemy.width - 2) > b.x;
                const fallingOnto = (enemy.y + enemy.height <= b.y) &&
                                    (nextY + enemy.height >= b.y);
                return (b.type === 'ground' || b.type === 'platform') &&
                       withinX && fallingOnto;
            });

            if (enemy.type === 'jumper') {
                enemy.jumpCooldown--;
                if (solidBelow && enemy.jumpCooldown <= 0) {
                    enemy.velocityY = -10;
                    enemy.jumpCooldown = 120 + Math.random() * 60;
                    enemy.onGround = false;
                }
            }

            if (!solidBelow) {
                enemy.velocityY += 0.5;
                enemy.y += enemy.velocityY;
                enemy.onGround = false;
            } else {
                const landingBlock = gameState.course.find(b =>
                    (b.type === 'ground' || b.type === 'platform') &&
                    (enemy.x + 2) < (b.x + b.width) &&
                    (enemy.x + enemy.width - 2) > b.x &&
                    (enemy.y + enemy.height <= b.y) &&
                    (enemy.y + enemy.height + enemy.velocityY >= b.y)
                );
                if (landingBlock) {
                    enemy.y = landingBlock.y - enemy.height;
                    enemy.velocityY = 0;
                    enemy.onGround = true;
                }
            }
        });

        io.emit('enemyUpdate', gameState.enemies);
    }, 1000 / 60);
}





function checkCollisions(player) {
    gameState.enemies.forEach(enemy => {
        if (!enemy.active) return;
        if (player.x < enemy.x + enemy.width &&
            player.x + player.width > enemy.x &&
            player.y < enemy.y + enemy.height &&
            player.y + player.height > enemy.y) {
            if (player.velocityY > 0 && player.y < enemy.y) {
                enemy.active = false;
                player.velocityY = -8;
                io.emit('enemyDefeated', enemy.id);
            } else {
                respawnPlayer(player);
            }
        }
        if (player.y > GAME_CONFIG.WORLD_HEIGHT + 200) {
            respawnPlayer(player);
        }
    });

    gameState.checkpoints.forEach(checkpoint => {
        if (player.x < checkpoint.x + checkpoint.width &&
            player.x + player.width > checkpoint.x &&
            player.y < checkpoint.y + checkpoint.height &&
            player.y + player.height > checkpoint.y) {
            if (checkpoint.id > player.currentCheckpoint) {
                player.currentCheckpoint = checkpoint.id;
                io.emit('checkpointReached', {
                    playerId: player.id,
                    checkpointId: checkpoint.id
                });
            }
        }
    });

    const goal = gameState.course.find(b => b.type === 'goal');
    if (goal &&
        player.x < goal.x + goal.width &&
        player.x + player.width > goal.x &&
        player.y < goal.y + goal.height &&
        player.y + player.height > goal.y &&
        !player.finished) {
        player.finished = true;
        player.finishTime = Date.now() - gameState.startTime;
        gameState.finishedPlayers.push({
            name: player.name,
            time: player.finishTime,
            rank: gameState.finishedPlayers.length + 1
        });
        io.emit('playerFinished', {
            playerId: player.id,
            name: player.name,
            time: player.finishTime,
            rank: gameState.finishedPlayers.length
        });

        const activeCount = Object.values(gameState.players).filter(p => !p.isSpectator).length;
        if (gameState.finishedPlayers.length === activeCount) {
            endGame();
        }
    }
}

function respawnPlayer(player) {
    if (player.currentCheckpoint === 0) {
        player.x = 50;
        player.y = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 3;
    } else {
        const cp = gameState.checkpoints.find(c => c.id === player.currentCheckpoint);
        player.x = cp.x;
        player.y = cp.y - GAME_CONFIG.BLOCK_SIZE;
    }
    player.velocityX = 0;
    player.velocityY = 0;
    io.emit('playerRespawn', { playerId: player.id, x: player.x, y: player.y });
}

function updatePlayerCounts() {
    const all = Object.values(gameState.players);
    const players = all.filter(p => !p.isSpectator).length;
    const spectators = all.filter(p => p.isSpectator).length;
    io.emit('playerListUpdate', {
        total: all.length,
        players,
        spectators
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (playerName) => {
        if (Object.keys(gameState.players).length >= GAME_CONFIG.MAX_PLAYERS) {
            socket.emit('error', '満員です');
            return;
        }
        gameState.players[socket.id] = {
            id: socket.id,
            name: playerName,
            x: 50,
            y: GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 3,
            width: GAME_CONFIG.BLOCK_SIZE,
            height: GAME_CONFIG.BLOCK_SIZE,
            velocityX: 0,
            velocityY: 0,
            onGround: false,
            finished: false,
            finishTime: null,
            currentCheckpoint: 0,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            isSpectator: false
        };
        socket.emit('playerJoined', {
            playerId: socket.id,
            gameConfig: GAME_CONFIG,
            players: gameState.players,
            course: gameState.course,
            enemies: gameState.enemies,
            checkpoints: gameState.checkpoints,
            gameStarted: gameState.gameStarted
        });
        socket.broadcast.emit('newPlayer', gameState.players[socket.id]);
        updatePlayerCounts();
    });

    socket.on('spectate', () => {
        gameState.players[socket.id] = { id: socket.id, name: '観戦者', isSpectator: true };
        socket.emit('playerJoined', {
            playerId: null,
            gameConfig: GAME_CONFIG,
            players: gameState.players,
            course: gameState.course,
            enemies: gameState.enemies,
            checkpoints: gameState.checkpoints,
            gameStarted: gameState.gameStarted
        });
        updatePlayerCounts();
    });

    socket.on('playerMove', (data) => {
        const p = gameState.players[socket.id];
        if (!p || gameState.gameStarted === false || p.finished || p.isSpectator) return;
        p.x = data.x;
        p.y = data.y;
        p.velocityX = data.velocityX;
        p.velocityY = data.velocityY;
        p.onGround = data.onGround;
        checkCollisions(p);
        socket.broadcast.emit('playerUpdate', { playerId: socket.id, x: p.x, y: p.y, velocityX: p.velocityX, velocityY: p.velocityY });
    });

    socket.on('playerReady', () => {
        readyPlayers.add(socket.id);
        const activePlayers = Object.values(gameState.players).filter(p => !p.isSpectator);
        if (readyPlayers.size >= 2 && readyPlayers.size === activePlayers.length) {
            io.emit('countdownStart');
            setTimeout(() => {
                startGame();
                readyPlayers.clear();
            }, 3000);
        }
        updatePlayerCounts();
    });

    socket.on('chatMessage', (msg) => {
        const player = gameState.players[socket.id];
        if (!player) return;
        io.emit('chatMessage', { playerName: player.name, message: msg });
    });

    socket.on('startGame', () => {
        if (Object.values(gameState.players).filter(p => !p.isSpectator).length >= 2 && !gameState.gameStarted) {
            // startGame();
        }
        updatePlayerCounts();
    });

    socket.on('disconnect', () => {
        readyPlayers.delete(socket.id);
        delete gameState.players[socket.id];
        socket.broadcast.emit('playerLeft', socket.id);
        const remaining = Object.values(gameState.players).filter(p => !p.isSpectator).length;
        if (gameState.gameStarted && remaining <= 1) endGame();
        updatePlayerCounts();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ポート ${PORT} でサーバー起動`));
