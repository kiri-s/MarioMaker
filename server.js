const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// ゲーム設定
const GAME_CONFIG = {
    WORLD_WIDTH: 3200,
    WORLD_HEIGHT: 600,
    BLOCK_SIZE: 32,
    GAME_TIME: 300000, // 5分
    MAX_PLAYERS: 8
};

// ゲーム状態
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

// コース生成関数
function generateCourse() {
    const course = [];
    const enemies = [];
    const checkpoints = [];
    
    // 地面を生成
    for (let x = 0; x < GAME_CONFIG.WORLD_WIDTH; x += GAME_CONFIG.BLOCK_SIZE) {
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
    
    // プラットフォームとハザードを生成
    for (let x = 200; x < GAME_CONFIG.WORLD_WIDTH - 200; x += 150 + Math.random() * 200) {
        const height = 100 + Math.random() * 200;
        const width = 60 + Math.random() * 120;
        const platformY = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 2 - height;
        
        // プラットフォーム
        for (let px = x; px < x + width; px += GAME_CONFIG.BLOCK_SIZE) {
            course.push({
                x: px,
                y: platformY,
                type: 'platform',
                width: GAME_CONFIG.BLOCK_SIZE,
                height: GAME_CONFIG.BLOCK_SIZE
            });
        }
        
        // ランダムで障害物
        if (Math.random() < 0.3) {
            course.push({
                x: x + width/2,
                y: platformY - GAME_CONFIG.BLOCK_SIZE,
                type: 'spike',
                width: GAME_CONFIG.BLOCK_SIZE,
                height: GAME_CONFIG.BLOCK_SIZE
            });
        }
    }
    
    // チェックポイントを生成
    for (let i = 1; i < 4; i++) {
        const checkpointX = (GAME_CONFIG.WORLD_WIDTH / 4) * i;
        checkpoints.push({
            x: checkpointX,
            y: GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 4,
            width: GAME_CONFIG.BLOCK_SIZE,
            height: GAME_CONFIG.BLOCK_SIZE * 2,
            id: i
        });
    }
    
    // ゴール
    course.push({
        x: GAME_CONFIG.WORLD_WIDTH - GAME_CONFIG.BLOCK_SIZE * 2,
        y: GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 4,
        type: 'goal',
        width: GAME_CONFIG.BLOCK_SIZE * 2,
        height: GAME_CONFIG.BLOCK_SIZE * 2
    });
    
    // 敵キャラを生成
    for (let x = 300; x < GAME_CONFIG.WORLD_WIDTH - 300; x += 200 + Math.random() * 300) {
        enemies.push({
            id: Math.random().toString(36).substr(2, 9),
            x: x,
            y: GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 3,
            width: GAME_CONFIG.BLOCK_SIZE,
            height: GAME_CONFIG.BLOCK_SIZE,
            velocityX: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1),
            type: 'goomba',
            active: true
        });
    }
    
    return { course, enemies, checkpoints };
}

