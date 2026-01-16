# 🚀 Guía de Despliegue a Producción

## Índice
1. [Preparación](#1-preparación)
2. [Desplegar en Railway (Recomendado)](#2-railway)
3. [Desplegar en Render](#3-render)
4. [Desplegar en DigitalOcean](#4-digitalocean)
5. [Configurar el Cliente](#5-cliente)
6. [Verificación](#6-verificación)
7. [Monitoreo](#7-monitoreo)

---

## 1. Preparación

### 1.1 Obtener credenciales de Firebase Admin

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto `domino-online-4cc5f`
3. ⚙️ **Project Settings** → **Service Accounts**
4. Click **"Generate new private key"**
5. Descarga el archivo JSON
6. Del archivo JSON necesitarás:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY`

### 1.2 Preparar el repositorio

```bash
# Crear nuevo repositorio para el servidor
cd server
git init
git add .
git commit -m "Initial commit - Domino Server"

# Subir a GitHub
gh repo create domino-server --private --source=. --push
# O manualmente:
git remote add origin https://github.com/tu-usuario/domino-server.git
git push -u origin main
```

### 1.3 Archivos necesarios

Asegúrate de tener estos archivos en la carpeta `server/`:

```
server/
├── src/
│   ├── index.js
│   ├── config/firebase.js
│   ├── services/
│   │   ├── matchmaking.js
│   │   ├── gameManager.js
│   │   ├── gameEngine.js
│   │   ├── glicko.js
│   │   └── stats.js
│   └── events/index.js
├── package.json
├── Dockerfile
├── railway.json
├── render.yaml
└── .gitignore
```

Crea `.gitignore`:
```
node_modules/
.env
.env.local
.DS_Store
*.log
```

---

## 2. Railway

Railway es la opción más fácil y rápida para WebSockets.

### 2.1 Crear cuenta y proyecto

1. Ve a [railway.app](https://railway.app) y crea cuenta con GitHub
2. Click **"New Project"**
3. Selecciona **"Deploy from GitHub repo"**
4. Autoriza Railway y selecciona tu repositorio `domino-server`

### 2.2 Configurar variables de entorno

En el dashboard de Railway:

1. Click en tu servicio
2. Ve a la pestaña **"Variables"**
3. Añade estas variables:

```env
NODE_ENV=production
CORS_ORIGINS=https://tu-app.vercel.app
FIREBASE_PROJECT_ID=domino-online-4cc5f
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@domino-online-4cc5f.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQ...(tu key completa)...\n-----END PRIVATE KEY-----\n
```

⚠️ **IMPORTANTE para FIREBASE_PRIVATE_KEY:**
- Copia la private_key del JSON incluyendo `-----BEGIN...` y `...END-----`
- Reemplaza los saltos de línea reales por `\n`
- NO uses comillas en Railway

### 2.3 Configurar dominio

1. Ve a **"Settings"** → **"Networking"**
2. Click **"Generate Domain"**
3. Obtendrás una URL como: `domino-server-production.up.railway.app`

### 2.4 Verificar despliegue

```bash
curl https://domino-server-production.up.railway.app/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "env": "production",
  "players": 0,
  "games": 0
}
```

---

## 3. Render

### 3.1 Crear cuenta y servicio

1. Ve a [render.com](https://render.com) y crea cuenta
2. Click **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Configura:
   - **Name:** `domino-server`
   - **Region:** Oregon (o el más cercano)
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node src/index.js`

### 3.2 Variables de entorno

En **"Environment"** añade:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | `https://tu-app.vercel.app` |
| `FIREBASE_PROJECT_ID` | `domino-online-4cc5f` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-...` |
| `FIREBASE_PRIVATE_KEY` | (tu private key) |

### 3.3 Plan recomendado

- **Starter ($7/mes):** Suficiente para empezar
- El plan gratuito tiene "spin down" que causa latencia inicial

### 3.4 URL del servidor

Render te dará una URL como:
`https://domino-server.onrender.com`

---

## 4. DigitalOcean

Para más control y escalabilidad.

### 4.1 App Platform (Fácil)

1. Ve a [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. **Create App** → Conecta GitHub
3. Selecciona tu repositorio
4. Configura:
   - **Type:** Web Service
   - **Run Command:** `node src/index.js`
   - **HTTP Port:** 3001

### 4.2 Droplet con Docker (Avanzado)

```bash
# Crear droplet Ubuntu 22.04
# SSH al servidor

# Instalar Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Clonar repo
git clone https://github.com/tu-usuario/domino-server.git
cd domino-server

# Crear archivo .env
nano .env
# (pegar variables de entorno)

# Construir y ejecutar
docker build -t domino-server .
docker run -d \
  --name domino \
  --env-file .env \
  -p 3001:3001 \
  --restart unless-stopped \
  domino-server

# Verificar
docker logs domino
curl http://localhost:3001/health
```

### 4.3 Configurar Nginx (para SSL)

```nginx
# /etc/nginx/sites-available/domino
server {
    listen 80;
    server_name api.tudominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.tudominio.com;

    ssl_certificate /etc/letsencrypt/live/api.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.tudominio.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket timeout
        proxy_read_timeout 86400;
    }
}
```

```bash
# Activar sitio y SSL
sudo ln -s /etc/nginx/sites-available/domino /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.tudominio.com
sudo systemctl restart nginx
```

---

## 5. Cliente

### 5.1 Actualizar variables de entorno

En tu proyecto del cliente (Vercel, Netlify, etc.):

```env
# .env.production
VITE_SERVER_URL=https://domino-server-production.up.railway.app
```

### 5.2 Desplegar cliente en Vercel

```bash
cd domino-app
vercel --prod
```

O conecta el repo en [vercel.com](https://vercel.com):

1. **New Project** → Importar desde GitHub
2. **Environment Variables:**
   - `VITE_SERVER_URL` = `https://tu-servidor.railway.app`
3. **Deploy**

### 5.3 Actualizar CORS en el servidor

Una vez tengas la URL del cliente, actualiza `CORS_ORIGINS` en el servidor:

```env
CORS_ORIGINS=https://domino-app.vercel.app,https://tudominio.com
```

---

## 6. Verificación

### 6.1 Probar API REST

```bash
# Health check
curl https://tu-servidor.railway.app/health

# Stats
curl https://tu-servidor.railway.app/api/stats

# Leaderboard
curl https://tu-servidor.railway.app/api/leaderboard
```

### 6.2 Probar WebSocket

Abre la consola del navegador en tu cliente:

```javascript
const socket = io('https://tu-servidor.railway.app');

socket.on('connect', () => {
  console.log('✅ Conectado:', socket.id);
});

socket.on('connected', (data) => {
  console.log('👤 Usuario:', data.user);
});
```

### 6.3 Checklist de verificación

- [ ] `/health` responde con `status: ok`
- [ ] WebSocket conecta sin errores CORS
- [ ] Login con Firebase funciona
- [ ] Matchmaking añade a la cola
- [ ] Con 4 jugadores se forma partida
- [ ] Juego funciona en tiempo real
- [ ] Ratings se actualizan en Firestore

---

## 7. Monitoreo

### 7.1 Logs

**Railway:**
```bash
railway logs
```

**Render:**
Ver en el dashboard → Logs

**DigitalOcean/Docker:**
```bash
docker logs -f domino
```

### 7.2 Métricas importantes

Monitorear en el dashboard de tu proveedor:

- **CPU/Memory:** < 80% normal
- **Response time:** < 100ms para API, < 50ms para WebSocket
- **Active connections:** Depende de tu plan
- **Error rate:** < 1%

### 7.3 Alertas recomendadas

Configurar alertas para:
- Servidor caído (health check falla)
- CPU > 90%
- Memory > 90%
- Error rate > 5%

---

## Resumen de URLs

| Servicio | URL Producción |
|----------|----------------|
| Servidor API | `https://domino-server.railway.app` |
| WebSocket | `wss://domino-server.railway.app` |
| Cliente Web | `https://domino-app.vercel.app` |
| Firebase Console | `console.firebase.google.com` |

---

## Troubleshooting

### Error: CORS bloqueado
- Verificar que `CORS_ORIGINS` incluye exactamente la URL del cliente
- Sin `/` al final de la URL

### Error: WebSocket no conecta
- Verificar que el servidor permite `wss://`
- Railway y Render manejan SSL automáticamente

### Error: Firebase Admin
- Verificar que `FIREBASE_PRIVATE_KEY` tiene los `\n` correctos
- Verificar que el service account tiene permisos

### Servidor lento al inicio
- Normal en planes gratuitos (cold start)
- Usar plan de pago para servidores "always on"
