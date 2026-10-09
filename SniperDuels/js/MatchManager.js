// MatchManager.js - State Machine, Matchmaking Duel Pads, Round Engine, Single-Duel Finish
import * as THREE from '../vendor/three/three.module.js';

export class MatchManager {
  constructor(controls, bot, map, audio, particles, caseSystem) {
    this.controls = controls;
    this.bot = bot;
    this.map = map;
    this.audio = audio;
    this.particles = particles;
    this.caseSystem = caseSystem;

    // Match Rules: Single Duel Win Ends The Game!
    this.maxScore = 1;
    this.scorePlayer = 0;
    this.scoreBot = 0;
    this.roundNumber = 1;

    // States: 'LOBBY', 'WARMUP', 'ROUND_ACTIVE', 'MATCH_VICTORY'
    this.state = 'LOBBY';
    this.stateTimer = 0;
    this.roundTimeRemaining = 60;

    // Player Combat State
    this.playerHealth = 100;
    this.playerMaxHealth = 100;
    this.isPlayerAlive = true;

    // Pad detection & Multiplayer Queue
    this.activePad = null;
    this.padCountdown = 3.0;
    this.queueTimer = 0;
    this.mpClient = null;
    this.isTwoPlayer = false;
    this.opponentId = null;
    this.myTeam = 'BLUE';

    this.initUI();
  }

  setMultiplayerClient(mpClient) {
    this.mpClient = mpClient;
  }

  initUI() {
    this.updateHUDScore();
    this.updateHUDHealth();
    this.updateStateBanner('LOBBY PRACTICE - STEP ON A DUEL PAD TO PLAY', false);
  }

  updateHUDScore() {
    const elPlayer = document.getElementById('score-blue');
    const elBot = document.getElementById('score-red');
    if (elPlayer) elPlayer.textContent = this.scorePlayer;
    if (elBot) elBot.textContent = this.scoreBot;

    const pipsBlue = document.getElementById('pips-blue');
    const pipsRed = document.getElementById('pips-red');
    if (pipsBlue && pipsRed) {
      pipsBlue.innerHTML = '';
      pipsRed.innerHTML = '';
      for (let i = 0; i < this.maxScore; i++) {
        const bPip = document.createElement('div');
        bPip.className = `score-pip ${i < this.scorePlayer ? 'active' : ''}`;
        pipsBlue.appendChild(bPip);

        const rPip = document.createElement('div');
        rPip.className = `score-pip ${i < this.scoreBot ? 'active red' : ''}`;
        pipsRed.appendChild(rPip);
      }
    }
  }

  updateHUDHealth() {
    const bar = document.getElementById('health-bar-fill');
    const text = document.getElementById('health-text');
    if (bar) bar.style.width = `${Math.max(0, this.playerHealth)}%`;
    if (text) text.textContent = `${Math.max(0, this.playerHealth)} HP`;
  }

  updateStateBanner(text, visible = true, color = '#ffffff') {
    const banner = document.getElementById('match-status-banner');
    if (banner) {
      banner.style.display = visible ? 'block' : 'none';
      banner.textContent = text;
      banner.style.color = color;
    }
  }

  // Check if player stepped on any Duel Pad in lobby
  checkDuelPads(playerPosition, delta) {
    if (this.state !== 'LOBBY') return;

    let onAnyPad = false;
    let currentSteppedPad = null;

    for (const pad of this.map.duelPads) {
      const padPos = pad.position;
      const dist = Math.hypot(playerPosition.x - padPos.x, playerPosition.z - padPos.z);

      if (dist < pad.userData.radius) {
        onAnyPad = true;
        currentSteppedPad = pad;
        break;
      }
    }

    if (onAnyPad && currentSteppedPad) {
      // 1. MIDDLE MAT: 1v1 Multiplayer Queue
      if (currentSteppedPad.userData.mode === 'multiplayer_queue') {
        if (this.activePad !== currentSteppedPad) {
          this.activePad = currentSteppedPad;
          this.queueTimer = 0;
          if (this.mpClient) this.mpClient.stepOnQueuePad();
          this.updateStateBanner('WAITING FOR OPPONENT (1/2 ON PAD) • STEP ON SIDE PADS FOR SOLO BOT', true, '#00ffcc');
        } else {
          this.queueTimer += delta;
          // If waiting for more than 14 seconds with no other player, offer friendly prompt
          if (this.queueTimer > 14.0) {
            this.updateStateBanner('WAITING FOR 2ND PLAYER (1/2) • STEP ON LEFT/RIGHT PADS TO PLAY SOLO BOT', true, '#f1c40f');
          }
        }
      } else {
        // 2. SIDE MATS: Solo Bot Duels (Casual or AWP God)
        if (this.activePad !== currentSteppedPad) {
          if (this.activePad && this.activePad.userData.mode === 'multiplayer_queue' && this.mpClient) {
            this.mpClient.stepOffQueuePad();
          }
          this.activePad = currentSteppedPad;
          this.padCountdown = 3.0;
          this.bot.setDifficulty(currentSteppedPad.userData.mode);
        }

        this.padCountdown -= delta;
        const sec = Math.max(1, Math.ceil(this.padCountdown));
        this.updateStateBanner(`SOLO DUEL STARTING IN ${sec}... (${currentSteppedPad.userData.label})`, true, '#00ffcc');

        if (this.padCountdown <= 0) {
          this.startSoloMatch();
        }
      }
    } else {
      if (this.activePad) {
        if (this.activePad.userData.mode === 'multiplayer_queue' && this.mpClient) {
          this.mpClient.stepOffQueuePad();
        }
        this.activePad = null;
        this.updateStateBanner('LOBBY PRACTICE - STEP ON A DUEL PAD TO PLAY', true, '#ffffff');
      }
    }
  }

