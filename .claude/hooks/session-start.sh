#!/bin/bash
# Instala en cada sesión cloud las herramientas de desarrollo de videojuegos
# y las skills/CLIs externas. Los plugins se declaran en .claude/settings.json.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
log() { echo "[session-start] $*" >&2; }

# --- Paquetes del sistema (solo si faltan) ---
missing=()
command -v convert >/dev/null || missing+=(imagemagick)
command -v sox >/dev/null || missing+=(sox)
command -v blender >/dev/null || missing+=(blender)
command -v ffmpeg >/dev/null || missing+=(ffmpeg)
if [ ${#missing[@]} -gt 0 ]; then
  log "apt: ${missing[*]}"
  apt-get update -q >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${missing[@]}" >/dev/null
fi

# --- Godot 4.3 headless ---
if ! command -v godot >/dev/null; then
  log "Godot 4.3"
  tmp="$(mktemp -d)"
  curl -sSfL -o "$tmp/godot.zip" https://github.com/godotengine/godot/releases/download/4.3-stable/Godot_v4.3-stable_linux.x86_64.zip
  mkdir -p /opt/godot
  python3 -I -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall('/opt/godot')" "$tmp/godot.zip"
  chmod +x /opt/godot/Godot_v4.3-stable_linux.x86_64
  ln -sf /opt/godot/Godot_v4.3-stable_linux.x86_64 /usr/local/bin/godot
  rm -rf "$tmp"
fi

# --- Python: pygame, Pillow, numpy, graphify ---
if ! python3 -I -c "import pygame, PIL, numpy, graphify" >/dev/null 2>&1; then
  log "pip: pygame pillow numpy graphifyy"
  python3 -m pip install -q --root-user-action=ignore pygame pillow numpy graphifyy
fi
if [ ! -d "$HOME/.claude/skills/graphify" ]; then
  log "graphify skill"
  graphify install --platform claude >/dev/null
fi

# --- OmniRoute (solo el paquete; NO redirige Claude Code) ---
if ! command -v omniroute >/dev/null; then
  log "npm -g omniroute"
  npm install -g --silent omniroute >/dev/null
fi

# --- Agent skills de Vercel (globales para Claude Code) ---
if [ ! -d "$HOME/.claude/skills/vercel-react-best-practices" ]; then
  log "skills: vercel-labs/agent-skills"
  (cd "$(mktemp -d)" && npx -y skills add vercel-labs/agent-skills -g -a claude-code -y >/dev/null)
fi

# --- Dependencias del proyecto (solo si cambian) ---
if [ -f package.json ]; then
  hashes=node_modules/.session-start.sha256
  if ! sha256sum --check --status "$hashes" 2>/dev/null; then
    rm -f "$hashes"
    log "npm install"
    npm install --no-audit --no-fund --silent
    sha256sum .claude/hooks/session-start.sh package.json package-lock.json 2>/dev/null > "$hashes" || rm -f "$hashes"
  fi
fi
