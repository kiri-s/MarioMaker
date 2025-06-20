class Game {
    constructor() {
        this.socket = io();
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.minimapCanvas = document.getElementById('minimap');
        this.minimapCtx = this.minimapCanvas.getContext('2d');

        this.players = {};
        this.myPlayerId = null;
        this.course = [];
        this.enemies = [];
        this.checkpoints = [];
        this.gameConfig = null;
        this.gameStarted = false;
        this.camera = { x: 0, y: 0 };
        this.keys = {};
        this.inputLocked = false;
        this.gameStartTime = null;

        this.GRAVITY = 0.6;
        this.JUMP_FORCE = -15;
        this.MOVE_SPEED = 4;
        this.FRICTION = 0.8;

        this.particles = [];

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

        this.socket.on('playerListUpdate', (counts) => {
            document.getElementById('playerCounts').textContent =
                `接続人数: ${counts.total}人 / 参加待機中: ${counts.players}人 / 観戦: ${counts.spectators}人`;
        });

        this.socket.on('dustEffect', (data) => {
            this.spawnDust(data.x, data.y);
        });
    }

    setupUI() {
        document.getElementById('joinButton').addEventListener('click', () => {
            const playerName = document.getElementById('playerNameInput').value.trim().substring(0, 15);
            if (playerName) {
                this.socket.emit('joinGame', playerName);
                document.getElementById('joinButton').style.display = 'none';
                document.getElementById('playerNameInput').style.display = 'none';
            } else {
                alert('プレイヤー名を入力してください');
            }
        });
        
        document.getElementById('cancelJoinButton').addEventListener('click', () => {
            document.getElementById('playerNameInput').value = '';
            document.getElementById('joinButton').style.display = 'inline-block';
            document.getElementById('playerNameInput').style.display = 'inline-block';
            document.getElementById('startGameButton').style.display = 'none';
            document.getElementById('waitingMessage').style.display = 'none';
        });

        document.getElementById('newGameButton').addEventListener('click', () => {
            document.getElementById('gameEndScreen').style.display = 'none';
            document.getElementById('startScreen').style.display = 'flex';
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
            document.getElementById('startScreen').style.display = 'none';
            this.inputLocked = true;

            let countdown = 3;
            const countdownDiv = document.createElement('div');
            countdownDiv.id = 'countdownOverlay';
            countdownDiv.style.position = 'absolute';
            countdownDiv.style.top = '50%';
            countdownDiv.style.left = '50%';
            countdownDiv.style.transform = 'translate(-50%, -50%)';
            countdownDiv.style.fontSize = '64px';
            countdownDiv.style.color = 'white';
            countdownDiv.style.fontWeight = 'bold';
            countdownDiv.style.zIndex = 2000;
            countdownDiv.style.textShadow = '2px 2px 8px black';
            document.body.appendChild(countdownDiv);

            const interval = setInterval(() => {
                if (countdown > 0) {
                    countdownDiv.textContent = countdown;
                    countdown--;
                } else {
                    countdownDiv.textContent = 'GO!!';
                    clearInterval(interval);
                    setTimeout(() => {
                        if (document.body.contains(countdownDiv)) {
                            document.body.removeChild(countdownDiv);
                        }
                        this.inputLocked = false;
                    }, 1000);
                }
            }, 1000);
        });

        // document.getElementById('spectateButton').addEventListener('click', () => {
        //     this.socket.emit('spectate');
        //     document.getElementById('startScreen').style.display = 'none';
        // });
    }

    updatePlayerMovement() {
        if (!this.gameStarted || !this.myPlayerId || !this.players[this.myPlayerId] || !this.gameConfig) return;

        const player = this.players[this.myPlayerId];
        if (player.finished) return;

        player.isJumping = player.isJumping || false;

        const ACCELERATION = 0.5;
        const MAX_SPEED = 4;
        const airControl = player.onGround ? 1 : 0.5;

        if (this.keys['a'] || this.keys['arrowleft']) {
            player.velocityX -= ACCELERATION * airControl;
        }
        if (this.keys['d'] || this.keys['arrowright']) {
            player.velocityX += ACCELERATION * airControl;
        }

        if (!(this.keys['a'] || this.keys['arrowleft'] || this.keys['d'] || this.keys['arrowright'])) {
            player.velocityX *= this.FRICTION;
        }

        player.velocityX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, player.velocityX));

        const CHARGE_DELAY = 500; // チャージ開始の遅延(ms)
        const MAX_CHARGE = 20;
        const BASE_JUMP_FORCE = this.JUMP_FORCE; // 基本ジャンプ力

        if ((this.keys[' '] || this.keys['w'] || this.keys['arrowup'])) {
            if (player.onGround && !player.isJumping) {
                player.velocityY = this.JUMP_FORCE;
                player.isJumping = true;
                player.onGround = false;
            }
        } else {
            if (player.isJumping && player.velocityY < -6) {
                // ジャンプ途中でキーを離した場合、上昇を制限
                player.velocityY = -6;
            }
        }

        if (!player.onGround) player.velocityY += this.GRAVITY;

        player.x += player.velocityX;
        player.y += player.velocityY;

        player.onGround = false;
        this.course.forEach(block => {
            if (block.type === 'ground' || block.type === 'platform') {
                if (this.checkBlockCollision(player, block)) {
                    if (player.velocityY > 0 && player.y < block.y) {
                        player.y = block.y - player.height;
                        player.velocityY = 0;
                        player.onGround = true;
                        player.isJumping = false;  // 着地したらジャンプ状態リセット
                    } else if (player.velocityY < 0 && player.y > block.y) {
                        player.y = block.y + block.height;
                        player.velocityY = 0;
                    } else if (player.velocityX > 0 && player.x < block.x) {
                        player.x = block.x - player.width;
                        player.velocityX = 0;
                    } else if (player.velocityX < 0 && player.x > block.x) {
                        player.x = block.x + block.width;
                        player.velocityX = 0;
                    }
                }
            }
        });

        player.x = Math.max(0, Math.min(player.x, this.gameConfig.WORLD_WIDTH - player.width));
        if (player.y > this.gameConfig.WORLD_HEIGHT) {
            this.socket.emit('playerMove', player);
            return;
        }

        this.socket.emit('playerMove', player);
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
        const targetX = player.x - this.canvas.width / 2;
        const targetY = player.y - this.canvas.height / 2;

        // イージング（0.05 は追従の速さ、調整可能）
        this.camera.x += (targetX - this.camera.x) * 0.05;
        this.camera.y += (targetY - this.camera.y) * 0.05;

        // カメラの境界制限
        this.camera.x = Math.max(0, Math.min(this.camera.x, this.gameConfig.WORLD_WIDTH - this.canvas.width));
        this.camera.y = Math.max(0, Math.min(this.camera.y, this.gameConfig.WORLD_HEIGHT - this.canvas.height));
    }

    spawnDust(x, y) {
        for (let i = 0; i < 5; i++) {
            this.particles.push({
                x: x + Math.random() * 10 - 5,
                y: y,
                vx: (Math.random() - 0.5) * 2,
                vy: -Math.random() * 2,
                life: 30
            });
        }
    }

    spawnChargeEffect(x, y) {
        for (let i = 0; i < 3; i++) {
            this.particles.push({
                x: x + Math.random() * 8 - 4,
                y: y + Math.random() * 8 - 4,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                life: 15,
                color: 'rgba(255,215,0,0.8)' // ゴールド光
            });
        }
    }

    adjustColorBrightness(hex, amt) {
        if (hex[0] === '#') {
            hex = hex.slice(1);
        }

        let num = parseInt(hex, 16);

        let r = (num >> 16) + amt;
        let g = ((num >> 8) & 0x00FF) + amt;
        let b = (num & 0x0000FF) + amt;

        r = Math.max(Math.min(255, r), 0);
        g = Math.max(Math.min(255, g), 0);
        b = Math.max(Math.min(255, b), 0);

        return (
            '#' +
            r.toString(16).padStart(2, '0') +
            g.toString(16).padStart(2, '0') +
            b.toString(16).padStart(2, '0')
        );
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
        this.checkpoints.forEach(cp => {
            this.ctx.fillStyle='#FFD700'; // ポール
            this.ctx.fillRect(cp.x, cp.y-cp.height,4,cp.height);
            this.ctx.beginPath();          // 旗
            this.ctx.moveTo(cp.x+4, cp.y-cp.height+4);
            this.ctx.lineTo(cp.x+20, cp.y-cp.height+12);
            this.ctx.lineTo(cp.x+4, cp.y-cp.height+20);
            this.ctx.closePath();
            this.ctx.fillStyle='#FF6B6B';
            this.ctx.fill();
        });

        // 敵キャラを描画
        this.enemies.forEach(enemy => {
            if (!enemy.active) return;

            if (enemy.type === 'bird') {
                this.ctx.fillStyle = '#1E90FF'; // 鳥の色
                this.ctx.beginPath();
                this.ctx.ellipse(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, 16, 12, 0, 0, 2 * Math.PI);
                this.ctx.fill();

                // 翼（シンプルな羽ばたき）
                this.ctx.strokeStyle = 'white';
                this.ctx.beginPath();
                this.ctx.moveTo(enemy.x + 8, enemy.y + 8);
                this.ctx.lineTo(enemy.x + 16, enemy.y);
                this.ctx.stroke();
                return;
            }
            
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
            const centerX = player.x + player.width / 2;
            const centerY = player.y + player.height / 2;
            const radius = player.width / 2;

            // メタリックグラデーション（プレイヤー色ベース）
            const lightColor = this.adjustColorBrightness(player.color, 60);
            const darkColor = this.adjustColorBrightness(player.color, -60);

            const gradient = this.ctx.createRadialGradient(
                centerX, centerY, radius * 0.2,
                centerX, centerY, radius
            );
            gradient.addColorStop(0, lightColor);
            gradient.addColorStop(0.5, player.color);
            gradient.addColorStop(1, darkColor);

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            this.ctx.fill();

            // 目
            this.ctx.fillStyle = 'white';
            this.ctx.beginPath();
            this.ctx.arc(centerX - 5, centerY - 3, 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.arc(centerX + 5, centerY - 3, 2, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.fillStyle = 'black';
            this.ctx.beginPath();
            this.ctx.arc(centerX - 5, centerY - 3, 1, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.arc(centerX + 5, centerY - 3, 1, 0, Math.PI * 2);
            this.ctx.fill();

            // プレイヤー名
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.strokeStyle = 'black';
            this.ctx.lineWidth = 2;
            this.ctx.strokeText(player.name, centerX, player.y - 5);
            this.ctx.fillText(player.name, centerX, player.y - 5);
            
            // ゴール済みプレイヤーには王冠
            if (player.finished) {
                this.ctx.fillStyle = '#FFD700';
                this.ctx.fillText('👑', player.x + player.width/2, player.y - 20);
            }
        });

        // 他プレイヤーも土煙表示
        Object.values(this.players).forEach(player => {
            if (player.onGround && Math.abs(player.velocityX) > 0.5) {
                this.spawnDust(player.x + player.width / 2, player.y + player.height);
            }
        });

        this.particles.forEach(p => {
            this.ctx.fillStyle = p.color || 'rgba(150,150,150,0.7)';
            this.ctx.fillRect(p.x, p.y, 3, 3);
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1;
            p.life--;
        });
        this.particles = this.particles.filter(p => p.life > 0);

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
        const remaining = Math.max(0, 60000 - elapsed); // 5分
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