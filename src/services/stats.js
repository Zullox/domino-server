// ============================================================================
// SERVICIO DE ESTADÍSTICAS - Firebase Integration
// ============================================================================
import { getDocument, updateDocument, queryCollection, batchWrite, admin } from '../config/firebase.js';
import { GlickoService } from './glicko.js';

export const StatsService = {
  /**
   * Obtener datos de usuario
   */
  async getUserData(userId) {
    try {
      const user = await getDocument('users', userId);
      return user;
    } catch (error) {
      console.error('[Stats] Error getUserData:', error);
      return null;
    }
  },
  
  /**
   * Actualizar resultado de partida
   */
  async updateGameResult(userId, result) {
    try {
      const { 
        won, 
        newRating, 
        newRd, 
        newVolatility, 
        ratingChange,
        points,
        isDomino,
        isTranca,
        isCapicua,
        isPollona
      } = result;
      
      const user = await getDocument('users', userId);
      if (!user) {
        console.error('[Stats] Usuario no encontrado:', userId);
        return false;
      }
      
      // Calcular nuevo win streak
      const currentStreak = user.stats?.winStreak || 0;
      const newWinStreak = won ? currentStreak + 1 : 0;
      const maxWinStreak = Math.max(newWinStreak, user.stats?.maxWinStreak || 0);
      
      // Calcular XP y tokens
      const baseXP = won ? 100 : 30;
      const bonusXP = points || 0;
      const totalXP = baseXP + bonusXP;
      
      const baseTokens = won ? 50 : 10;
      const bonusTokens = (isDomino ? 20 : 0) + (isTranca ? 30 : 0) + (isCapicua ? 50 : 0);
      const totalTokens = baseTokens + bonusTokens;
      
      // Calcular nivel
      let newLevel = user.level || 1;
      let newExperience = (user.experience || 0) + totalXP;
      
      while (newExperience >= newLevel * 500) {
        newExperience -= newLevel * 500;
        newLevel++;
      }
      
      // Determinar nuevo rango
      const newRank = GlickoService.getRank(newRating);
      
      // Preparar actualización
      const updates = {
        // Stats de partidas
        'stats.gamesPlayed': admin?.firestore?.FieldValue?.increment(1) || (user.stats?.gamesPlayed || 0) + 1,
        'stats.wins': won ? (admin?.firestore?.FieldValue?.increment(1) || (user.stats?.wins || 0) + 1) : (user.stats?.wins || 0),
        'stats.losses': won ? (user.stats?.losses || 0) : (admin?.firestore?.FieldValue?.increment(1) || (user.stats?.losses || 0) + 1),
        'stats.winStreak': newWinStreak,
        'stats.maxWinStreak': maxWinStreak,
        'stats.totalPoints': admin?.firestore?.FieldValue?.increment(points || 0) || (user.stats?.totalPoints || 0) + (points || 0),
        
        // Stats especiales
        'stats.dominoes': isDomino 
          ? (admin?.firestore?.FieldValue?.increment(1) || (user.stats?.dominoes || 0) + 1)
          : (user.stats?.dominoes || 0),
        'stats.trancas': isTranca
          ? (admin?.firestore?.FieldValue?.increment(1) || (user.stats?.trancas || 0) + 1)
          : (user.stats?.trancas || 0),
        'stats.capicuas': isCapicua
          ? (admin?.firestore?.FieldValue?.increment(1) || (user.stats?.capicuas || 0) + 1)
          : (user.stats?.capicuas || 0),
        'stats.pollonas': isPollona
          ? (admin?.firestore?.FieldValue?.increment(1) || (user.stats?.pollonas || 0) + 1)
          : (user.stats?.pollonas || 0),
        
        // Rating
        rating: newRating,
        rd: newRd,
        volatility: newVolatility,
        rank: newRank,
        
        // Peak rating
        ...(newRating > (user.peakRating || 1500) && {
          peakRating: newRating,
          peakRank: newRank
        }),
        
        // Economía y progreso
        tokens: admin?.firestore?.FieldValue?.increment(totalTokens) || (user.tokens || 0) + totalTokens,
        experience: newExperience,
        level: newLevel,
        
        // Timestamp
        lastPlayed: new Date()
      };
      
      await updateDocument('users', userId, updates);
      
      console.log(`[Stats] ✅ ${userId}: ${won ? 'Victoria' : 'Derrota'} | Rating: ${newRating} (${ratingChange >= 0 ? '+' : ''}${ratingChange}) | +${totalTokens} tokens`);
      
      return {
        success: true,
        xpGained: totalXP,
        tokensGained: totalTokens,
        leveledUp: newLevel > (user.level || 1),
        newLevel,
        newRank,
        ratingChange
      };
    } catch (error) {
      console.error('[Stats] Error updateGameResult:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Guardar partida en historial
   */
  async saveMatch(matchData) {
    try {
      const { db } = await import('../config/firebase.js');
      if (!db) return false;
      
      const matchRef = db.collection('matches').doc();
      await matchRef.set({
        ...matchData,
        createdAt: new Date()
      });
      
      console.log(`[Stats] 📝 Partida guardada: ${matchRef.id}`);
      return matchRef.id;
    } catch (error) {
      console.error('[Stats] Error saveMatch:', error);
      return null;
    }
  },
  
  /**
   * Obtener leaderboard
   */
  async getLeaderboard(limit = 100) {
    try {
      const users = await queryCollection(
        'users',
        [],
        'rating:desc',
        limit
      );
      
      return users.map((user, index) => ({
        position: index + 1,
        odId: user.id,
        name: user.name,
        avatar: user.avatar,
        country: user.country,
        rating: user.rating || 1500,
        rank: user.rank || 'Bronze III',
        wins: user.stats?.wins || 0,
        gamesPlayed: user.stats?.gamesPlayed || 0
      }));
    } catch (error) {
      console.error('[Stats] Error getLeaderboard:', error);
      return [];
    }
  },
  
  /**
   * Obtener estadísticas globales
   */
  async getGlobalStats() {
    try {
      const { db } = await import('../config/firebase.js');
      if (!db) {
        return { totalUsers: 0, totalMatches: 0, onlineNow: 0 };
      }
      
      // Contar usuarios
      const usersSnapshot = await db.collection('users').count().get();
      const totalUsers = usersSnapshot.data().count;
      
      // Contar partidas
      const matchesSnapshot = await db.collection('matches').count().get();
      const totalMatches = matchesSnapshot.data().count;
      
      return {
        totalUsers,
        totalMatches,
        onlineNow: global.gameManager?.getOnlineCount() || 0,
        activeGames: global.gameManager?.getActiveGamesCount() || 0
      };
    } catch (error) {
      console.error('[Stats] Error getGlobalStats:', error);
      return { totalUsers: 0, totalMatches: 0, onlineNow: 0 };
    }
  },
  
  /**
   * Marcar usuario como online/offline
   */
  async setUserOnlineStatus(userId, isOnline) {
    try {
      await updateDocument('users', userId, {
        isOnline,
        lastLogin: new Date()
      });
    } catch (error) {
      console.error('[Stats] Error setUserOnlineStatus:', error);
    }
  }
};

export default StatsService;
