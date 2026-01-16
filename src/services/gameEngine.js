// ============================================================================
// MOTOR DEL JUEGO - DOMINÓ CUBANO (DOBLE 9)
// ============================================================================

/**
 * Crear todas las fichas del dominó cubano (55 fichas - doble 9)
 */
export const createTiles = () => {
  const tiles = [];
  let id = 0;
  
  for (let i = 0; i <= 9; i++) {
    for (let j = i; j <= 9; j++) {
      tiles.push({
        id: id++,
        top: i,
        bottom: j,
        isDouble: i === j,
        value: i + j
      });
    }
  }
  
  return tiles; // 55 fichas
};

/**
 * Mezclar array (Fisher-Yates)
 */
export const shuffle = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Repartir fichas a los 4 jugadores (10 fichas cada uno)
 * Las 15 fichas restantes quedan fuera del juego
 */
export const dealTiles = () => {
  const tiles = shuffle(createTiles());
  
  return {
    hands: [
      tiles.slice(0, 10),   // Jugador 0 (Equipo 0) - 10 fichas
      tiles.slice(10, 20),  // Jugador 1 (Equipo 1) - 10 fichas
      tiles.slice(20, 30),  // Jugador 2 (Equipo 0) - 10 fichas
      tiles.slice(30, 40)   // Jugador 3 (Equipo 1) - 10 fichas
    ],
    tiles: tiles.slice(0, 40), // Solo las 40 fichas en juego
    outOfGame: tiles.slice(40) // 15 fichas fuera del juego
  };
};

/**
 * Encontrar quién tiene el doble más alto para salir
 */
export const findStartingPlayer = (hands) => {
  // Buscar doble 9, luego 8, 7, 6, 5, 4, 3, 2, 1, 0
  for (let double = 9; double >= 0; double--) {
    for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
      const hasTile = hands[playerIndex].find(t => t.top === double && t.bottom === double);
      if (hasTile) {
        return { playerIndex, tile: hasTile };
      }
    }
  }
  
  // Si no hay dobles, buscar la ficha más alta
  let highestValue = -1;
  let startingPlayer = 0;
  let startingTile = null;
  
  hands.forEach((hand, playerIndex) => {
    hand.forEach(tile => {
      if (tile.value > highestValue) {
        highestValue = tile.value;
        startingPlayer = playerIndex;
        startingTile = tile;
      }
    });
  });
  
  return { playerIndex: startingPlayer, tile: startingTile };
};

/**
 * Verificar si una ficha puede jugarse en un extremo
 */
export const canPlayTile = (tile, endpoint) => {
  if (endpoint === null) return true; // Tablero vacío
  return tile.top === endpoint || tile.bottom === endpoint;
};

/**
 * Obtener movimientos válidos para un jugador
 */
export const getValidMoves = (hand, leftEnd, rightEnd) => {
  const moves = [];
  
  hand.forEach(tile => {
    // Lado izquierdo
    if (canPlayTile(tile, leftEnd)) {
      moves.push({
        tile,
        side: 'left',
        rotated: tile.bottom === leftEnd
      });
    }
    
    // Lado derecho (si es diferente del izquierdo o tablero vacío)
    if (leftEnd !== rightEnd || leftEnd === null) {
      if (canPlayTile(tile, rightEnd)) {
        // Evitar duplicados para fichas que pueden ir en ambos lados
        const alreadyAdded = moves.some(m => m.tile.id === tile.id && m.side === 'right');
        if (!alreadyAdded) {
          moves.push({
            tile,
            side: 'right',
            rotated: tile.top === rightEnd
          });
        }
      }
    }
  });
  
  return moves;
};

/**
 * Verificar si un jugador puede jugar (tiene movimientos válidos)
 */
export const canPlay = (hand, leftEnd, rightEnd) => {
  return getValidMoves(hand, leftEnd, rightEnd).length > 0;
};

/**
 * Verificar si hay tranca (nadie puede jugar)
 */
export const isTranca = (hands, leftEnd, rightEnd) => {
  for (let i = 0; i < 4; i++) {
    if (canPlay(hands[i], leftEnd, rightEnd)) {
      return false;
    }
  }
  return true;
};

