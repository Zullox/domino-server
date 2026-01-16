// ============================================================================
// SERVICIO DE MATCHMAKING - Emparejamiento por Rating
// ============================================================================
import { v4 as uuidv4 } from 'uuid';

// Configuración
const RATING_RANGE_INITIAL = parseInt(process.env.RATING_RANGE_INITIAL) || 100;
const RATING_RANGE_INCREMENT = parseInt(process.env.RATING_RANGE_INCREMENT) || 50;
const RATING_RANGE_MAX = parseInt(process.env.RATING_RANGE_MAX) || 500;
const MATCHMAKING_TIMEOUT = parseInt(process.env.MATCHMAKING_TIMEOUT) || 60000;
const MATCH_CHECK_INTERVAL = 2000; // Verificar matches cada 2 segundos

/**
 * Clase para gestionar el matchmaking
 */
export class MatchmakingService {
  constructor(io) {
    this.io = io;
    this.queue = new Map(); // socketId -> QueueEntry
    this.checkInterval = null;
    
    // Iniciar verificación periódica
    this.startMatchCheck();
  }
  
  /**
   * Añadir jugador a la cola
   */
  addToQueue(socket, options = {}) {
    const { mode = 'ranked', targetScore = 100 } = options;
    
    // Verificar si ya está en cola
    if (this.queue.has(socket.id)) {
      console.log(`[Matchmaking] ${socket.user.name} ya está en cola`);
      return false;
    }
    
    const entry = {
      socketId: socket.id,
      socket: socket,
      user: socket.user,
      rating: socket.user.rating || 1500,
      rd: socket.user.rd || 350,
      joinedAt: Date.now(),
      ratingRange: RATING_RANGE_INITIAL,
      mode,
      targetScore,
      expanded: 0 // Veces que se expandió el rango
    };
    
    this.queue.set(socket.id, entry);
    
    console.log(`[Matchmaking] ➕ ${socket.user.name} (${entry.rating}) añadido a la cola`);
    console.log(`[Matchmaking] 📊 Jugadores en cola: ${this.queue.size}`);
    
    // Notificar al jugador
    socket.emit('matchmaking:joined', {
      position: this.queue.size,
      estimatedTime: this.estimateWaitTime()
    });
    
    // Intentar match inmediato
    this.tryMatch(entry);
    
    return true;
  }
  
