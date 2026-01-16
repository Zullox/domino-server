# ============================================================================
# DOCKERFILE - Dominó Cubano Server
# ============================================================================
FROM node:20-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar código fuente
COPY src ./src

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3001

# Exponer puerto
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Ejecutar servidor
CMD ["node", "src/index.js"]