/**
 * Calcular puntos de una mano
 */
export const calculateHandPoints = (hand) => {
  return hand.reduce((sum, tile) => sum + tile.value, 0);
};

/**
 * Calcular puntos de ambos equipos
 */
export const calculateTeamPoints = (hands) => {
  return {
    team0: calculateHandPoints(hands[0]) + calculateHandPoints(hands[2]),
    team1: calculateHandPoints(hands[1]) + calculateHandPoints(hands[3])
  };
};

/**
 * Determinar ganador de la ronda
 */
export const determineRoundWinner = (hands, lastPlayer, isDomino) => {
  if (isDomino) {
    // Gana el equipo del jugador que hizo dominó
    return lastPlayer % 2 === 0 ? 0 : 1;
  }
  
  // Tranca - gana quien tiene menos puntos
  const teamPoints = calculateTeamPoints(hands);
  
  if (teamPoints.team0 < teamPoints.team1) return 0;
  if (teamPoints.team1 < teamPoints.team0) return 1;
  return -1; // Empate
};

/**
 * Calcular puntos ganados en la ronda
 */
export const calculateRoundPoints = (hands, winnerTeam, isDomino, isCapicua = false) => {
  const teamPoints = calculateTeamPoints(hands);
  
  // Puntos base = puntos del equipo perdedor
  let basePoints = winnerTeam === 0 ? teamPoints.team1 : teamPoints.team0;
  
  // Bonificaciones
  if (isDomino) {
    // Si el perdedor tiene más de 30 puntos, bonus
    if (basePoints >= 30) basePoints += 10;
  }
  
  // Capicúa (última ficha cierra con el mismo número en ambos extremos)
  if (isCapicua) {
    basePoints *= 2;
  }
  
  return basePoints;
};

/**
 * Seleccionar mejor jugada para la IA
 */
export const selectAIMove = (hand, leftEnd, rightEnd, difficulty = 'medium') => {
  const validMoves = getValidMoves(hand, leftEnd, rightEnd);
  
  if (validMoves.length === 0) return null;
  if (validMoves.length === 1) return validMoves[0];
  
  // Dificultad fácil: movimiento aleatorio
  if (difficulty === 'easy') {
    return validMoves[Math.floor(Math.random() * validMoves.length)];
  }
  
  // Dificultad media/difícil: estrategia básica
  const scoredMoves = validMoves.map(move => {
    let score = 0;
    
    // Preferir fichas de mayor valor (liberar puntos)
    score += move.tile.value * 2;
    
    // Preferir dobles temprano
    if (move.tile.isDouble) {
      score += 5;
    }
    
    // Penalizar guardar fichas altas
    const remainingHand = hand.filter(t => t.id !== move.tile.id);
    const remainingPoints = calculateHandPoints(remainingHand);
    score -= remainingPoints * 0.1;
    
    // Dificultad difícil: más estrategia
    if (difficulty === 'hard') {
      // Preferir jugadas que dejen extremos que tenemos
      const newEnd = move.rotated 
        ? (move.side === 'left' ? move.tile.top : move.tile.bottom)
        : (move.side === 'left' ? move.tile.bottom : move.tile.top);
      
      const tilesWithNewEnd = remainingHand.filter(t => 
        t.top === newEnd || t.bottom === newEnd
      ).length;
      
      score += tilesWithNewEnd * 3;
    }
    
    return { move, score };
  });
  
  // Ordenar por puntaje y agregar algo de aleatoriedad
  scoredMoves.sort((a, b) => b.score - a.score);
  
  // En dificultad media, 20% de chance de no tomar la mejor opción
  if (difficulty === 'medium' && Math.random() < 0.2 && scoredMoves.length > 1) {
    return scoredMoves[1].move;
  }
  
  return scoredMoves[0].move;
};

/**
 * Crear estado inicial del juego
 */
