// ============================================================================
// SERVIDOR PRINCIPAL - DOMINÓ CUBANO ONLINE
// ============================================================================
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Importar módulos
import { initFirebase, verifyToken, getDocument } from './config/firebase.js';
import { setupSocketEvents } from './events/index.js';
import { MatchmakingService } from './services/matchmaking.js';
import { GameManager } from './services/gameManager.js';
import { StatsService } from './services/stats.js';
import { GlickoService } from './services/glicko.js';

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// CORS Origins - parsear correctamente
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

console.log(`[Config] Entorno: ${NODE_ENV}`);
console.log(`[Config] CORS Origins: ${CORS_ORIGINS.join(', ')}`);

// Inicializar Firebase Admin
initFirebase();

// ============================================================================
// EXPRESS APP
// ============================================================================
const app = express();

// Trust proxy para obtener IP real detrás de reverse proxy
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// Middleware de seguridad
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Deshabilitar CSP para WebSocket
}));

// CORS
app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    
    if (CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes('*')) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origen bloqueado: ${origin}`);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging - menos verbose en producción
app.use(morgan(IS_PRODUCTION ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

// ============================================================================
// RUTAS HTTP (REST API)
// ============================================================================

// Health check - importante para el hosting
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    env: NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
    players: global.gameManager?.getOnlineCount() || 0,
    games: global.gameManager?.getActiveGamesCount() || 0,
    queue: global.matchmaking?.queue?.size || 0
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    name: 'Dominó Cubano Online - API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      stats: '/api/stats',
      leaderboard: '/api/leaderboard',
      user: '/api/users/:id'
    },
    websocket: `wss://${req.get('host')}`
  });
});

// Estadísticas globales
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await StatsService.getGlobalStats();
    res.json(stats);
  } catch (error) {
    console.error('[API] Error en /api/stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const leaderboard = await StatsService.getLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    console.error('[API] Error en /api/leaderboard:', error);
    res.status(500).json({ error: 'Error al obtener leaderboard' });
  }
});

// Perfil de usuario público
app.get('/api/users/:userId', async (req, res) => {
  try {
    const user = await StatsService.getUserData(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({
      odId: user.id,
      name: user.name,
      avatar: user.avatar,
      country: user.country,
      rating: user.rating,
      rank: user.rank,
      level: user.level,
      stats: {
        gamesPlayed: user.stats?.gamesPlayed || 0,
        wins: user.stats?.wins || 0,
        winRate: user.stats?.gamesPlayed > 0 
          ? Math.round((user.stats?.wins / user.stats.gamesPlayed) * 100) 
          : 0,
        maxWinStreak: user.stats?.maxWinStreak || 0
      },
      createdAt: user.createdAt
    });
  } catch (error) {
    console.error('[API] Error en /api/users:', error);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// Estado del matchmaking
app.get('/api/matchmaking/status', (req, res) => {
  const stats = global.matchmaking?.getStats() || { playersInQueue: 0 };
  res.json(stats);
});

// ============================================================================
// HTTP SERVER + SOCKET.IO
// ============================================================================
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 1024 // Solo comprimir mensajes > 1KB
  },
  // Límites para producción
  maxHttpBufferSize: 1e6 // 1MB
});

// ============================================================================
// SERVICIOS GLOBALES
// ============================================================================
const matchmaking = new MatchmakingService(io);
const gameManager = new GameManager(io);

global.io = io;
global.matchmaking = matchmaking;
global.gameManager = gameManager;

// ============================================================================
// MIDDLEWARE DE AUTENTICACIÓN SOCKET
// ============================================================================
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      // Permitir conexiones de invitados
      socket.user = {
        uid: `guest_${socket.id}`,
        name: `Invitado_${Math.floor(Math.random() * 9999)}`,
        isGuest: true,
        rating: 1500,
        rd: 350,
        volatility: 0.06,
        rank: 'Bronze III'
      };
      console.log(`[Auth] 👤 Invitado: ${socket.user.name}`);
      return next();
    }
    
    // Verificar token de Firebase
    const decodedToken = await verifyToken(token);
    
    if (!decodedToken) {
      return next(new Error('Token inválido'));
    }
    
    // Cargar datos del usuario desde Firestore
    const userData = await getDocument('users', decodedToken.uid);
    
    socket.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userData?.name || decodedToken.name || 'Jugador',
      avatar: userData?.avatar || null,
      rating: userData?.rating || 1500,
      rd: userData?.rd || 350,
      volatility: userData?.volatility || 0.06,
      rank: userData?.rank || GlickoService.getRank(userData?.rating || 1500),
      isGuest: false
    };
    
    console.log(`[Auth] ✅ ${socket.user.name} (${socket.user.rating})`);
    next();
  } catch (error) {
    console.error('[Auth] Error:', error.message);
    next(new Error('Error de autenticación'));
  }
});

// ============================================================================
// CONEXIONES DE SOCKET
// ============================================================================
io.on('connection', (socket) => {
  console.log(`[Socket] ✅ ${socket.user.name} conectado (${socket.id})`);
  
  // Registrar jugador online
  gameManager.playerConnected(socket);
  
  // Marcar como online en Firebase
  if (!socket.user.isGuest) {
    StatsService.setUserOnlineStatus(socket.user.uid, true);
  }
  
  // Configurar eventos
  setupSocketEvents(socket, { matchmaking, gameManager });
  
  // Enviar confirmación
  socket.emit('connected', {
    user: socket.user,
    serverTime: Date.now()
  });
  
  // Desconexión
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] ❌ ${socket.user.name} desconectado (${reason})`);
    
    matchmaking.removeFromQueue(socket.id);
    gameManager.playerDisconnected(socket);
    
    if (!socket.user.isGuest) {
      StatsService.setUserOnlineStatus(socket.user.uid, false);
    }
  });
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           🎲 DOMINÓ CUBANO ONLINE - SERVIDOR 🎲            ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  🌐 Puerto: ${String(PORT).padEnd(46)}║`);
  console.log(`║  🔧 Entorno: ${NODE_ENV.padEnd(45)}║`);
  console.log(`║  🔗 CORS: ${CORS_ORIGINS[0]?.substring(0, 47).padEnd(47)}║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  if (IS_PRODUCTION) {
    console.log('║  🚀 MODO PRODUCCIÓN ACTIVO                                 ║');
  } else {
    console.log('║  🛠️  Modo desarrollo                                        ║');
  }
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});

// ============================================================================
// MANEJO DE ERRORES Y SHUTDOWN GRACEFUL
// ============================================================================
const gracefulShutdown = (signal) => {
  console.log(`\n[Server] 🛑 ${signal} recibido, iniciando shutdown...`);
  
  // Notificar a todos los clientes
  io.emit('server:shutdown', { message: 'Servidor reiniciando...' });
  
  // Cerrar nuevas conexiones
  httpServer.close(() => {
    console.log('[Server] ✅ HTTP server cerrado');
    
    // Limpiar partidas activas
    console.log('[Server] 🧹 Limpiando partidas...');
    
    process.exit(0);
  });
  
  // Forzar cierre después de 10s
  setTimeout(() => {
    console.log('[Server] ⚠️ Forzando cierre...');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[Server] ❌ Uncaught Exception:', error);
  if (IS_PRODUCTION) {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] ❌ Unhandled Rejection:', reason);
});

export { io, app, matchmaking, gameManager };
