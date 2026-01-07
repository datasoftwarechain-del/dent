#!/bin/bash
set -euo pipefail

echo "==> Comprobando Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew no encontrado. Instalando..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

echo "==> Instalando Redis (si falta)..."
brew install redis || true

echo "==> Iniciando servicios con brew services..."
brew services start redis || true

echo "==> Escribiendo .env del proyecto..."
cat > .env <<ENV
SUPABASE_URL="https://<project>.supabase.co"
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
PUBLIC_SUPABASE_ANON_KEY=""
REDIS_URL="redis://localhost:6379"
ENV
if [ -f .gitignore ]; then
  grep -q '^\.env$' .gitignore || echo ".env" >> .gitignore
else
  echo ".env" > .gitignore
fi

echo "==> Listo. Configurá tus claves de Supabase y podés iniciar la app con: npm run dev"