  /**
   * Remover jugador de la cola
   */
  removeFromQueue(socketId) {
    const entry = this.queue.get(socketId);
    
    if (entry) {
      this.queue.delete(socketId);
      console.log(`[Matchmaking] ➖ ${entry.user.name} removido de la cola`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Intentar encontrar un match (busca formar grupo de 4)
   */
  tryMatch(entry) {
    const match = this.tryFormMatch();
    
    if (match) {
      this.createMatch(match);
      return true;
    }
    
    return false;
  }
  
  /**
   * Intentar formar partida de 4 jugadores
   * Retorna array de 4 entries si se puede formar, null si no
   */
  tryFormMatch() {
    // Agrupar por modo y targetScore
    const groups = new Map();
    
    for (const [socketId, entry] of this.queue) {
      const key = `${entry.mode}_${entry.targetScore}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(entry);
    }
    
    // Buscar grupo con 4+ jugadores compatibles por rating
    for (const [key, entries] of groups) {
      if (entries.length < 4) continue;
      
      // Ordenar por rating
      entries.sort((a, b) => a.rating - b.rating);
      
      // Buscar 4 jugadores con ratings compatibles
      for (let i = 0; i <= entries.length - 4; i++) {
        const candidates = entries.slice(i, i + 4);
        const minRating = candidates[0].rating;
        const maxRating = candidates[3].rating;
        const maxRange = Math.max(...candidates.map(c => c.ratingRange));
        
        if (maxRating - minRating <= maxRange) {
          return candidates;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Crear partida con 4 jugadores reales
   */
  createMatch(players) {
    // Remover todos de la cola
    players.forEach(p => this.queue.delete(p.socketId));
    
    const gameId = uuidv4();
    
    // Asignar equipos balanceados por rating
    const assignedPlayers = this.assignTeams(players);
    
    console.log(`[Matchmaking] 🎮 ¡Partida encontrada!`);
    console.log(`  Equipo 0: ${assignedPlayers.filter(p => p.team === 0).map(p => `${p.user.name}(${p.user.rating})`).join(' + ')}`);
    console.log(`  Equipo 1: ${assignedPlayers.filter(p => p.team === 1).map(p => `${p.user.name}(${p.user.rating})`).join(' + ')}`);
    console.log(`  Game ID: ${gameId}`);
    
    // Notificar a todos los jugadores
    const matchData = {
      gameId,
      players: assignedPlayers.map(p => ({
        position: p.position,
        team: p.team,
        name: p.user.name,
        avatar: p.user.avatar,
        rating: p.user.rating
      })),
      mode: players[0].mode,
      targetScore: players[0].targetScore,
      timestamp: Date.now()
    };
    
    players.forEach(entry => {
      entry.socket.emit('matchmaking:found', matchData);
      entry.socket.join(gameId);
    });
    
    // Crear el juego en el GameManager
    global.gameManager.createGame(gameId, {
      players: assignedPlayers,
      mode: players[0].mode,
      targetScore: players[0].targetScore
    });
    
    return gameId;
  }
  
  /**
   * Asignar equipos balanceados (2v2)
   * Posiciones: 0 y 2 = Equipo 0, 1 y 3 = Equipo 1
   * Los compañeros se sientan en posiciones opuestas (0-2, 1-3)
   */
  assignTeams(entries) {
    // Ordenar por rating para balancear equipos
    const sorted = [...entries].sort((a, b) => b.rating - a.rating);
    
    // Emparejar: mejor con peor, segundo mejor con segundo peor
    // Equipo 0: jugadores 0 y 3 (mejor + peor)
    // Equipo 1: jugadores 1 y 2 (segundo mejor + segundo peor)
    const team0 = [sorted[0], sorted[3]];
    const team1 = [sorted[1], sorted[2]];
    
    // Mezclar posiciones dentro de cada equipo
    if (Math.random() > 0.5) team0.reverse();
    if (Math.random() > 0.5) team1.reverse();
    
    // Asignar posiciones (0,2 = equipo 0) (1,3 = equipo 1)
    const players = [
      { position: 0, team: 0, type: 'human', socketId: team0[0].socketId, user: team0[0].user },
      { position: 1, team: 1, type: 'human', socketId: team1[0].socketId, user: team1[0].user },
      { position: 2, team: 0, type: 'human', socketId: team0[1].socketId, user: team0[1].user },
      { position: 3, team: 1, type: 'human', socketId: team1[1].socketId, user: team1[1].user }
    ];
    
    return players;
  }
  
  /**
   * Expandir rango de búsqueda para jugadores que esperan
   */
  expandRanges() {
    const now = Date.now();
    
    for (const [socketId, entry] of this.queue) {
      const waitTime = now - entry.joinedAt;
      
      // Expandir cada 5 segundos
      const expansions = Math.floor(waitTime / 5000);
      
      if (expansions > entry.expanded && entry.ratingRange < RATING_RANGE_MAX) {
        entry.ratingRange = Math.min(
          RATING_RANGE_INITIAL + (expansions * RATING_RANGE_INCREMENT),
          RATING_RANGE_MAX
        );
        entry.expanded = expansions;
        
        console.log(`[Matchmaking] 📈 ${entry.user.name} rango expandido a ±${entry.ratingRange}`);
      }
      
      // Timeout
      if (waitTime > MATCHMAKING_TIMEOUT) {
        console.log(`[Matchmaking] ⏰ Timeout para ${entry.user.name}`);
        entry.socket.emit('matchmaking:timeout');
        this.queue.delete(socketId);
      }
    }
  }
  
  /**
   * Verificar matches periódicamente
   */
  startMatchCheck() {
    this.checkInterval = setInterval(() => {
      // Expandir rangos
      this.expandRanges();
      
      // Intentar matches para todos en cola
      for (const [socketId, entry] of this.queue) {
        this.tryMatch(entry);
      }
      
      // Broadcast estado de cola
      this.broadcastQueueStatus();
    }, MATCH_CHECK_INTERVAL);
  }
  
  /**
   * Enviar estado de cola a todos los jugadores en espera
   */
  broadcastQueueStatus() {
    let position = 1;
    
    for (const [socketId, entry] of this.queue) {
      entry.socket.emit('matchmaking:status', {
        position,
        playersInQueue: this.queue.size,
        waitTime: Math.floor((Date.now() - entry.joinedAt) / 1000),
        ratingRange: entry.ratingRange
      });
      position++;
    }
  }
  
  /**
   * Estimar tiempo de espera
   */
  estimateWaitTime() {
    if (this.queue.size <= 1) return 30; // 30 segundos estimado
    if (this.queue.size <= 5) return 15;
    return 5;
  }
  
  /**
   * Obtener estadísticas de la cola
   */
  getStats() {
    const ratings = Array.from(this.queue.values()).map(e => e.rating);
    
    return {
      playersInQueue: this.queue.size,
      averageRating: ratings.length > 0 
        ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
        : 0,
      minRating: ratings.length > 0 ? Math.min(...ratings) : 0,
      maxRating: ratings.length > 0 ? Math.max(...ratings) : 0
    };
  }
  
  /**
   * Detener el servicio
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

export default MatchmakingService;
