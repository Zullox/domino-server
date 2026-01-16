// ============================================================================
// EVENTOS DE SOCKET.IO
// ============================================================================

/**
 * Configurar todos los eventos de Socket.io para un socket
 */
export const setupSocketEvents = (socket, services) => {
  const { matchmaking, gameManager } = services;
  
  // ════════════════════════════════════════════════════════════════════════════
  // EVENTOS DE MATCHMAKING
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Buscar partida
   */
  socket.on('matchmaking:join', (options = {}) => {
    console.log(`[Socket] 🔍 ${socket.user.name} busca partida`);
    
    const { mode = 'ranked', targetScore = 100 } = options;
    
    matchmaking.addToQueue(socket, { mode, targetScore });
  });
  
  /**
   * Cancelar búsqueda
   */
  socket.on('matchmaking:cancel', () => {
    console.log(`[Socket] ❌ ${socket.user.name} cancela búsqueda`);
    
    matchmaking.removeFromQueue(socket.id);
    socket.emit('matchmaking:cancelled');
  });
  
  // ════════════════════════════════════════════════════════════════════════════
  // EVENTOS DE JUEGO
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Jugar ficha
   */
  socket.on('game:playTile', ({ gameId, tile, side }) => {
    const result = gameManager.playTile(gameId, socket.id, tile, side);
    
    if (!result.success) {
      socket.emit('game:error', { message: result.error });
    }
  });
  
  /**
   * Pasar turno
   */
  socket.on('game:pass', ({ gameId }) => {
    const result = gameManager.passTurn(gameId, socket.id);
    
    if (!result.success) {
      socket.emit('game:error', { message: result.error });
    }
  });
  
  /**
   * Enviar emote
   */
  socket.on('game:emote', ({ gameId, emote }) => {
    gameManager.sendEmote(gameId, socket.id, emote);
  });
  
  /**
   * Solicitar estado del juego (reconexión)
   */
  socket.on('game:requestState', ({ gameId }) => {
    const game = gameManager.games.get(gameId);
    
    if (!game) {
      socket.emit('game:error', { message: 'Partida no encontrada' });
      return;
    }
    
    const player = game.players.find(p => p.socketId === socket.id);
    
    if (!player) {
      socket.emit('game:error', { message: 'No eres parte de esta partida' });
      return;
    }
    
    // Enviar estado actual
    socket.emit('game:state', {
      gameId,
      position: player.position,
      team: player.team,
      hand: player.hand,
      players: game.players.map(p => ({
        position: p.position,
        team: p.team,
        name: p.user?.name || 'Jugador',
        avatar: p.user?.avatar,
        isAI: p.type === 'ai',
        handCount: game.state.hands[p.position].length
      })),
      board: game.state.board,
      leftEnd: game.state.leftEnd,
      rightEnd: game.state.rightEnd,
      currentPlayer: game.state.currentPlayer,
      scores: game.state.scores,
      roundNumber: game.state.roundNumber,
      targetScore: game.targetScore
    });
  });
  
  /**
   * Rendirse
   */
  socket.on('game:surrender', ({ gameId }) => {
    const game = gameManager.games.get(gameId);
    
    if (!game || game.status !== 'playing') return;
    
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    
    console.log(`[Game] 🏳️ ${player.user.name} se rinde en ${gameId}`);
    
    // Dar victoria al otro equipo
    game.state.scores[player.team === 0 ? 'team1' : 'team0'] = game.targetScore;
    gameManager.handleGameEnd(gameId);
  });
  
  // ════════════════════════════════════════════════════════════════════════════
  // EVENTOS SOCIALES
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Invitar amigo a jugar
   */
  socket.on('social:invite', async ({ friendId }) => {
    // Buscar socket del amigo
    const friendSocket = Array.from(global.io.sockets.sockets.values())
      .find(s => s.user?.uid === friendId);
    
    if (friendSocket) {
      friendSocket.emit('social:invitation', {
        from: {
          odId: socket.user.uid,
          name: socket.user.name,
          avatar: socket.user.avatar,
          rating: socket.user.rating
        }
      });
      socket.emit('social:inviteSent', { success: true });
    } else {
      socket.emit('social:inviteSent', { 
        success: false, 
        error: 'Amigo no está conectado' 
      });
    }
  });
  
  /**
   * Aceptar invitación
   */
  socket.on('social:acceptInvite', async ({ fromId }) => {
    // Buscar socket del que invitó
    const inviterSocket = Array.from(global.io.sockets.sockets.values())
      .find(s => s.user?.uid === fromId);
    
    if (!inviterSocket) {
      socket.emit('social:error', { message: 'El jugador ya no está disponible' });
      return;
    }
    
    // Crear partida privada directamente
    matchmaking.createMatch(
      { socket: inviterSocket, socketId: inviterSocket.id, user: inviterSocket.user, rating: inviterSocket.user.rating },
      { socket, socketId: socket.id, user: socket.user, rating: socket.user.rating }
    );
  });
  
  // ════════════════════════════════════════════════════════════════════════════
  // EVENTOS DE CHAT
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Mensaje de chat en partida
   */
  socket.on('chat:message', ({ gameId, message }) => {
    const game = gameManager.games.get(gameId);
    if (!game) return;
    
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    
    // Limitar longitud del mensaje
    const cleanMessage = message.substring(0, 100);
    
    // Broadcast a todos en la partida
    global.io.to(gameId).emit('chat:message', {
      from: {
        position: player.position,
        name: player.user?.name || 'Jugador'
      },
      message: cleanMessage,
      timestamp: Date.now()
    });
  });
  
  // ════════════════════════════════════════════════════════════════════════════
  // PING/PONG PERSONALIZADO
  // ════════════════════════════════════════════════════════════════════════════
  
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
};

export default { setupSocketEvents };
