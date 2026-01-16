// ============================================================================
// SERVICIO GLICKO-2 - Sistema de Ranking
// ============================================================================
// Implementación del sistema de rating Glicko-2 para partidas competitivas

const TAU = 0.5; // Constante del sistema (0.3-1.2, menor = más estable)
const CONVERGENCE_TOLERANCE = 0.000001;

/**
 * Convertir rating a escala Glicko-2
 */
const toGlicko2Scale = (rating, rd) => ({
  mu: (rating - 1500) / 173.7178,
  phi: rd / 173.7178
});

/**
 * Convertir de escala Glicko-2 a rating normal
 */
const fromGlicko2Scale = (mu, phi) => ({
  rating: mu * 173.7178 + 1500,
  rd: phi * 173.7178
});

/**
 * Función g(phi)
 */
const g = (phi) => {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
};

/**
 * Función E (probabilidad esperada)
 */
const E = (mu, muJ, phiJ) => {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
};

/**
 * Calcular varianza v
 */
const computeVariance = (mu, opponents) => {
  let sum = 0;
  
  for (const opp of opponents) {
    const gPhiJ = g(opp.phi);
    const eVal = E(mu, opp.mu, opp.phi);
    sum += gPhiJ * gPhiJ * eVal * (1 - eVal);
  }
  
  return 1 / sum;
};

/**
 * Calcular delta (mejora estimada)
 */
const computeDelta = (mu, opponents, v) => {
  let sum = 0;
  
  for (const opp of opponents) {
    const gPhiJ = g(opp.phi);
    const eVal = E(mu, opp.mu, opp.phi);
    sum += gPhiJ * (opp.score - eVal);
  }
  
  return v * sum;
};

/**
 * Calcular nueva volatilidad usando el algoritmo de Illinois
 */
const computeNewVolatility = (sigma, phi, v, delta) => {
  const a = Math.log(sigma * sigma);
  const phiSquared = phi * phi;
  const deltaSquared = delta * delta;
  
  const f = (x) => {
    const expX = Math.exp(x);
    const tmp = phiSquared + v + expX;
    const part1 = (expX * (deltaSquared - phiSquared - v - expX)) / (2 * tmp * tmp);
    const part2 = (x - a) / (TAU * TAU);
    return part1 - part2;
  };
  
  // Establecer límites iniciales
  let A = a;
  let B;
  
  if (deltaSquared > phiSquared + v) {
    B = Math.log(deltaSquared - phiSquared - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) {
      k++;
    }
    B = a - k * TAU;
  }
  
  // Búsqueda por bisección
  let fA = f(A);
  let fB = f(B);
  
  while (Math.abs(B - A) > CONVERGENCE_TOLERANCE) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    
    B = C;
    fB = fC;
  }
  
  return Math.exp(A / 2);
};

/**
 * Servicio de Glicko-2
 */
export const GlickoService = {
  /**
   * Calcular nuevo rating después de una partida
   * @param {Object} player - {rating, rd, volatility}
   * @param {Object} opponent - {rating, rd, volatility}
   * @param {number} score - 1 = victoria, 0.5 = empate, 0 = derrota
   * @returns {Object} Nuevos ratings para ambos jugadores
   */
  calculateMatch(player, opponent, score) {
    // Convertir a escala Glicko-2
    const p = toGlicko2Scale(player.rating, player.rd);
    p.sigma = player.volatility || 0.06;
    
    const o = toGlicko2Scale(opponent.rating, opponent.rd);
    o.sigma = opponent.volatility || 0.06;
    
    // Calcular para jugador
    const opponentsP = [{ mu: o.mu, phi: o.phi, score: score }];
    const vP = computeVariance(p.mu, opponentsP);
    const deltaP = computeDelta(p.mu, opponentsP, vP);
    const newSigmaP = computeNewVolatility(p.sigma, p.phi, vP, deltaP);
    
    // Actualizar phi
    const phiStarP = Math.sqrt(p.phi * p.phi + newSigmaP * newSigmaP);
    const newPhiP = 1 / Math.sqrt(1 / (phiStarP * phiStarP) + 1 / vP);
    
    // Actualizar mu
    const newMuP = p.mu + newPhiP * newPhiP * (deltaP / vP);
    
    // Calcular para oponente (score invertido)
    const opponentsO = [{ mu: p.mu, phi: p.phi, score: 1 - score }];
    const vO = computeVariance(o.mu, opponentsO);
    const deltaO = computeDelta(o.mu, opponentsO, vO);
    const newSigmaO = computeNewVolatility(o.sigma, o.phi, vO, deltaO);
    
    const phiStarO = Math.sqrt(o.phi * o.phi + newSigmaO * newSigmaO);
    const newPhiO = 1 / Math.sqrt(1 / (phiStarO * phiStarO) + 1 / vO);
    const newMuO = o.mu + newPhiO * newPhiO * (deltaO / vO);
    
    // Convertir de vuelta
    const newPlayerRating = fromGlicko2Scale(newMuP, newPhiP);
    const newOpponentRating = fromGlicko2Scale(newMuO, newPhiO);
    
    return {
      player1: {
        rating: Math.round(newPlayerRating.rating),
        rd: Math.round(newPlayerRating.rd * 10) / 10,
        volatility: Math.round(newSigmaP * 10000) / 10000,
        ratingChange: Math.round(newPlayerRating.rating) - player.rating
      },
      player2: {
        rating: Math.round(newOpponentRating.rating),
        rd: Math.round(newOpponentRating.rd * 10) / 10,
        volatility: Math.round(newSigmaO * 10000) / 10000,
        ratingChange: Math.round(newOpponentRating.rating) - opponent.rating
      }
    };
  },
  
  /**
   * Obtener rango basado en rating
   */
  getRank(rating) {
    if (rating >= 2700) return 'Legend';
    if (rating >= 2400) return 'Master';
    if (rating >= 2100) return 'Diamond I';
    if (rating >= 2000) return 'Diamond II';
    if (rating >= 1900) return 'Diamond III';
    if (rating >= 1800) return 'Platinum I';
    if (rating >= 1700) return 'Platinum II';
    if (rating >= 1600) return 'Platinum III';
    if (rating >= 1500) return 'Gold I';
    if (rating >= 1400) return 'Gold II';
    if (rating >= 1300) return 'Gold III';
    if (rating >= 1200) return 'Silver I';
    if (rating >= 1100) return 'Silver II';
    if (rating >= 1000) return 'Silver III';
    if (rating >= 900) return 'Bronze I';
    if (rating >= 800) return 'Bronze II';
    return 'Bronze III';
  },
  
  /**
   * Calcular probabilidad de victoria
   */
  expectedScore(player, opponent) {
    const p = toGlicko2Scale(player.rating, player.rd);
    const o = toGlicko2Scale(opponent.rating, opponent.rd);
    return E(p.mu, o.mu, o.phi);
  },
  
  /**
   * Decaimiento de RD por inactividad
   * Llamar periódicamente para jugadores inactivos
   */
  decayRD(rd, volatility, periodsSinceLastGame) {
    for (let i = 0; i < periodsSinceLastGame; i++) {
      const phi = rd / 173.7178;
      const newPhi = Math.sqrt(phi * phi + volatility * volatility);
      rd = newPhi * 173.7178;
    }
    return Math.min(350, rd); // Máximo RD = 350
  }
};

export default GlickoService;
