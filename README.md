# FiveM Map Forge

Gerador de mapas para FiveM com fluxo **texto → SceneSpec → preview 3D → Blender → Sollumz → resource FiveM**.

## O que já existe

- Campo de prompt em português natural.
- Planejador que transforma a descrição em uma cena tipada.
- Preview 3D navegável com React Three Fiber.
- Métricas estimadas de entidades e draw calls.
- Download da SceneSpec em JSON.
- Worker HTTP separado para processamento pesado.
- Blender headless criando a cena a partir da SceneSpec.
- Conversão dos meshes para Drawables pelo Sollumz.
- Criação de YMAP e grupo de entidades.
- Tentativa de cálculo automático de extents.
- Exportação de assets RAGE via Sollumz.
- Empacotamento automático em resource FiveM com `fxmanifest.lua`.
- Job assíncrono com estados `queued`, `exporting`, `ready` e `failed`.
- Download do ZIP final pela própria interface.

## Arquitetura

```text
Browser / Next.js
      |
      | prompt
      v
Scene Planner
      |
      v
SceneSpec JSON -----> React Three Fiber preview
      |
      | POST /api/export
      v
Worker FastAPI
      |
      v
Blender headless + Sollumz
      |
      v
YDR / YMAP / demais assets
      |
      v
FiveM resource ZIP
```

A aplicação web não executa Blender. O Blender/Sollumz roda em uma máquina ou container/VM próprio, porque esse processamento é pesado e não combina com runtime serverless.

## Web

Requisitos:

- Node.js moderno
- npm/pnpm

```bash
npm install
cp .env.example .env.local
npm run dev
```

Variável obrigatória para exportação:

```env
MAP_FORGE_WORKER_URL=http://127.0.0.1:8787
```

Sem o worker configurado, geração e preview continuam funcionando; somente o ZIP FiveM fica indisponível.

## Worker Blender + Sollumz

Requisitos:

1. Blender instalado.
2. Sollumz instalado e habilitado nessa instalação do Blender.
3. Python para executar o servidor FastAPI.

```bash
cd worker
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

Defina o executável do Blender quando ele não estiver no PATH:

```bash
# Windows PowerShell
$env:BLENDER_BIN="C:\Program Files\Blender Foundation\Blender\blender.exe"

# Linux/macOS
export BLENDER_BIN=/usr/bin/blender
```

Suba o worker:

```bash
uvicorn server:app --host 0.0.0.0 --port 8787
```

Health check:

```text
GET /health
```

## Exportação manual

Também é possível testar sem a interface:

```bash
blender --background --python worker/export_scene.py -- minha-cena.scene.json ./output
```

O script cria o `.blend`, pede ao Sollumz para exportar os assets e monta:

```text
output/
  fivem_resource/
    fxmanifest.lua
    scene.json
    stream/
      *.ydr
      *.ymap
      *.ybn
      *.ytd
      *.ytyp
```

A lista exata de arquivos depende da cena e das opções/recursos disponíveis na instalação atual do Sollumz.

## SceneSpec

A `SceneSpec` é o contrato entre web e worker. Cada objeto possui:

- posição
- rotação
- escala
- tipo lógico
- primitiva usada no preview
- material/cor
- colisão
- referência opcional a asset GTA

Isso permite trocar posteriormente o planner atual por um modelo de IA mais forte ou por um provider text-to-3D sem reescrever o preview e o worker.

## Próximas evoluções recomendadas

- Provider de IA para transformar prompts complexos em SceneSpec detalhada.
- Text-to-3D para props e construções realmente customizadas.
- Biblioteca de assets GTA V para reutilizar archetypes existentes antes de gerar mesh novo.
- Materiais e shaders GTA nativos.
- Geração automática de colisão YBN otimizada.
- LODs e `_hi` automáticos.
- Geração de YTYP para archetypes customizados.
- Editor visual para mover/rotacionar/remover entidades antes da exportação.
- Sistema de contas, créditos e histórico de mapas.
- Persistência dos jobs em PostgreSQL/Redis em vez de arquivos locais.
- Storage S3/R2 para ZIPs e previews.

## Observação importante

O Sollumz é a camada de autoria/exportação dos formatos do GTA V; ele não interpreta linguagem natural sozinho. Por isso o projeto mantém o planejamento da cena separado do worker de Blender/Sollumz.
