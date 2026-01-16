// ============================================================================
// GAME MANAGER - Gestor de Partidas Activas (4 jugadores humanos)
// ============================================================================
import { 
  createGameState, 
  applyMove, 
  applyPass, 
  startNewRound,
  getValidMoves,
  canPlay,
  calculateRoundPoints
} from './gameEngine.js';
import { GlickoService } from './glicko.js';
import { StatsService } from './stats.js';

const TURN_TIME = parseInt(process.env.TURN_TIMEOUT_SECONDS) || 30;
const TARGET_SCORE = parseInt(process.env.DEFAULT_TARGET_SCORE) || 100;

/**
 * Clase para gestionar todas las partidas activas
 */
export class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map();        // gameId -> Game
    this.playerGames = new Map();  // socketId -> gameId
    this.onlinePlayers = new Map(); // socketId -> PlayerInfo
  }
  
  /**
   * Registrar jugador conectado
   */
  playerConnected(socket) {
    this.onlinePlayers.set(socket.id, {
      socketId: socket.id,
      user: socket.user,
      connectedAt: Date.now()
    });
    
    // Broadcast cantidad de jugadores online
    this.broadcastOnlineCount();
  }
  
  /**
   * Manejar desconexión de jugador
   */
  playerDisconnected(socket) {
    this.onlinePlayers.delete(socket.id);
    
    // Verificar si estaba en una partida
    const gameId = this.playerGames.get(socket.id);
    if (gameId) {
      this.handlePlayerDisconnect(gameId, socket);
    }
    
    this.broadcastOnlineCount();
  }
  
  /**
   * Broadcast cantidad de jugadores online
   */
  broadcastOnlineCount() {
    this.io.emit('stats:online', {
      players: this.onlinePlayers.size,
      games: this.games.size
    });
  }
  
  /**
   * Crear nueva partida con 4 jugadores humanos
   */
  createGame(gameId, options) {
    const { players, mode = 'ranked', targetScore = TARGET_SCORE } = options;
    
    // Crear estado inicial
    const gameState = createGameState();
    
    const game = {
      id: gameId,
      mode,
      targetScore,
      players: players.map((p, i) => ({
        ...p,
        position: p.position,
        team: p.team,
        hand: gameState.hands[p.position],
        connected: true
      })),
      state: gameState,
      turnTimer: null,
      turnStartTime: null,
      createdAt: Date.now(),
      status: 'playing'
    };
    
    this.games.set(gameId, game);
    
    // Registrar jugadores
    players.forEach(p => {
      if (p.socketId) {
        this.playerGames.set(p.socketId, gameId);
      }
    });
    
    console.log(`[Game] 🎮 Partida creada: ${gameId} (4 jugadores)`);
    
    // Iniciar el juego
    this.startGame(gameId);
    
    return game;
  }
  
  /**
   * Iniciar partida
   */
  startGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Enviar estado inicial a cada jugador (solo sus fichas)
    game.players.forEach(player => {
      if (player.socketId) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          socket.emit('game:start', {
            gameId,
            position: player.position,
            team: player.team,
            hand: player.hand,
            players: game.players.map(p => ({
              position: p.position,
              team: p.team,
              name: p.user?.name || 'Jugador',
              avatar: p.user?.avatar,
              rating: p.user?.rating,
              handCount: 7
            })),
            currentPlayer: game.state.currentPlayer,
            startingPlayer: game.state.startingPlayer,
            targetScore: game.targetScore
          });
        }
      }
    });
    
    // Iniciar timer del turno
    this.startTurnTimer(gameId);
  }
  
  /**
   * Iniciar timer del turno
   */
  startTurnTimer(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Limpiar timer anterior
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
    }
    
    game.turnStartTime = Date.now();
    
    // Notificar tiempo restante
    this.io.to(gameId).emit('game:turn', {
      currentPlayer: game.state.currentPlayer,
      timeLeft: TURN_TIME
    });
    
    // Timer de timeout
    game.turnTimer = setTimeout(() => {
      this.handleTurnTimeout(gameId);
    }, TURN_TIME * 1000);
  }
  
  /**
   * Manejar timeout del turno
   */
  handleTurnTimeout(gameId) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'playing') return;
    
    const currentPlayer = game.players[game.state.currentPlayer];
    
    // Si es humano, forzar pase o jugada automática
    if (currentPlayer.type === 'human') {
      const validMoves = getValidMoves(
        game.state.hands[game.state.currentPlayer],
        game.state.leftEnd,
        game.state.rightEnd
      );
      
      if (validMoves.length > 0) {
        // Jugar la primera ficha válida automáticamente
        this.playTile(gameId, currentPlayer.socketId, validMoves[0].tile, validMoves[0].side);
      } else {
        // Pasar
        this.passTurn(gameId, currentPlayer.socketId);
      }
    }
  }
  
  /**
   * Jugar ficha (desde cliente)
   */
  playTile(gameId, socketId, tile, side) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'playing') {
      return { success: false, error: 'Partida no válida' };
    }
    
    // Verificar que es el turno del jugador
    const player = game.players.find(p => p.socketId === socketId);
    if (!player || player.position !== game.state.currentPlayer) {
      return { success: false, error: 'No es tu turno' };
    }
    
    // Verificar movimiento válido
    const validMoves = getValidMoves(
      game.state.hands[player.position],
      game.state.leftEnd,
      game.state.rightEnd
    );
    
    const isValid = validMoves.some(m => m.tile.id === tile.id && m.side === side);
    if (!isValid) {
      return { success: false, error: 'Movimiento inválido' };
    }
    
    return this.playTileInternal(gameId, player.position, tile, side);
  }
  
  /**
   * Jugar ficha (interno)
   */
  playTileInternal(gameId, playerIndex, tile, side) {
    const game = this.games.get(gameId);
    if (!game) return { success: false };
    
    // Aplicar movimiento
    game.state = applyMove(game.state, playerIndex, tile, side);
    
    // Actualizar mano del jugador
    game.players[playerIndex].hand = game.state.hands[playerIndex];
    
    // Limpiar timer
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
    }
    
    // Broadcast movimiento a todos
    this.io.to(gameId).emit('game:move', {
      player: playerIndex,
      tile,
      side,
      board: game.state.board,
      leftEnd: game.state.leftEnd,
      rightEnd: game.state.rightEnd,
      handCounts: game.state.hands.map(h => h.length)
    });
    
    // Verificar fin de ronda
    if (game.state.phase === 'roundEnd') {
      this.handleRoundEnd(gameId);
    } else {
      // Continuar juego - iniciar timer para siguiente jugador
      this.startTurnTimer(gameId);
    }
    
    return { success: true };
  }
  
  /**
   * Pasar turno (desde cliente)
   */
  passTurn(gameId, socketId) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'playing') {
      return { success: false, error: 'Partida no válida' };
    }
    
    const player = game.players.find(p => p.socketId === socketId);
    if (!player || player.position !== game.state.currentPlayer) {
      return { success: false, error: 'No es tu turno' };
    }
    
    // Verificar que no puede jugar
    if (canPlay(game.state.hands[player.position], game.state.leftEnd, game.state.rightEnd)) {
      return { success: false, error: 'Tienes jugadas disponibles' };
    }
    
    return this.passTurnInternal(gameId, player.position);
  }
  
  /**
   * Pasar turno (interno)
   */
  passTurnInternal(gameId, playerIndex) {
    const game = this.games.get(gameId);
    if (!game) return { success: false };
    
    // Aplicar pase
    game.state = applyPass(game.state, playerIndex);
    
    // Limpiar timer
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
    }
    
    // Broadcast pase
    this.io.to(gameId).emit('game:pass', {
      player: playerIndex,
      passCount: game.state.passCount
    });
    
    // Verificar tranca
    if (game.state.phase === 'roundEnd') {
      this.handleRoundEnd(gameId);
    } else {
      // Iniciar timer para siguiente jugador
      this.startTurnTimer(gameId);
    }
    
    return { success: true };
  }
  
  /**
   * Manejar fin de ronda
   */
  handleRoundEnd(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    const { roundResult } = game.state;
    
    // Calcular puntos de la ronda
    const points = calculateRoundPoints(
      game.state.hands,
      roundResult.winner,
      roundResult.type === 'domino',
      roundResult.isCapicua
    );
    
    // Actualizar marcador
    if (roundResult.winner === 0) {
      game.state.scores.team0 += points;
    } else if (roundResult.winner === 1) {
      game.state.scores.team1 += points;
    }
    
    // Determinar si la partida terminó
    const gameOver = 
      game.state.scores.team0 >= game.targetScore ||
      game.state.scores.team1 >= game.targetScore;
    
    // Broadcast resultado de ronda
    this.io.to(gameId).emit('game:roundEnd', {
      result: roundResult,
      points,
      scores: game.state.scores,
      hands: game.state.hands, // Revelar todas las manos
      gameOver
    });
    
    if (gameOver) {
      this.handleGameEnd(gameId);
    } else {
      // Esperar un poco y empezar nueva ronda
      setTimeout(() => {
        this.startNewRound(gameId);
      }, 5000);
    }
  }
  
  /**
   * Iniciar nueva ronda
   */
  startNewRound(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Crear nuevo estado de ronda
    game.state = startNewRound(game.state);
    
    // Actualizar manos de jugadores
    game.players.forEach((player, i) => {
      player.hand = game.state.hands[player.position];
    });
    
    // Enviar nuevas manos a cada jugador
    game.players.forEach(player => {
      if (player.socketId) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          socket.emit('game:newRound', {
            roundNumber: game.state.roundNumber,
            hand: player.hand,
            currentPlayer: game.state.currentPlayer,
            startingPlayer: game.state.startingPlayer
          });
        }
      }
    });
    
    // Iniciar turno
    this.startTurnTimer(gameId);
  }
  
  /**
   * Manejar fin de partida (4 jugadores humanos)
   */
  async handleGameEnd(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    game.status = 'finished';
    
    // Determinar ganador
    const winnerTeam = game.state.scores.team0 >= game.targetScore ? 0 : 1;
    
    // Todos los jugadores son humanos
    const team0Players = game.players.filter(p => p.team === 0);
    const team1Players = game.players.filter(p => p.team === 1);
    
    // Calcular rating promedio de cada equipo
    const team0AvgRating = team0Players.reduce((sum, p) => sum + (p.user.rating || 1500), 0) / 2;
    const team0AvgRD = team0Players.reduce((sum, p) => sum + (p.user.rd || 350), 0) / 2;
    const team1AvgRating = team1Players.reduce((sum, p) => sum + (p.user.rating || 1500), 0) / 2;
    const team1AvgRD = team1Players.reduce((sum, p) => sum + (p.user.rd || 350), 0) / 2;
    
    // Calcular cambios de rating usando Glicko-2 (equipo vs equipo)
    let ratingChanges = [];
    
    if (game.mode === 'ranked') {
      const teamResult = GlickoService.calculateMatch(
        { rating: team0AvgRating, rd: team0AvgRD, volatility: 0.06 },
        { rating: team1AvgRating, rd: team1AvgRD, volatility: 0.06 },
        winnerTeam === 0 ? 1 : 0
      );
      
      // Aplicar cambios a cada jugador
      for (const player of game.players) {
        const won = player.team === winnerTeam;
        const teamChanges = player.team === 0 ? teamResult.player1 : teamResult.player2;
        
        // Ajustar el cambio individual basado en el rating personal vs promedio del equipo
        const avgTeamRating = player.team === 0 ? team0AvgRating : team1AvgRating;
        const ratingDiffFactor = 1 + ((avgTeamRating - player.user.rating) / 500) * 0.2; // ±20% ajuste
        const adjustedChange = Math.round(teamChanges.ratingChange * ratingDiffFactor);
        
        const newRating = player.user.rating + adjustedChange;
        
        // Actualizar en Firebase
        await StatsService.updateGameResult(player.user.uid, {
          won,
          newRating,
          newRd: teamChanges.rd,
          newVolatility: teamChanges.volatility,
          ratingChange: adjustedChange,
          points: won 
            ? (player.team === 0 ? game.state.scores.team0 : game.state.scores.team1)
            : 0,
          isDomino: game.state.roundResult?.type === 'domino',
          isTranca: game.state.roundResult?.type === 'tranca'
        });
        
        ratingChanges.push({
          odId: player.user.uid,
          name: player.user.name,
          team: player.team,
          oldRating: player.user.rating,
          newRating,
          change: adjustedChange
        });
      }
    }
    
    // Broadcast resultado final
    this.io.to(gameId).emit('game:end', {
      winner: winnerTeam,
      scores: game.state.scores,
      rounds: game.state.roundNumber,
      duration: Date.now() - game.createdAt,
      ratingChanges
    });
    
    // Limpiar juego después de un tiempo
    setTimeout(() => {
      this.cleanupGame(gameId);
    }, 60000);
  }
  
  /**
   * Manejar desconexión en partida
   */
  handlePlayerDisconnect(gameId, socket) {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'playing') return;
    
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    
    console.log(`[Game] 💔 ${player.user.name} desconectado de partida ${gameId}`);
    
    // Notificar a otros jugadores
    this.io.to(gameId).emit('game:playerDisconnected', {
      player: player.position,
      name: player.user.name
    });
    
    // Dar tiempo para reconexión
    setTimeout(() => {
      const currentGame = this.games.get(gameId);
      if (!currentGame || currentGame.status !== 'playing') return;
      
      // Si sigue desconectado, declarar victoria al otro equipo
      const updatedPlayer = currentGame.players.find(p => p.socketId === socket.id);
      if (!updatedPlayer || !this.io.sockets.sockets.get(socket.id)) {
        // Jugador no reconectó
        game.state.scores[updatedPlayer.team === 0 ? 'team1' : 'team0'] = game.targetScore;
        this.handleGameEnd(gameId);
      }
    }, 30000);
  }
  
  /**
   * Enviar emote
   */
  sendEmote(gameId, socketId, emote) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    const player = game.players.find(p => p.socketId === socketId);
    if (!player) return;
    
    this.io.to(gameId).emit('game:emote', {
      player: player.position,
      emote
    });
  }
  
  /**
   * Limpiar partida
   */
  cleanupGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Limpiar timer
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
    }
    
    // Remover jugadores
    game.players.forEach(p => {
      if (p.socketId) {
        this.playerGames.delete(p.socketId);
      }
    });
    
    this.games.delete(gameId);
    console.log(`[Game] 🧹 Partida ${gameId} limpiada`);
  }
  
  /**
   * Obtener estadísticas
   */
  getOnlineCount() {
    return this.onlinePlayers.size;
  }
  
  getActiveGamesCount() {
    return Array.from(this.games.values()).filter(g => g.status === 'playing').length;
  }
}

export default GameManager;
