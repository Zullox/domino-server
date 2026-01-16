# 🎲 Dominó Cubano Online - Servidor

Servidor Node.js con Socket.io para el juego de Dominó Cubano Online.

## Características

- ⚡ **Tiempo real** con Socket.io
- 🎯 **Matchmaking** por rating (Glicko-2)
- 👥 **4 jugadores** humanos por partida
- 🔐 **Autenticación** con Firebase
- 📊 **Rankings** y estadísticas
- 🔄 **Reconexión** automática

## Requisitos

- Node.js 18+
- Cuenta de Firebase con Firestore habilitado

## Instalación Local

```bash
# Clonar
git clone https://github.com/tu-usuario/domino-server.git
cd domino-server

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de Firebase

# Ejecutar
npm run dev
```

## Variables de Entorno

```env
NODE_ENV=development
PORT=3001
CORS_ORIGINS=http://localhost:5173

# Firebase Admin SDK
FIREBASE_PROJECT_ID=tu-proyecto
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@tu-proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Estado del servidor |
| GET | `/api/stats` | Estadísticas globales |
| GET | `/api/leaderboard` | Top jugadores |
| GET | `/api/users/:id` | Perfil de usuario |

## Eventos WebSocket

### Cliente → Servidor

| Evento | Descripción |
|--------|-------------|
| `matchmaking:join` | Buscar partida |
| `matchmaking:cancel` | Cancelar búsqueda |
| `game:playTile` | Jugar ficha |
| `game:pass` | Pasar turno |
| `game:surrender` | Rendirse |

### Servidor → Cliente

| Evento | Descripción |
|--------|-------------|
| `matchmaking:found` | Partida encontrada |
| `game:start` | Inicio de partida |
| `game:move` | Ficha jugada |
| `game:roundEnd` | Fin de ronda |
| `game:end` | Fin de partida |

## Despliegue

Ver [DEPLOY.md](./DEPLOY.md) para instrucciones detalladas.

### Railway (Recomendado)

```bash
# Instalar CLI
npm install -g @railway/cli

# Login y deploy
railway login
railway init
railway up
```

### Docker

```bash
docker build -t domino-server .
docker run -d --env-file .env -p 3001:3001 domino-server
```

## Estructura

```
src/
├── index.js              # Servidor principal
├── config/
│   └── firebase.js       # Firebase Admin SDK
├── services/
│   ├── matchmaking.js    # Sistema de cola
│   ├── gameManager.js    # Gestión de partidas
│   ├── gameEngine.js     # Lógica del dominó
│   ├── glicko.js         # Sistema de rating
│   └── stats.js          # Estadísticas
└── events/
    └── index.js          # Handlers de Socket.io
```

## Licencia

MIT