  // Starts Solo Bot Match
  startSoloMatch() {
    this.isTwoPlayer = false;
    this.scorePlayer = 0;
    this.scoreBot = 0;
    this.roundNumber = 1;
    this.updateHUDScore();
    this.setupRound();
  }

  // Starts 2-Player Match triggered by WebSocket Server!
  startTwoPlayerMatch(myTeam, opponentId, chosenMap = 'blockout') {
    this.isTwoPlayer = true;
    this.opponentId = opponentId;
    this.myTeam = myTeam;
    this.scorePlayer = 0;
    this.scoreBot = 0;
    this.roundNumber = 1;
    this.updateHUDScore();

    // Disable AI Bot in 2-player match
    this.bot.mesh.visible = false;
    this.bot.isAlive = false;

    this.state = 'WARMUP';
    this.stateTimer = 3.0;
    this.roundTimeRemaining = 60;
    this.playerHealth = 100;
    this.isPlayerAlive = true;
    this.updateHUDHealth();

    // Teleport local player to team perch
    if (myTeam === 'BLUE') {
      this.controls.teleport(this.map.spawnBlue, new THREE.Vector3(0, 1.8, 0));
    } else {
      this.controls.teleport(this.map.spawnOrange, new THREE.Vector3(0, 1.8, 0));
    }

    // Raise forcefield barrier
    this.map.blueBarrier.visible = true;
    this.map.orangeBarrier.visible = true;

    this.audio.playCountdownTick();
    this.updateStateBanner(`1v1 DUEL [${chosenMap.toUpperCase()}] - WARMUP (3)`, true, '#00d2ff');
  }

  setupRound() {
    this.state = 'WARMUP';
    this.stateTimer = 3.0;
    this.roundTimeRemaining = 60;
    this.playerHealth = 100;
    this.isPlayerAlive = true;
    this.updateHUDHealth();

    // Teleport Player to Blue Spawn, facing North (Orange side)
    this.controls.teleport(this.map.spawnBlue, new THREE.Vector3(0, 1.8, 0));

    // Teleport & reset Bot to Orange Spawn
    this.bot.reset(this.map.spawnOrange);

    // Raise spawn barrier forcefields
    this.map.blueBarrier.visible = true;
    this.map.orangeBarrier.visible = true;

    this.audio.playCountdownTick();
    this.updateStateBanner(`ROUND ${this.roundNumber} - WARMUP (3)`, true, '#00d2ff');
  }

  startRoundActive() {
    this.state = 'ROUND_ACTIVE';
    this.map.blueBarrier.visible = false;
    this.map.orangeBarrier.visible = false;
    this.audio.stopLobbyMusic();
    this.audio.playRoundStart();
    this.updateStateBanner('ROUND ACTIVE - ELIMINATE THE ENEMY!', true, '#00ffcc');

    setTimeout(() => {
      if (this.state === 'ROUND_ACTIVE') {
        this.updateStateBanner('', false);
      }
    }, 1500);
  }

  // When player inflicts damage on Bot
  onBotDamaged(damage, isHeadshot) {
    if (this.state !== 'ROUND_ACTIVE') return;

    this.audio.playHitmarker(isHeadshot);
    this.showHitmarker(isHeadshot);
    this.showDamageNumber(damage, isHeadshot);

    const isFatal = this.bot.takeDamage(damage, isHeadshot);
    if (isFatal) {
      this.onBotKilled(isHeadshot);
    }
  }

  // When Bot dies: Player wins, game ends immediately!
  onBotKilled(isHeadshot) {
    this.addKillFeedEntry('YOU', 'BOT_ALPHA', isHeadshot);
    this.scorePlayer = 1;
    this.updateHUDScore();
    this.audio.playRoundWon();

    // Immediate game end!
    this.triggerMatchVictory('PLAYER');
  }

  // When Player takes damage (from Bot or Remote Player)
  onPlayerDamaged(damage, isHeadshot) {
    if (this.state !== 'ROUND_ACTIVE' || !this.isPlayerAlive) return;

    this.playerHealth -= damage;
    this.updateHUDHealth();
    this.showDamageVignette();

    if (this.playerHealth <= 0) {
      this.isPlayerAlive = false;
      this.playerHealth = 0;
      this.updateHUDHealth();
      this.onPlayerKilled(isHeadshot);
    }
  }

