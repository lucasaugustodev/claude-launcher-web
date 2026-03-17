# Claude Launcher Web

Interface web para gerenciar e lancar sessoes do Claude Code via browser, com terminal interativo em tempo real e **Mission Control** integrado para orquestracao de agentes.

## Arquitetura

```
Browser (xterm.js)  <--WebSocket-->  server.js (Express + WS)  <--node-pty-->  Claude Code CLI
                                         |
                                    Mission Control (Next.js :4000)
                                         |
                                    SQLite + SSE + Workflow Engine
```

**Stack:**
- **Launcher (porta 3002):** Node.js, Express, WebSocket (`ws`), `node-pty`, xterm.js
- **Mission Control (porta 4000):** Next.js 14, React 18, SQLite (better-sqlite3), Zustand, TailwindCSS
- **Integracao:** MC hooks nativos do Claude Code, WebSocket compartilhado, iframe embedding

## Requisitos

- **Node.js** >= 18
- **npm** >= 9
- **Claude Code CLI** instalado (`npm install -g @anthropic-ai/claude-code`)
- **Windows** 10/11 (usa ConPTY via node-pty) ou **Linux/macOS**

## Instalacao

```bash
# 1. Clone o repositorio
git clone https://github.com/lucasaugustodev/claude-launcher-web.git
cd claude-launcher-web

# 2. Instale dependencias do Launcher
npm install

# 3. Instale dependencias do Mission Control
cd mission-control
npm install
cd ..
```

## Executando

### Opcao 1: Tudo junto (recomendado)

```bash
# Terminal 1 - Launcher (porta 3002)
node server.js

# Terminal 2 - Mission Control (porta 4000)
cd mission-control && npx next dev -p 4000
```

### Opcao 2: Apenas o Launcher

```bash
node server.js
# Acesse http://localhost:3002
```

O Mission Control aparece como aba no menu lateral do Launcher. Se nao estiver rodando, mostra instrucoes para iniciar.

### Opcao 3: Script rapido

```bash
# Linux/macOS
node server.js & (cd mission-control && npx next dev -p 4000) &

# Windows (PowerShell)
Start-Process node -ArgumentList "server.js"
Start-Process npx -ArgumentList "next dev -p 4000" -WorkingDirectory "mission-control"
```

## Funcionalidades

### Launcher (porta 3002)
- **Projetos** - Perfis de workspace para lancar sessoes Claude Code
- **Terminal interativo** - xterm.js com WebSocket, Ctrl+C/V, resize
- **Chat view** - Visualizacao estruturada de sessoes stream-json
- **Toggle Chat/Terminal** - Alterna entre visao terminal (TUI) e chat
- **Sessoes ativas** - Listar, abrir, parar sessoes em tempo real
- **Historico** - Replay de sessoes anteriores
- **Agendamentos** - Cron jobs para tarefas automaticas
- **Skills** - Gerenciamento de skills do Claude Code
- **Agentes** - Perfis de agentes customizados

### Mission Control (porta 4000)
- **Workflow Engine** - Pipeline Builder -> Tester -> Reviewer com auto-handoff
- **Agentes** - Gerenciamento com status, roles, soul_md (personalidade)
- **Terminal por task** - Aba Terminal no modal de task com xterm.js conectado ao agente
- **Activities** - Log estruturado de acoes (hooks nativos do Claude Code)
- **Deliverables** - Tracking de arquivos criados
- **Launcher integration** - Import de agentes do launcher, dispatch via PTY
- **Fail-loopback** - Reenvio automatico para estagio anterior em caso de falha
- **Dynamic agent routing** - Atribuicao automatica de agentes por role

### Integracao Launcher + Mission Control
- MC embutido como iframe no launcher (aba Mission Control)
- Sessoes PTY do launcher vissiveis na tab Terminal do MC
- Hooks nativos (PostToolUse, Stop, SessionEnd) para tracking
- Agentes do launcher importaveis para workflows do MC
- Soul MD injetado via `--append-system-prompt`

## Estrutura de Arquivos

```
claude-launcher-web/
├── server.js              # Express server, REST API, WebSocket handler
├── pty-manager.js         # Spawn/gerenciamento de PTY, output capture
├── storage.js             # Persistencia JSON em data/
├── scheduler.js           # Cron job scheduler
├── stream-analyzer.js     # Parser de output para chat view
├── github-sync.js         # Integracao GitHub (clone, branch, PR)
├── whatsapp-kapso.js      # Integracao WhatsApp via Kapso
├── public/
│   ├── index.html         # SPA shell
│   ├── css/               # Estilos (Catppuccin Mocha theme)
│   └── js/
│       ├── api.js         # WebSocket client + REST API
│       ├── terminal.js    # xterm.js terminal manager
│       ├── chat-view.js   # Chat view (stream-json parser)
│       ├── app.js         # Router, pages, components (Preact)
│       └── floating-chat.js
├── data/
│   ├── profiles.json      # Perfis de workspace
│   ├── sessions.json      # Historico de sessoes
│   └── outputs/           # Output bruto (.raw)
│
└── mission-control/       # Mission Control (Next.js)
    ├── src/
    │   ├── app/           # Next.js App Router (API routes + pages)
    │   ├── components/    # React components (TaskModal, TerminalTab, etc.)
    │   ├── hooks/         # Custom hooks (useSSE, etc.)
    │   └── lib/           # Core logic
    │       ├── db/        # SQLite schema + migrations
    │       ├── claude-launcher/  # Launcher HTTP client
    │       ├── workflow-engine.ts
    │       ├── task-governance.ts
    │       └── store.ts   # Zustand state
    ├── data/              # SQLite database + backups
    ├── next.config.mjs
    └── package.json
```

## Variaveis de Ambiente

| Variavel | Default | Descricao |
|----------|---------|-----------|
| `PORT` | `3002` | Porta do Launcher |
| `CLAUDE_LAUNCHER_URL` | `http://localhost:3002` | URL do launcher (usado pelo MC) |
| `MISSION_CONTROL_URL` | `http://localhost:4000` | URL do MC (usado pelos hooks) |
| `MC_API_TOKEN` | _(vazio = sem auth)_ | Token de autenticacao da API do MC |

## Desenvolvimento

```bash
# Launcher (auto-reload nao disponivel, reinicie manualmente)
node server.js

# Mission Control (hot reload via Next.js)
cd mission-control && npx next dev -p 4000

# Build de producao do MC
cd mission-control && npm run build && npm start
```

## Docker

```bash
# Launcher
docker build -t claude-launcher .
docker run -p 3002:3002 claude-launcher

# Mission Control
cd mission-control
docker build -t mission-control .
docker run -p 4000:4000 mission-control
```

## License

MIT
