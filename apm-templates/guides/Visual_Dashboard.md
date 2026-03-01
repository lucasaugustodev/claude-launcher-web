# APM 0.5.4 - Guia do Dashboard Visual

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como o Manager Agent deve criar e manter um dashboard visual em HTML para acompanhamento do projeto. O dashboard é a interface visual principal do usuário para monitorar o progresso do projeto em tempo real.

---

## 1. Visão Geral

O Manager Agent é responsável por gerar e manter um arquivo `dashboard.html` na **raiz do projeto**. Este arquivo deve ser um HTML standalone (autossuficiente), sem dependências externas, que o usuário pode abrir diretamente no navegador para visualizar o estado completo do projeto.

### Princípios

- **Arquivo único**: Todo CSS e JS devem ser inline — nenhuma dependência externa (CDN, fontes externas, frameworks)
- **Sempre atualizado**: O dashboard deve refletir o estado mais recente do projeto
- **Acessível**: O usuário deve poder abrir o `dashboard.html` diretamente no navegador com um duplo clique
- **Responsivo**: Deve funcionar bem em qualquer tamanho de tela

---

## 2. Gatilhos de Atualização — OBRIGATÓRIO

O Manager Agent **DEVE** regenerar o `dashboard.html` sempre que qualquer um destes eventos ocorrer:

| Evento | Descrição |
|--------|-----------|
| **Mudança de status de tarefa** | Qualquer tarefa mudar de pendente → em progresso → concluída → erro/bloqueada |
| **Conclusão de fase** | Uma fase inteira for concluída e o resumo for escrito no Memory Root |
| **Handover** | Um handover de Manager ou Implementation Agent acontecer |
| **Modificação do Implementation Plan** | Novas tarefas adicionadas, tarefas removidas, dependências alteradas, agentes reatribuídos |
| **Início de nova fase** | Uma nova fase começar a ser executada |
| **Bloqueio ou erro crítico** | Uma tarefa for bloqueada ou um erro crítico for identificado |

**Regra**: Ao final de cada ciclo do Task Loop (após revisar o Memory Log e decidir a próxima ação), o Manager Agent DEVE verificar se o dashboard precisa de atualização e atualizá-lo se necessário.

---

## 3. Conteúdo do Dashboard

### 3.1. Header — Informações do Projeto

```
- Nome do projeto (extraído do Implementation Plan)
- Descrição/resumo do projeto (do Memory Root ou Implementation Plan)
- Data de início do projeto
- Última atualização (timestamp)
- Manager Agent atual (ex: Manager Agent 1, Manager Agent 2...)
```

### 3.2. Barra de Progresso Geral

Uma barra de progresso visual mostrando a porcentagem de tarefas concluídas em relação ao total:

```
Progresso Geral: ████████████░░░░░░░░ 60% (12/20 tarefas)
```

- Calcular: `(tarefas concluídas / total de tarefas) * 100`
- Exibir números absolutos ao lado da porcentagem
- Cor da barra muda conforme progresso:
  - 0-25%: vermelho `#da3633`
  - 26-50%: laranja `#d29922`
  - 51-75%: amarelo `#e3b341`
  - 76-100%: verde `#238636`

### 3.3. Visão por Fases — Cards de Tarefas

Cada fase do projeto deve ser exibida como uma seção com suas tarefas em formato de cards visuais:

```
## Fase 1: Setup e Configuração [3/3 ✓]
## Fase 2: Implementação Core [2/5 ▶]
## Fase 3: Testes e Deploy [0/4 ○]
```

#### Card de Tarefa — Campos Obrigatórios

Cada tarefa deve ser exibida como um card contendo:

| Campo | Descrição |
|-------|-----------|
| **Nome** | Título da tarefa (ex: "Task 2.3 - API User Endpoint") |
| **Status** | Indicador visual colorido (ver seção 4) |
| **Agente** | Nome do agente responsável (ex: "Agent_Backend") como badge |
| **Tipo** | Single-step ou Multi-step |
| **Dependências** | Lista de tarefas das quais depende (se houver) |
| **Última atualização** | Data/hora da última mudança de status |
| **Notas** | Resumo breve do resultado ou problema (quando aplicável) |

#### Status das Tarefas — Indicadores Visuais

