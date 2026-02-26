# Claude Launcher Web

Interface web para gerenciar e lançar sessões do Claude Code via browser, com terminal interativo em tempo real.

## Arquitetura

```
Browser (xterm.js)  <──WebSocket──>  server.js (Express + WS)  <──node-pty──>  node cli.js (Claude Code)
```

**Stack:**
- **Backend:** Node.js, Express, WebSocket (`ws`), `node-pty` (ConPTY no Windows)
- **Frontend:** Vanilla JS, xterm.js (CDN), CSS Catppuccin Mocha theme
- **Persistência:** JSON files em `data/` (profiles.json, sessions.json, outputs/*.raw)

### Estrutura de Arquivos

```
claude-launcher-web/
├── server.js          # Express server, REST API, WebSocket handler
├── pty-manager.js     # Spawn/gerenciamento de PTY, output capture, resume
├── storage.js         # Leitura/escrita JSON em data/
├── package.json
├── data/
│   ├── profiles.json  # Perfis salvos
│   ├── sessions.json  # Histórico de sessões
│   ├── users.json     # Usuários cadastrados (hash + salt)
│   └── outputs/       # Output bruto de cada sessão (.raw)
└── public/
    ├── index.html     # SPA shell
    ├── css/style.css   # Catppuccin Mocha dark theme
    └── js/
        ├── api.js      # Cliente HTTP + WebSocket
        ├── terminal.js # TerminalManager (xterm.js live + read-only)
        ├── components.js # Renderização de páginas (perfis, ativas, histórico)
        └── app.js      # Router SPA, auth, init
```

## Setup e Execução

```bash
# Instalar dependências (inclui @anthropic-ai/claude-code localmente)
npm install

# Iniciar servidor
npm start
# ou
node server.js
```

Acessa em `http://localhost:3001` — no primeiro acesso, o app exibe uma tela de criação de conta (usuario + senha). Após isso, login com as credenciais criadas.

### Variáveis de Ambiente

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | 3001 | Porta do servidor |

### Windows: Git Bash

Claude Code no Windows requer `git-bash`. Se Git estiver instalado mas não no PATH, defina:

```
CLAUDE_CODE_GIT_BASH_PATH=C:\Program Files\Git\bin\bash.exe
```

O `pty-manager.js` detecta e seta isso automaticamente se o Git estiver em `C:\Program Files\Git`.

### Tunnel Externo (Cloudflare)

Para acessar de fora da rede local:

```bash
npx cloudflared tunnel --url http://localhost:3001
```

## Funcionalidades

### Perfis
- Criar/editar/excluir perfis com: nome, diretório de trabalho, modo (Normal/Bypass), prompt inicial, Node memory
- Lançar sessões a partir de um perfil com um clique

### Sessões Ativas
- Ver todas as sessões rodando com PID, tempo decorrido
- Abrir terminal interativo (xterm.js) com I/O bidirecional via WebSocket
- Parar sessões individualmente

### Histórico
- Tabela com todas as sessões (completadas, crashadas, paradas)
- Filtros por status com contagem
- **Ver Output:** Abre terminal read-only com o output salvo da sessão
- **Retomar (Resume):** Relança sessão crashada/parada com `--continue` no mesmo diretório

## Decisões Técnicas e Lições Aprendidas

### 1. Node.js CLI em vez de claude.exe (Bun)

O executável global `claude.exe` (instalado via WinGet) é empacotado com **Bun v1.3.10**, que apresenta crash com "Illegal instruction" (panic) nesta máquina Windows:

```
Bun v1.3.10 - panic(main thread): Illegal instruction at address 0x7FF64320DE26
```

**Solução:** Usar `node.exe` + `node_modules/@anthropic-ai/claude-code/cli.js` diretamente, evitando o Bun completamente. O `pty-manager.js` resolve o caminho absoluto de ambos na inicialização:

```js
const LOCAL_CLI = path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
const NODE_EXE = findNodeExe(); // C:\Program Files\nodejs\node.exe
```

### 2. Variáveis de Ambiente para Evitar "Nested Session"

O Claude Code detecta se está rodando dentro de outra instância via env vars. Como o server.js roda dentro do Claude Code (quando desenvolvendo), é necessário limpar essas variáveis:

```js
delete env.CLAUDECODE;
delete env.CLAUDE_CODE_ENTRYPOINT;
delete env.CLAUDE_CODE_TEAMMATE_COMMAND;
```

Também setamos `TERM=xterm-256color` e `FORCE_COLOR=1` para rendering correto do TUI.

### 3. Resume com `--continue` (não prompt)

A primeira abordagem de resume passava o log do output antigo como prompt inicial (igual ao launcher desktop Tauri). Isso causava o Claude Code exibir o diálogo interativo de **workspace trust** ("Quick safety check: Is this a project you created?"), ficando preso sem resposta automática.

**Solução:** Usar a flag `--continue` do Claude Code, que retoma a última conversa no diretório de trabalho sem precisar de prompt. Evita o trust dialog e restaura o contexto corretamente.

```js
const flags = ['--continue'];
if (mode === 'bypass') flags.push('--dangerously-skip-permissions');
```

### 4. Output Persistence

Output de cada sessão é salvo em tempo real via `fs.appendFileSync` para `data/outputs/{sessionId}.raw`. Isso permite visualizar output mesmo de sessões já finalizadas. Buffer em memória limitado a 500KB com sliding window.

### 5. ANSI no Histórico

O output salvo contém sequências ANSI brutas (cursor positioning, screen clears, cores). Para replay no xterm.js read-only, o output é escrito em **chunks de 4KB com delay de 5ms** entre cada, permitindo que o xterm.js processe as escape sequences corretamente em vez de travar com um blob gigante.

### 6. Git Bash no Windows (CLAUDE_CODE_GIT_BASH_PATH)

Claude Code no Windows exige `git-bash` para funcionar. Se não encontrar, a sessão termina com código 1:

```
Claude Code on Windows requires git-bash
```

**Solução:** O `buildClaudeEnv()` em `pty-manager.js` detecta automaticamente e seta `CLAUDE_CODE_GIT_BASH_PATH`:

```js
if (process.platform === 'win32' && !env.CLAUDE_CODE_GIT_BASH_PATH) {
  const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
  if (fs.existsSync(gitBashPath)) env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
}
```

**Nota sobre provisioning remoto (WinRM):** O installer EXE do Git (Inno Setup) falha com "Access Denied" quando executado via WinRM. A solução é usar **PortableGit** (7z self-extracting) que apenas extrai arquivos sem precisar de instalador.

### 7. WebSocket Bidirecional

O terminal web funciona com WebSocket full-duplex:
- **Server -> Client:** output do PTY em tempo real + evento de exit
- **Client -> Server:** input do teclado + resize do terminal
- Ao abrir um terminal, o servidor envia primeiro todo o output acumulado (catch-up), depois streams em tempo real
- Cada WebSocket pode estar "attached" a múltiplas sessões simultaneamente

## Autenticação

Sistema token-based com setup no primeiro acesso:

1. **Primeiro acesso** (`needsSetup: true`): tela de criação de conta (usuario + senha)
2. **Login**: retorna Bearer token (24h de validade)
3. **Rotas protegidas**: requerem `Authorization: Bearer <token>`
4. **Senhas**: PBKDF2 com salt aleatório, salvas em `data/users.json`

### Rotas públicas (sem auth)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Status do servidor |
| GET | `/api/auth/status` | `{needsSetup, loggedIn}` |
| POST | `/api/auth/setup` | Criar primeiro usuário |
| POST | `/api/auth/login` | Login → `{token}` |

### Rotas protegidas (Bearer token)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/logout` | Invalidar token |
| GET | `/api/profiles` | Listar perfis |
| POST | `/api/profiles` | Criar perfil |
| PUT | `/api/profiles/:id` | Atualizar perfil |
| DELETE | `/api/profiles/:id` | Excluir perfil |
| GET | `/api/sessions` | Sessões ativas |
| GET | `/api/sessions/history` | Histórico completo |
| POST | `/api/sessions/launch` | Lançar sessão `{profileId}` |
| POST | `/api/sessions/:id/stop` | Parar sessão |
| GET | `/api/sessions/:id/output` | Output salvo da sessão |
| POST | `/api/sessions/:id/resume` | Retomar sessão com `--continue` |
| DELETE | `/api/sessions/history` | Limpar histórico |

## WebSocket (`/ws`)

Auth via query param: `/ws?token=<bearer_token>`

**Mensagens Client -> Server:**
```json
{ "type": "attach", "sessionId": "..." }
{ "type": "detach", "sessionId": "..." }
{ "type": "input", "sessionId": "...", "data": "texto" }
{ "type": "resize", "sessionId": "...", "cols": 120, "rows": 30 }
```

**Mensagens Server -> Client:**
```json
{ "type": "output", "sessionId": "...", "data": "..." }
{ "type": "exit", "sessionId": "...", "exitCode": 0 }
```

## Comparação com o Launcher Desktop (Tauri)

| Feature | Desktop (Tauri) | Web |
|---|---|---|
| Runtime | Rust + portable-pty | Node.js + node-pty |
| Claude spawn | `cmd.exe /c claude` (Bun) | `node cli.js` (Node.js) |
| Frontend | React + xterm.js | Vanilla JS + xterm.js |
| Acesso remoto | Não | Sim (HTTP/WS + tunnel) |
| Resume | Prompt com log file | `--continue` flag |
| Output save | `.log` em AppData | `.raw` em `data/outputs/` |
| Auth | Nenhum (local) | Token-based (setup no 1º acesso) |