export const createGameState = () => {
  const { hands } = dealTiles();
  const { playerIndex, tile } = findStartingPlayer(hands);
  
  return {
    hands,
    board: [],
    leftEnd: null,
    rightEnd: null,
    currentPlayer: playerIndex,
    startingPlayer: playerIndex,
    startingTile: tile,
    passCount: 0,
    roundNumber: 1,
    scores: { team0: 0, team1: 0 },
    lastMove: null,
    history: [],
    phase: 'playing'
  };
};

/**
 * Aplicar jugada al estado
 */
export const applyMove = (state, playerIndex, tile, side) => {
  const newState = JSON.parse(JSON.stringify(state));
  
  // Remover ficha de la mano
  newState.hands[playerIndex] = newState.hands[playerIndex].filter(t => t.id !== tile.id);
  
  // Determinar orientación
  let playedTile = { ...tile };
  
  if (newState.board.length === 0) {
    // Primera ficha
    newState.board.push(playedTile);
    newState.leftEnd = tile.top;
    newState.rightEnd = tile.bottom;
  } else if (side === 'left') {
    // Jugar a la izquierda
    if (tile.bottom === newState.leftEnd) {
      playedTile.orientation = 'normal';
    } else {
      playedTile.orientation = 'rotated';
      [playedTile.top, playedTile.bottom] = [playedTile.bottom, playedTile.top];
    }
    newState.board.unshift(playedTile);
    newState.leftEnd = playedTile.top;
  } else {
    // Jugar a la derecha
    if (tile.top === newState.rightEnd) {
      playedTile.orientation = 'normal';
    } else {
      playedTile.orientation = 'rotated';
      [playedTile.top, playedTile.bottom] = [playedTile.bottom, playedTile.top];
    }
    newState.board.push(playedTile);
    newState.rightEnd = playedTile.bottom;
  }
  
  // Registrar jugada
  newState.lastMove = {
    player: playerIndex,
    tile: tile,
    side,
    timestamp: Date.now()
  };
  
  newState.history.push(newState.lastMove);
  newState.passCount = 0;
  
  // Verificar si hizo dominó
  if (newState.hands[playerIndex].length === 0) {
    newState.phase = 'roundEnd';
    newState.roundResult = {
      type: 'domino',
      winner: playerIndex % 2,
      lastPlayer: playerIndex,
      isCapicua: newState.leftEnd === newState.rightEnd
    };
  } else {
    // Siguiente turno
    newState.currentPlayer = (playerIndex + 1) % 4;
  }
  
  return newState;
};

/**
 * Aplicar pase
 */
export const applyPass = (state, playerIndex) => {
  const newState = JSON.parse(JSON.stringify(state));
  
  newState.passCount++;
  newState.lastMove = {
    player: playerIndex,
    type: 'pass',
    timestamp: Date.now()
  };
  newState.history.push(newState.lastMove);
  
  // Verificar tranca (4 pases seguidos = todos pasaron)
  if (newState.passCount >= 4) {
    const winner = determineRoundWinner(newState.hands, playerIndex, false);
    newState.phase = 'roundEnd';
    newState.roundResult = {
      type: 'tranca',
      winner: winner,
      teamPoints: calculateTeamPoints(newState.hands)
    };
  } else {
    newState.currentPlayer = (playerIndex + 1) % 4;
  }
  
  return newState;
};

/**
 * Iniciar nueva ronda
 */
export const startNewRound = (state) => {
  const { hands } = dealTiles();
  const { playerIndex, tile } = findStartingPlayer(hands);
  
  return {
    ...state,
    hands,
    board: [],
    leftEnd: null,
    rightEnd: null,
    currentPlayer: playerIndex,
    startingPlayer: playerIndex,
    startingTile: tile,
    passCount: 0,
    roundNumber: state.roundNumber + 1,
    lastMove: null,
    history: [],
    phase: 'playing',
    roundResult: null
  };
};

export default {
  createTiles,
  dealTiles,
  findStartingPlayer,
  canPlayTile,
  getValidMoves,
  canPlay,
  isTranca,
  calculateHandPoints,
  calculateTeamPoints,
  determineRoundWinner,
  calculateRoundPoints,
  selectAIMove,
  createGameState,
  applyMove,
  applyPass,
  startNewRound
};