// ゲーム開始
function startGame() {
    const { course, enemies, checkpoints } = generateCourse();
    gameState.course = course;
    gameState.enemies = enemies;
    gameState.checkpoints = checkpoints;
    gameState.gameStarted = true;
    gameState.startTime = Date.now();
    gameState.finishedPlayers = [];
    
    // 全プレイヤーをリセット
    Object.values(gameState.players).forEach(player => {
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
    
    // ゲームタイマー
    gameState.gameTimer = setTimeout(() => {
        endGame();
    }, GAME_CONFIG.GAME_TIME);
    
    // 敵の更新ループ
    startEnemyUpdate();
}

// 敵の更新
function startEnemyUpdate() {
    setInterval(() => {
        if (!gameState.gameStarted) return;
        
        gameState.enemies.forEach(enemy => {
            if (!enemy.active) return;
            
            enemy.x += enemy.velocityX;
            
            // 壁で反転
            if (enemy.x <= 0 || enemy.x >= GAME_CONFIG.WORLD_WIDTH - enemy.width) {
                enemy.velocityX *= -1;
            }
            
            // プラットフォームの端で反転
            const groundBelow = gameState.course.find(block => 
                block.type === 'ground' || block.type === 'platform' &&
                enemy.x + enemy.width > block.x && 
                enemy.x < block.x + block.width &&
                enemy.y + enemy.height <= block.y + 5
            );
            
            if (!groundBelow) {
                enemy.velocityX *= -1;
            }
        });
        
        io.emit('enemyUpdate', gameState.enemies);
    }, 1000 / 60);
}

// ゲーム終了
function endGame() {
    gameState.gameStarted = false;
    if (gameState.gameTimer) {
        clearTimeout(gameState.gameTimer);
        gameState.gameTimer = null;
    }
    
    io.emit('gameEnd', {
        results: gameState.finishedPlayers,
        allPlayers: Object.values(gameState.players)
    });
}

// プレイヤーの衝突チェック
function checkCollisions(player) {
    // 敵との衝突
    gameState.enemies.forEach(enemy => {
        if (!enemy.active) return;
        
        if (player.x < enemy.x + enemy.width &&
            player.x + player.width > enemy.x &&
            player.y < enemy.y + enemy.height &&
            player.y + player.height > enemy.y) {
            
            // プレイヤーが敵を踏んだ場合
            if (player.velocityY > 0 && player.y < enemy.y) {
                enemy.active = false;
                player.velocityY = -8; // バウンス
                io.emit('enemyDefeated', enemy.id);
            } else {
                // プレイヤーがダメージを受ける（リスポーン）
                respawnPlayer(player);
            }
        }
    });
    
    // チェックポイントとの衝突
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
    
    // ゴールとの衝突
    const goal = gameState.course.find(block => block.type === 'goal');
    if (goal && 
        player.x < goal.x + goal.width &&
        player.x + player.width > goal.x &&
        player.y < goal.y + goal.height &&
        player.y + player.height > goal.y) {
        
        if (!player.finished) {
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
            
            // 全員がゴールしたかチェック
            if (gameState.finishedPlayers.length === Object.keys(gameState.players).length) {
                endGame();
            }
        }
    }

    const activePlayerCount = Object.values(gameState.players).filter(p => !p.isSpectator).length;
    if (gameState.finishedPlayers.length === activePlayerCount) {
        endGame();
    }
}

// プレイヤーリスポーン
function respawnPlayer(player) {
    if (player.currentCheckpoint === 0) {
        player.x = 50;
        player.y = GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.BLOCK_SIZE * 3;
    } else {
        const checkpoint = gameState.checkpoints.find(cp => cp.id === player.currentCheckpoint);
        if (checkpoint) {
            player.x = checkpoint.x;
            player.y = checkpoint.y - GAME_CONFIG.BLOCK_SIZE;
        }
    }
    player.velocityX = 0;
    player.velocityY = 0;
    
    io.emit('playerRespawn', {
        playerId: player.id,
        x: player.x,
        y: player.y
    });
}

// Socket.IO接続処理
io.on('connection', (socket) => {
    console.log('プレイヤーが接続しました:', socket.id);
    
    // プレイヤー参加
    socket.on('joinGame', (playerName) => {
        if (Object.keys(gameState.players).length >= GAME_CONFIG.MAX_PLAYERS) {
            socket.emit('error', 'ゲームが満員です');
            return;
        }

        gameState.players[socket.id] = {
            id: socket.id,
            name: playerName,
            isSpectator: false, // ← 明示的にプレイヤーとして登録
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
            color: `hsl(${Math.random() * 360}, 70%, 50%)`
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
    });
    
    // プレイヤー移動
    socket.on('playerMove', (moveData) => {
        const player = gameState.players[socket.id];
        if (!player || !gameState.gameStarted || player.finished) return;
        
        player.x = moveData.x;
        player.y = moveData.y;
        player.velocityX = moveData.velocityX;
        player.velocityY = moveData.velocityY;
        player.onGround = moveData.onGround;
        
        checkCollisions(player);
        
        socket.broadcast.emit('playerUpdate', {
            playerId: socket.id,
            x: player.x,
            y: player.y,
            velocityX: player.velocityX,
            velocityY: player.velocityY
        });
    });
    
    // チャットメッセージ
    socket.on('chatMessage', (message) => {
        const player = gameState.players[socket.id];
        if (!player) return;
        
        io.emit('chatMessage', {
            playerName: player.name,
            message: message,
            timestamp: Date.now()
        });
    });
    
    // ゲーム開始要求
    socket.on('startGame', () => {
        if (Object.keys(gameState.players).length >= 2 && !gameState.gameStarted) {
            startGame();
        }
    });

    socket.on('playerReady', () => {
        readyPlayers.add(socket.id);
        if (
            readyPlayers.size >= 2 &&
            readyPlayers.size === Object.values(gameState.players).filter(p => !p.isSpectator).length
        ) {
            io.emit('countdownStart');
            setTimeout(() => {
                startGame();
                readyPlayers.clear();
            }, 3000); // 3秒カウントダウン
        }
    });
    
    socket.on('spectate', () => {
        gameState.players[socket.id] = {
            id: socket.id,
            name: '観戦者',
            isSpectator: true
        };

        socket.emit('playerJoined', {
            playerId: null,
            gameConfig: GAME_CONFIG,
            players: gameState.players,
            course: gameState.course,
            enemies: gameState.enemies,
            checkpoints: gameState.checkpoints,
            gameStarted: gameState.gameStarted
        });
    });

    // プレイヤー切断
    socket.on('disconnect', () => {
        console.log('プレイヤーが切断しました:', socket.id);
        delete gameState.players[socket.id];
        socket.broadcast.emit('playerLeft', socket.id);
        
        // 残りプレイヤーが1人以下の場合はゲーム終了
        if (gameState.gameStarted &&
            Object.values(gameState.players).filter(p => !p.isSpectator).length <= 1) {
            endGame();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
});