  // When Player dies: Opponent wins, game ends immediately!
  onPlayerKilled(isHeadshot) {
    const killer = this.isTwoPlayer ? 'OPPONENT' : 'BOT_ALPHA';
    this.addKillFeedEntry(killer, 'YOU', isHeadshot);
    this.scoreBot = 1;
    this.updateHUDScore();
    this.audio.playRoundLost();

    // Immediate game end!
    this.triggerMatchVictory('OPPONENT');
  }

  // Final Victory / Defeat Screen -> Ends Game & Returns to Lobby
  triggerMatchVictory(winner) {
    this.state = 'MATCH_VICTORY';
    this.stateTimer = 3.5;

    if (winner === 'PLAYER' || winner === 'YOU') {
      this.updateStateBanner('VICTORY! YOU WON THE DUEL (+300 COINS)', true, '#f1c40f');
      this.caseSystem.addCoins(300);
      this.audio.playUnlockFanfare('legendary');
      this.particles.spawnVictoryConfetti(this.controls.getPosition());
    } else if (winner === 'OPPONENT_QUIT') {
      this.updateStateBanner('OPPONENT DISCONNECTED - YOU WIN (+150 COINS)', true, '#f1c40f');
      this.caseSystem.addCoins(150);
      this.audio.playUnlockFanfare('rare');
    } else {
      this.updateStateBanner('DEFEAT! OPPONENT WON THE DUEL', true, '#ff4444');
      this.audio.playRoundLost();
    }
  }

  returnToLobby() {
    this.state = 'LOBBY';
    this.isTwoPlayer = false;
    this.opponentId = null;
    this.controls.teleport(this.map.lobbySpawn, new THREE.Vector3(0, 1.8, -120));
    this.updateStateBanner('LOBBY PRACTICE - STEP ON A DUEL PAD TO PLAY', true, '#ffffff');
    this.scorePlayer = 0;
    this.scoreBot = 0;
    this.playerHealth = 100;
    this.isPlayerAlive = true;
    this.updateHUDHealth();
    this.updateHUDScore();
    this.audio.startLobbyMusic();

    // Reset bot for future solo practice
    this.bot.reset(this.map.spawnOrange);
  }

  // UI Effects
  showHitmarker(isHeadshot) {
    const hm = document.getElementById('hitmarker');
    if (!hm) return;
    hm.className = `hitmarker-active ${isHeadshot ? 'headshot' : ''}`;
    setTimeout(() => {
      hm.className = '';
    }, 180);
  }

  showDamageNumber(val, isHeadshot) {
    const el = document.createElement('div');
    el.className = `floating-dmg ${isHeadshot ? 'crit' : ''}`;
    el.textContent = isHeadshot ? `${val} CRIT!` : `${val}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  showDamageVignette() {
    const vig = document.getElementById('damage-vignette');
    if (!vig) return;
    vig.style.opacity = '1.0';
    setTimeout(() => {
      vig.style.opacity = '0.0';
    }, 300);
  }

  addKillFeedEntry(killer, victim, isHeadshot) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-feed-entry';
    entry.innerHTML = `
      <span class="killer">${killer}</span>
      <span class="weapon-icon">${isHeadshot ? '🎯 [AWP HEADSHOT]' : '💥 [AWP]'}</span>
      <span class="victim">${victim}</span>
    `;
    feed.appendChild(entry);
    setTimeout(() => {
      entry.style.opacity = '0';
      setTimeout(() => entry.remove(), 500);
    }, 4000);
  }

  update(delta) {
    const playerPos = this.controls.getPosition();

    // Check Duel pads in Lobby
    if (this.state === 'LOBBY') {
      this.checkDuelPads(playerPos, delta);
    }

    // Warmup countdown
    if (this.state === 'WARMUP') {
      this.stateTimer -= delta;
      const count = Math.max(1, Math.ceil(this.stateTimer));
      const duelLabel = this.isTwoPlayer ? '1v1 PLAYER DUEL' : 'SOLO BOT DUEL';
      this.updateStateBanner(`${duelLabel} - STARTING IN ${count}...`, true, '#00d2ff');
      if (this.stateTimer <= 0) {
        this.startRoundActive();
      }
    }

    // Active round timer
    if (this.state === 'ROUND_ACTIVE') {
      this.roundTimeRemaining -= delta;
      const timerEl = document.getElementById('round-timer');
      if (timerEl) {
        timerEl.textContent = `0:${Math.max(0, Math.ceil(this.roundTimeRemaining)).toString().padStart(2, '0')}`;
      }

      // Round timeout (Draw) -> Ends game immediately
      if (this.roundTimeRemaining <= 0) {
        this.state = 'MATCH_VICTORY';
        this.stateTimer = 3.0;
        this.updateStateBanner('TIME EXPIRED - DRAW! RETURNING TO LOBBY...', true, '#ffffff');
        return;
      }

      // Update AI bot only in Solo Bot mode
      if (!this.isTwoPlayer && this.bot.isAlive) {
        this.bot.update(delta, playerPos, this.state, (dmg, isHead) => {
          this.onPlayerDamaged(dmg, isHead);
        });
      }
    }

    // Match Victory delay -> return to lobby
    if (this.state === 'MATCH_VICTORY') {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) {
        this.returnToLobby();
      }
    }
  }
}
