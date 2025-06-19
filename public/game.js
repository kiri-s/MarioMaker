class Game {
    constructor() {
        this.socket = io();
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.minimapCanvas = document.getElementById('minimap');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
        
        // ゲーム状態
        this.players = {};
        this.myPlayerId = null;
        this.course = [];
        this.enemies = [];
        this.checkpoints = [];
        this.gameConfig = null;
        this.gameStarted = false;
        this.camera = { x: 0, y: 0 };
        this.keys = {};
        this.gameStartTime = null;
        
        // 物理定数
        this.GRAVITY = 0.6;
        this.JUMP_FORCE = -12;
        this.MOVE_SPEED = 4;
        this.FRICTION = 0.8;
        
        this.setupCanvas();
        this.setupControls();
        this.setupSocketEvents();
        this.setupUI();

        this.gameLoop();
    }

    setupCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.minimapCanvas.width = 200;
        this.minimapCanvas.height = 50;
        
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        });
    }

    setupControls() {
        // キーボード入力
        document.addEventListener('keydown', (e) => {
            // チャット入力中は移動キーを無効化
            if (document.activeElement === document.getElementById('chatInput')) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendChatMessage();
                }
                return;
            }
            
            // プレイヤー名入力中
            if (document.activeElement === document.getElementById('playerNameInput')) {
                return;
            }
            
            this.keys[e.key.toLowerCase()] = true;
            
            if (e.key === 'Enter') {
                e.preventDefault();
                const chatInput = document.getElementById('chatInput');
                chatInput.focus();
            }
            
            // デフォルトの動作を防ぐ（スペースキーでページスクロールなど）
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
                e.preventDefault();
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });

        // チャット入力
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
        
        // チャット入力のフォーカス処理
        document.getElementById('chatInput').addEventListener('blur', () => {
            // フォーカスが外れた時にキー状態をリセット
            this.keys = {};
        });
    }

    setupSocketEvents() {
        this.socket.on('playerJoined', (data) => {
            this.myPlayerId = data.playerId;
            this.gameConfig = data.gameConfig;
            this.players = data.players;
            this.course = data.course || [];
            this.enemies = data.enemies || [];
            this.checkpoints = data.checkpoints || [];
            this.gameStarted = data.gameStarted;
            
            // プレイヤー数に応じてUIを更新
            this.updateStartButton();
            this.updatePlayerList();
        });

        this.socket.on('newPlayer', (player) => {
            console.log('newplayer');
            this.players[player.id] = player;
            this.updatePlayerList();
            this.updateStartButton();
        });

        this.socket.on('playerLeft', (playerId) => {
            delete this.players[playerId];
            this.updatePlayerList();
            this.updateStartButton();
        });

        this.socket.on('playerUpdate', (data) => {
            if (this.players[data.playerId]) {
                this.players[data.playerId].x = data.x;
                this.players[data.playerId].y = data.y;
                this.players[data.playerId].velocityX = data.velocityX;
                this.players[data.playerId].velocityY = data.velocityY;
            }
        });

        this.socket.on('gameStart', (data) => {
            this.course = data.course;
            this.enemies = data.enemies;
            this.checkpoints = data.checkpoints;
            this.players = data.players;
            this.gameStarted = true;
            this.gameStartTime = Date.now();

            this.updateStartButton();
            this.addChatMessage('システム', 'ゲーム開始！ゴールを目指そう！');
            document.getElementById('startScreen').style.display = 'none';
        });

        this.socket.on('enemyUpdate', (enemies) => {
            this.enemies = enemies;
        });

        this.socket.on('enemyDefeated', (enemyId) => {
            const enemy = this.enemies.find(e => e.id === enemyId);
            if (enemy) {
                enemy.active = false;
                this.showFloatingText(enemy.x, enemy.y, '+100');
            }
        });

        this.socket.on('playerRespawn', (data) => {
            if (this.players[data.playerId]) {
                this.players[data.playerId].x = data.x;
                this.players[data.playerId].y = data.y;
            }
        });

        this.socket.on('checkpointReached', (data) => {
            const player = this.players[data.playerId];
            if (player) {
                if (data.playerId === this.myPlayerId) {
                    this.showCheckpointMessage(data.checkpointId);
                }
                this.addChatMessage('システム', `${player.name}がチェックポイント${data.checkpointId}を通過！`);
            }
        });

        this.socket.on('playerFinished', (data) => {
            const player = this.players[data.playerId];
            if (player) {
                player.finished = true;
                const timeStr = this.formatTime(data.time);
                this.addChatMessage('システム', `🏆 ${data.name}が${data.rank}位でゴール！ (${timeStr})`);
            }
        });

        this.socket.on('gameEnd', (data) => {
            this.gameStarted = false;
            this.showGameResults(data.results, data.allPlayers);
        });

        this.socket.on('chatMessage', (data) => {
            this.addChatMessage(data.playerName, data.message);
        });

        this.socket.on('error', (message) => {
            alert(message);
        });
    }

    setupUI() {
        document.getElementById('joinButton').addEventListener('click', () => {
            const playerName = document.getElementById('playerNameInput').value.trim();
            if (playerName) {
                this.socket.emit('joinGame', playerName);
                
                // ✅ 参加ボタンを非表示にする処理を追加
                document.getElementById('joinButton').style.display = 'none';
                document.getElementById('playerNameInput').style.display = 'none';
            } else {
                alert('プレイヤー名を入力してください');
            }
        });

        document.getElementById('newGameButton').addEventListener('click', () => {
            document.getElementById('gameEndScreen').style.display = 'none';
            document.getElementById('startScreen').style.display = 'flex';
            
            // ✅ 再度参加ボタンと名前入力欄を表示
            document.getElementById('joinButton').style.display = 'inline-block';
            document.getElementById('playerNameInput').style.display = 'inline-block';

            document.getElementById('startGameButton').style.display = 'none';
            document.getElementById('waitingMessage').style.display = 'none';
        });
        // Enter キーでプレイヤー名入力
        document.getElementById('playerNameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('joinButton').click();
            }
        });

        document.getElementById('startGameButton').addEventListener('click', () => {
            this.socket.emit('playerReady');
            document.getElementById('startGameButton').disabled = true;
            document.getElementById('waitingMessage').textContent = '他のプレイヤーを待っています...';
            document.getElementById('waitingMessage').style.display = 'block';
        });

        this.socket.on('countdownStart', () => {
            let countdown = 3;
            const countdownDiv = document.createElement('div');
            countdownDiv.id = 'countdownOverlay';
            countdownDiv.style.position = 'absolute';
            countdownDiv.style.top = '50%';
            countdownDiv.style.left = '50%';
            countdownDiv.style.transform = 'translate(-50%, -50%)';
            countdownDiv.style.fontSize = '64px';
            countdownDiv.style.color = 'white';
            countdownDiv.style.zIndex = 2000;
            countdownDiv.style.fontWeight = 'bold';
            countdownDiv.style.textShadow = '2px 2px 8px black';
            document.body.appendChild(countdownDiv);

            const interval = setInterval(() => {
                if (countdown > 0) {
                    countdownDiv.textContent = countdown;
                    countdown--;
                } else {
                    countdownDiv.textContent = 'GO!!';
                    clearInterval(interval);
                    
                    // ✅ 1秒後に消す
                    setTimeout(() => {
                        if (document.body.contains(countdownDiv)) {
                            document.body.removeChild(countdownDiv);
                        }
                    }, 1000);
                }
            }, 1000);
        });

        document.getElementById('spectateButton').addEventListener('click', () => {
            this.socket.emit('spectate');
            document.getElementById('startScreen').style.display = 'none';
        });
    }

    updatePlayerMovement() {
        if (!this.gameStarted || !this.myPlayerId || !this.players[this.myPlayerId] || !this.gameConfig) return;

        const player = this.players[this.myPlayerId];
        if (player.finished) return;

        let moveX = 0;
        
        // 移動入力
        if (this.keys['a'] || this.keys['arrowleft']) {
            moveX = -this.MOVE_SPEED;
        }
        if (this.keys['d'] || this.keys['arrowright']) {
            moveX = this.MOVE_SPEED;
        }

        // ジャンプ入力
        if ((this.keys['w'] || this.keys['arrowup'] || this.keys[' ']) && player.onGround) {
            player.velocityY = this.JUMP_FORCE;
            player.onGround = false;
        }

        // 横移動
        player.velocityX = moveX;

        // 重力適用
        if (!player.onGround) {
            player.velocityY += this.GRAVITY;
        }

        // 位置更新
        player.x += player.velocityX;
        player.y += player.velocityY;

        // 地面との衝突判定
        player.onGround = false;
        this.course.forEach(block => {
            if (block.type === 'ground' || block.type === 'platform') {
                if (this.checkBlockCollision(player, block)) {
                    // 上から衝突（地面に着地）
                    if (player.velocityY > 0 && player.y < block.y) {
                        player.y = block.y - player.height;
                        player.velocityY = 0;
                        player.onGround = true;
                    }
                    // 下から衝突（天井）
                    else if (player.velocityY < 0 && player.y > block.y) {
                        player.y = block.y + block.height;
                        player.velocityY = 0;
                    }
                    // 左右の衝突
                    else if (player.velocityX > 0 && player.x < block.x) {
                        player.x = block.x - player.width;
                    }
                    else if (player.velocityX < 0 && player.x > block.x) {
                        player.x = block.x + block.width;
                    }
                }
            }
        });

        // 世界の境界
        if (player.x < 0) player.x = 0;
        if (player.x > this.gameConfig.WORLD_WIDTH - player.width) {
            player.x = this.gameConfig.WORLD_WIDTH - player.width;
        }
        if (player.y > this.gameConfig.WORLD_HEIGHT) {
            // 奈落に落下した場合のリスポーン
            this.socket.emit('playerMove', {
                x: player.x,
                y: player.y,
                velocityX: player.velocityX,
                velocityY: player.velocityY,
                onGround: player.onGround
            });
            return;
        }

        // サーバーに移動データを送信
        this.socket.emit('playerMove', {
            x: player.x,
            y: player.y,
            velocityX: player.velocityX,
            velocityY: player.velocityY,
            onGround: player.onGround
        });
    }

    checkBlockCollision(player, block) {
        return player.x < block.x + block.width &&
               player.x + player.width > block.x &&
               player.y < block.y + block.height &&
               player.y + player.height > block.y;
    }

    updateCamera() {
        if (!this.myPlayerId || !this.players[this.myPlayerId] || !this.gameConfig) return;

        const player = this.players[this.myPlayerId];
        
        // カメラをプレイヤーに追従
        this.camera.x = player.x - this.canvas.width / 2;
        this.camera.y = player.y - this.canvas.height / 2;

        // カメラの境界制限
        this.camera.x = Math.max(0, Math.min(this.camera.x, this.gameConfig.WORLD_WIDTH - this.canvas.width));
        this.camera.y = Math.max(0, Math.min(this.camera.y, this.gameConfig.WORLD_HEIGHT - this.canvas.height));
    }

    render() {
        // 画面クリア
        this.ctx.fillStyle = 'linear-gradient(to bottom, #87CEEB 0%, #87CEEB 70%, #90EE90 70%, #90EE90 100%)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 背景グラデーション
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(0.7, '#87CEEB');
        gradient.addColorStop(0.7, '#90EE90');
        gradient.addColorStop(1, '#90EE90');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        this.ctx.translate(-this.camera.x, -this.camera.y);

        // コースを描画
        this.course.forEach(block => {
            this.ctx.fillStyle = this.getBlockColor(block.type);
            this.ctx.fillRect(block.x, block.y, block.width, block.height);
            
            // ブロックの枠線
            this.ctx.strokeStyle = '#333';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(block.x, block.y, block.width, block.height);
        });

        // チェックポイントを描画
        this.checkpoints.forEach(checkpoint => {
            this.ctx.fillStyle = '#FFD700';
            this.ctx.fillRect(checkpoint.x, checkpoint.y, checkpoint.width, checkpoint.height);
            
            // チェックポイントマーク
            this.ctx.fillStyle = '#FF6B6B';
            this.ctx.fillRect(checkpoint.x + 8, checkpoint.y + 8, 16, 16);
            
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(checkpoint.id.toString(), checkpoint.x + checkpoint.width/2, checkpoint.y + checkpoint.height/2 + 4);
        });

        // 敵キャラを描画
        this.enemies.forEach(enemy => {
            if (!enemy.active) return;
            
            this.ctx.fillStyle = '#8B4513';
            this.ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
            
            // 敵の目
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(enemy.x + 6, enemy.y + 6, 4, 4);
            this.ctx.fillRect(enemy.x + 22, enemy.y + 6, 4, 4);
            
            this.ctx.fillStyle = 'black';
            this.ctx.fillRect(enemy.x + 7, enemy.y + 7, 2, 2);
            this.ctx.fillRect(enemy.x + 23, enemy.y + 7, 2, 2);
        });

        // プレイヤーを描画
        Object.values(this.players).forEach(player => {
            // プレイヤー本体
            this.ctx.fillStyle = player.color;
            this.ctx.fillRect(player.x, player.y, player.width, player.height);
            
            // プレイヤーの目
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(player.x + 6, player.y + 6, 6, 6);
            this.ctx.fillRect(player.x + 20, player.y + 6, 6, 6);
            
            this.ctx.fillStyle = 'black';
            this.ctx.fillRect(player.x + 8, player.y + 8, 2, 2);
            this.ctx.fillRect(player.x + 22, player.y + 8, 2, 2);
            
            // プレイヤー名
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.strokeStyle = 'black';
            this.ctx.lineWidth = 2;
            this.ctx.strokeText(player.name, player.x + player.width/2, player.y - 5);
            this.ctx.fillText(player.name, player.x + player.width/2, player.y - 5);
            
            // ゴール済みプレイヤーには王冠
            if (player.finished) {
                this.ctx.fillStyle = '#FFD700';
                this.ctx.fillText('👑', player.x + player.width/2, player.y - 20);
            }
        });

        this.ctx.restore();

        // ミニマップを描画
        this.renderMinimap();
    }

    renderMinimap() {
        if (!this.gameConfig) return;
        
        const minimapCtx = this.minimapCtx;
        const scale = this.minimapCanvas.width / this.gameConfig.WORLD_WIDTH;
        
        // ミニマップクリア
        minimapCtx.fillStyle = 'rgba(0,0,0,0.5)';
        minimapCtx.fillRect(0, 0, this.minimapCanvas.width, this.minimapCanvas.height);
        
        // チェックポイント
        this.checkpoints.forEach(checkpoint => {
            minimapCtx.fillStyle = '#FFD700';
            minimapCtx.fillRect(checkpoint.x * scale, 20, 2, 10);
        });
        
        // ゴール
        const goal = this.course.find(block => block.type === 'goal');
        if (goal) {
            minimapCtx.fillStyle = '#00FF00';
            minimapCtx.fillRect(goal.x * scale, 15, 3, 20);
        }
        
        // プレイヤー
        Object.values(this.players).forEach(player => {
            minimapCtx.fillStyle = player.color;
            minimapCtx.fillRect(player.x * scale - 1, 22, 2, 6);
        });
        
        // カメラ位置
        minimapCtx.strokeStyle = 'white';
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(this.camera.x * scale, 0, (this.canvas.width * scale), this.minimapCanvas.height);
    }

    getBlockColor(type) {
        switch(type) {
            case 'ground': return '#8B4513';
            case 'platform': return '#D2691E';
            case 'spike': return '#FF0000';
            case 'goal': return '#00FF00';
            default: return '#666';
        }
    }

    updateTimer() {
        if (!this.gameStarted || !this.gameStartTime) return;
        
        const elapsed = Date.now() - this.gameStartTime;
        const remaining = Math.max(0, 300000 - elapsed); // 5分
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        document.getElementById('timer').textContent = 
            `時間: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    updateStartButton() {
        const playerCount = Object.keys(this.players).length;
        const startButton = document.getElementById('startGameButton');
        const waitingMessage = document.getElementById('waitingMessage');
        
        if (this.gameStarted) {
            startButton.style.display = 'none';
            waitingMessage.style.display = 'none';
        } else if (playerCount >= 2) {
            startButton.style.display = 'block';
            startButton.disabled = false;
            waitingMessage.style.display = 'none';
        } else {
            startButton.style.display = 'none';
            waitingMessage.style.display = 'block';
        }
    }

    updatePlayerList() {
        const playerList = document.getElementById('playerList');
        const playerCount = Object.keys(this.players).length;
        
        let html = `<div><strong>プレイヤー (${playerCount}/8):</strong></div>`;
        
        Object.values(this.players).forEach(player => {
            const isMe = player.id === this.myPlayerId ? ' (あなた)' : '';
            const finished = player.finished ? ' 🏆' : '';
            html += `<div style="color: ${player.color}">• ${player.name}${isMe}${finished}</div>`;
        });
        
        playerList.innerHTML = html;
    }

    addChatMessage(playerName, message) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        const time = new Date().toLocaleTimeString('ja-JP', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageDiv.innerHTML = `<span class="chat-player">[${time}] ${playerName}:</span> ${message}`;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // 古いメッセージを削除
        while (chatMessages.children.length > 50) {
            chatMessages.removeChild(chatMessages.firstChild);
        }
    }

    sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (message) {
            this.socket.emit('chatMessage', message);
            chatInput.value = '';
        }
        chatInput.blur();
    }

    showCheckpointMessage(checkpointId) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'checkpoint-reached';
        messageDiv.textContent = `チェックポイント ${checkpointId} 通過！`;
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            document.body.removeChild(messageDiv);
        }, 2000);
    }

    showFloatingText(x, y, text) {
        const textDiv = document.createElement('div');
        textDiv.className = 'floating-text';
        textDiv.textContent = text;
        textDiv.style.left = (x - this.camera.x) + 'px';
        textDiv.style.top = (y - this.camera.y) + 'px';
        
        document.body.appendChild(textDiv);
        
        setTimeout(() => {
            if (document.body.contains(textDiv)) {
                document.body.removeChild(textDiv);
            }
        }, 2000);
    }

    showGameResults(results, allPlayers) {
        const gameEndScreen = document.getElementById('gameEndScreen');
        const resultsDiv = document.getElementById('results');
        
        let html = '<h2>🏆 最終結果 🏆</h2>';
        
        if (results.length > 0) {
            html += '<h3>完走者:</h3>';
            results.forEach((result, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
                html += `<div class="result-item">${medal} ${result.rank}位: ${result.name} (${this.formatTime(result.time)})</div>`;
            });
        }
        
        const unfinished = allPlayers.filter(p => !p.finished);
        if (unfinished.length > 0) {
            html += '<h3>未完走:</h3>';
            unfinished.forEach(player => {
                html += `<div class="result-item">• ${player.name}</div>`;
            });
        }
        
        resultsDiv.innerHTML = html;
        gameEndScreen.style.display = 'flex';
    }

    formatTime(milliseconds) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        const ms = Math.floor((milliseconds % 1000) / 10);
        
        return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    gameLoop() {
        this.updatePlayerMovement();
        this.updateCamera();
        this.render();
        this.updateTimer();
        this.updatePlayerList();
        
        requestAnimationFrame(() => this.gameLoop());
    }
}

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    new Game();
});