| Status | Cor | Ícone | Badge |
|--------|-----|-------|-------|
| Pendente | Cinza `#484f58` | ○ | `Pendente` |
| Em Progresso | Azul `#1f6feb` | ▶ | `Em Progresso` |
| Concluída | Verde `#238636` | ✓ | `Concluída` |
| Bloqueada | Vermelho `#da3633` | ✕ | `Bloqueada` |
| Erro | Amarelo `#d29922` | ⚠ | `Erro` |

### 3.4. Seção de Últimas Atividades

Um log cronológico das **últimas 10 ações** realizadas no projeto, exibido como uma timeline:

```
[14:30] ✓ Task 2.3 concluída por Agent_Backend
[14:15] ▶ Task 2.4 iniciada por Agent_Frontend
[13:50] ✓ Task 2.2 concluída por Agent_Backend
[13:30] ⚠ Task 2.1 encontrou erro - redelegada
[12:00] 📋 Fase 1 concluída - resumo adicionado ao Memory Root
```

Cada entrada deve conter:
- Timestamp
- Ícone de status
- Descrição breve da ação
- Agente envolvido (se aplicável)

### 3.5. Seção de Próximos Passos

Lista priorizada das próximas ações planejadas:

```
1. [Próximo] Task 2.4 - Integração Frontend → Agent_Frontend
2. [Aguardando] Task 2.5 - Testes E2E → Agent_Testing (depende de 2.4)
3. [Planejado] Fase 3 - Deploy e Documentação
```

Incluir:
- Próxima tarefa a ser atribuída
- Tarefas bloqueadas aguardando dependências
- Próxima fase (se a atual estiver perto de concluir)
- Handovers previstos (se o contexto estiver chegando ao limite)

---

## 4. Estilo Visual — Especificação

### Paleta de Cores (Dark Theme)

```css
/* Fundo principal */
--bg-primary: #0d1117;
--bg-secondary: #161b22;
--bg-tertiary: #21262d;

/* Bordas */
--border-default: #30363d;
--border-muted: #21262d;

/* Texto */
--text-primary: #e6edf3;
--text-secondary: #8b949e;
--text-muted: #484f58;

/* Status */
--color-success: #238636;
--color-warning: #d29922;
--color-danger: #da3633;
--color-info: #1f6feb;
--color-neutral: #484f58;

/* Acentos */
--color-accent: #58a6ff;
--color-accent-emphasis: #1f6feb;
```

### Tipografia

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
```

- Título do projeto: `24px`, bold, `--text-primary`
- Títulos de seção: `18px`, semi-bold, `--text-primary`
- Títulos de fase: `16px`, semi-bold, `--text-primary`
- Texto de card: `14px`, regular, `--text-primary`
- Labels e metadados: `12px`, regular, `--text-secondary`
- Timestamps: `12px`, monospace, `--text-muted`

### Layout

```css
/* Container principal */
max-width: 1200px;
margin: 0 auto;
padding: 24px;

/* Grid de cards */
display: grid;
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
gap: 16px;

/* Cards */
background: var(--bg-secondary);
border: 1px solid var(--border-default);
border-radius: 8px;
padding: 16px;

