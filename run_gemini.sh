#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
npx -y @google/gemini-cli \
  -p "$(cat digitaldent_prompt.json)$'\n\nACCION_INMEDIATA: Acepta el plan y EJECUTA YA la Fase 1 sin pedir más aprobaciones: inicializa/ajusta el proyecto Astro existente, configura Tailwind, configura Supabase (variables de entorno), crea/actualiza archivos y corre los comandos necesarios. No pidas confirmación. Muestra solo los cambios y comandos ejecutados.'" \
  --approval-mode yolo \
  --yolo \
  --include-directories src \
  --output-format text \
| tee digitaldent_build.log