/* Badges de status */
border-radius: 16px;
padding: 2px 10px;
font-size: 12px;
font-weight: 500;
```

### Elementos Interativos (JS Inline)

- **Filtro por status**: Botões para filtrar tarefas por status (Todas / Pendentes / Em Progresso / Concluídas / Bloqueadas)
- **Colapsar/expandir fases**: Clicar no header da fase mostra/esconde as tarefas
- **Tooltip nos cards**: Hover mostra detalhes adicionais (dependências, notas)
- **Auto-refresh timestamp**: Exibir "Atualizado há X minutos" com cálculo dinâmico

---

## 5. Estrutura HTML de Referência

O Manager Agent deve gerar o HTML seguindo esta estrutura base:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Nome do Projeto] - Dashboard APM</title>
    <style>
        /* Todas as variáveis CSS e estilos inline aqui */
        /* Seguir a paleta e especificações da seção 4 */
    </style>
</head>
<body>
    <!-- Header do Projeto -->
    <header>
        <h1>[Nome do Projeto]</h1>
        <p>[Descrição do projeto]</p>
        <div class="meta">
            <span>Última atualização: [timestamp]</span>
            <span>Manager: [Manager Agent N]</span>
        </div>
    </header>

    <!-- Barra de Progresso Geral -->
    <section class="progress-section">
        <h2>Progresso Geral</h2>
        <div class="progress-bar">
            <div class="progress-fill" style="width: [X]%"></div>
        </div>
        <span>[X]% — [N] de [M] tarefas concluídas</span>
    </section>

    <!-- Filtros -->
    <section class="filters">
        <button class="active" data-filter="all">Todas</button>
        <button data-filter="pending">Pendentes</button>
        <button data-filter="in-progress">Em Progresso</button>
        <button data-filter="completed">Concluídas</button>
        <button data-filter="blocked">Bloqueadas</button>
    </section>

    <!-- Fases e Tarefas -->
    <section class="phases">
        <!-- Repetir para cada fase -->
        <div class="phase">
            <div class="phase-header" onclick="togglePhase(this)">
                <h2>Fase [N]: [Nome] <span class="phase-progress">[X/Y]</span></h2>
            </div>
            <div class="phase-tasks">
                <!-- Repetir para cada tarefa -->
                <div class="task-card" data-status="[status]">
                    <div class="task-header">
                        <span class="task-title">Task [N.M] - [Título]</span>
                        <span class="status-badge [status]">[Status]</span>
                    </div>
                    <div class="task-meta">
                        <span class="agent-badge">[Agent_Name]</span>
                        <span class="task-type">[Single/Multi-step]</span>
                    </div>
                    <div class="task-deps">[Dependências]</div>
                    <div class="task-updated">Atualizado: [timestamp]</div>
                    <div class="task-notes">[Notas/Resumo]</div>
                </div>
            </div>
        </div>
    </section>

    <!-- Últimas Atividades -->
    <section class="activity-log">
        <h2>Últimas Atividades</h2>
        <ul class="timeline">
            <!-- Últimas 10 ações -->
            <li>
                <span class="time">[HH:MM]</span>
                <span class="icon">[ícone]</span>
                <span class="desc">[Descrição da ação]</span>
            </li>
        </ul>
    </section>

    <!-- Próximos Passos -->
    <section class="next-steps">
        <h2>Próximos Passos</h2>
        <ol>
            <li>[Próxima ação planejada]</li>
        </ol>
    </section>

    <script>
        /* JS inline para filtros, colapsar fases, tooltips */
        /* Seguir especificações da seção 4 */
    </script>
</body>
</html>
```

---

## 6. Fluxo de Atualização do Manager Agent

Quando um gatilho de atualização ocorrer (seção 2), o Manager Agent deve:

1. **Ler o Implementation Plan atual** para obter a lista completa de fases e tarefas
2. **Ler os Memory Logs recentes** para obter status atualizado das tarefas
3. **Ler o Memory Root** para informações do projeto e resumos de fases
4. **Compilar os dados** em estrutura para o dashboard:
   - Calcular progresso geral e por fase
   - Montar lista de atividades recentes
   - Identificar próximos passos
5. **Gerar o HTML completo** seguindo a estrutura da seção 5
6. **Escrever o arquivo** `dashboard.html` na raiz do projeto (sobrescrevendo a versão anterior)

### Dados a Extrair por Fonte

| Fonte | Dados |
|-------|-------|
| **Implementation Plan** | Nome do projeto, fases, tarefas, agentes, dependências, tipos (single/multi-step) |
| **Memory Logs** | Status das tarefas, resultados, erros, timestamps de conclusão |
| **Memory Root** | Descrição do projeto, resumos de fases concluídas |
| **Contexto da sessão** | Manager Agent atual, últimas ações realizadas, próximos passos planejados |

---

## 7. Regras de Qualidade

1. **Nunca gere HTML inválido** — valide que tags estão fechadas e a estrutura está correta
2. **Nunca perca dados** — sempre leia o estado atual antes de regenerar
3. **Mantenha consistência** — os dados no dashboard devem corresponder exatamente ao Implementation Plan e Memory Logs
4. **Performance** — o HTML deve carregar instantaneamente (arquivo leve, sem assets externos)
5. **Acessibilidade** — use atributos `aria-label` nos elementos interativos e contraste adequado nas cores
6. **Encoding** — sempre use UTF-8 para suporte correto a caracteres em português

---

**Fim do Guia**
