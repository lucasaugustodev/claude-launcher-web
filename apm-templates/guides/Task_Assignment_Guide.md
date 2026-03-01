# APM 0.5.4 - Guia de Atribuição de Tarefas

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como os Manager Agents emitem atribuições de tarefas para Implementation Agents e avaliam sua conclusão. As atribuições de tarefas coordenam o trabalho dos agentes durante o Ciclo de Tarefas de uma sessão APM, seguindo o Plano de Implementação.

## 1. Visão Geral do Ciclo de Tarefas
Manager Agent emite Prompt de Atribuição de Tarefa → Usuário passa para Implementation Agent → Implementation Agent executa tarefa e registra trabalho → Usuário retorna registro ao Manager → Manager revisa e determina próxima ação (continuar, acompanhar, delegar ou atualizar plano).

## 2. Formato do Prompt de Atribuição de Tarefa
Os Prompts de Atribuição de Tarefa devem correlacionar 1-1 com as tarefas do Plano de Implementação e incluir todo o contexto necessário para execução bem-sucedida. O Manager Agent deve emitir estes prompts seguindo este formato:

### 2.1. Verificação de Dependências
Antes de criar qualquer Prompt de Atribuição de Tarefa, verifique as dependências da tarefa.

**Etapa 1: Identificar Dependências**
Verifique o campo `Guidance` da tarefa no Plano de Implementação para declarações de dependência:
- `"Depende de: Saída da Task X.Y"` = Dependência do mesmo agente
- `"Depende de: Saída da Task X.Y pelo Agent Z"` = **DEPENDÊNCIA ENTRE AGENTES**

**Etapa 2: Determinar Abordagem de Integração de Contexto**
- **Mesmo Agente** (sem tag "pelo Agent X") → Use **Referência Contextual Simples** (Seção 4.1)
- **Entre Agentes** (tem tag "pelo Agent X") → Use **Contexto de Integração Abrangente OBRIGATÓRIO** (Seção 4.2)

### **Aviso de Dependência Entre Agentes**
**CRÍTICO**: Dependências entre agentes requerem que os Implementation Agents completem etapas detalhadas de leitura de arquivo e integração ANTES de iniciar o trabalho principal da tarefa.

### 2.2. Solicitações de Explicação do Usuário
Quando Usuários solicitam explicações para tarefas complexas futuras, o Manager Agent deve incluir instruções detalhadas de explicação dentro da seção `## Instruções Detalhadas` do Prompt de Atribuição de Tarefa.

**Protocolo de Timing de Explicação**:
- **Tarefas de Etapa Única**: Forneça breve introdução da abordagem ANTES da execução, explicação detalhada APÓS a conclusão da tarefa
- **Tarefas de Múltiplas Etapas**: Aplique o mesmo padrão a cada etapa - breve introdução da abordagem ANTES da execução de cada etapa, explicação detalhada APÓS a conclusão de cada etapa

**Abordagem de Integração**: Adicione instruções de explicação como parte do fluxo de execução da tarefa, especificando:
- **Quais aspectos** precisam de explicação detalhada (abordagem técnica, justificativa de decisão, impacto arquitetural)
- **Escopo da explicação** para áreas técnicas complexas
- **Requisitos de timing** seguindo o protocolo acima

**Implementação**: Inclua instruções de explicação junto com instruções normais de tarefa na seção `## Instruções Detalhadas`. Use formatação clara para distinguir requisitos de explicação de requisitos de execução. **Inclua instruções de explicação apenas quando explicitamente solicitadas pelo Usuário.**

### 2.3. Estrutura do Prompt com Frontmatter YAML
Inclua seções opcionais apenas quando seu booleano no front-matter for true

```markdown
---
task_ref: "Task <m.n> - Título"
agent_assignment: "Agent_<Domínio>"
memory_log_path: "caminho/para/arquivo/de/registro"
execution_type: "single-step | multi-step"
dependency_context: true | false
ad_hoc_delegation: true | false
---

# Atribuição de Tarefa APM: [Título da Tarefa]

## Referência da Tarefa
Plano de Implementação: **Task X.Y - [Título]** atribuída a **[Agent_<Domínio>]**

## Contexto de Dependências
[Incluir apenas se dependency_context: true]
[Manager preenche esta seção com orientação de conteúdo da seção §4]

## Objetivo
[Objetivo da tarefa em uma frase do Plano de Implementação]

## Instruções Detalhadas
[Baseado nas sub-tarefas do Plano de Implementação:]
- Para tarefas de etapa única: "Complete todos os itens em uma resposta"
- Para tarefas de múltiplas etapas: "Complete em X trocas, uma etapa por resposta. **AGUARDE CONFIRMAÇÃO DO USUÁRIO** antes de prosseguir para cada etapa subsequente."
- Transforme bullets de sub-tarefas em instruções acionáveis especificando: o que fazer, como abordar, onde implementar e quais restrições/bibliotecas usar
- Inclua contexto dos campos Objective, Output e Guidance da tarefa

## Saída Esperada
- Entregas: [do campo Output do Plano de Implementação]
- Critérios de sucesso: [definição clara de conclusão]
- Localizações de arquivos: [caminhos específicos para arquivos criados/modificados]

## Registro de Memória
Após conclusão, você **DEVE** registrar o trabalho em: `[memory_log_path]`
Siga as instruções de .apm/guides/Memory_Log_Guide.md.

## Protocolo de Relatório
Após registrar, você **DEVE** gerar um **Relatório Final da Tarefa** em bloco de código.
- **Formato:** Use o template exato fornecido nas suas instruções de .claude/commands/apm-3-initiate-implementation.md.
- **Perspectiva:** Escreva-o da perspectiva do Usuário para que ele possa copiar e colar de volta ao Manager.

## Delegação Ad-Hoc
[Incluir apenas se ad_hoc_delegation: true]
[Manager preenche esta seção com orientação de conteúdo da seção §7, incluindo referências explícitas de comandos para Delegações de Debug/Pesquisa (.claude/commands/apm-8-delegate-debug.md ou .claude/commands/apm-7-delegate-research.md)]
```

### 2.4. Formato de Entrega

**Método Primário — Lançamento Automático via Launcher API:**
Se o arquivo `.apm/launcher-config.json` existir e `enabled` for `true`, o Manager Agent **DEVE** lançar sessões automaticamente:

1. Leia `.apm/launcher-config.json` para obter `api_url`, `default_mode`, `init_prompt_path` e `default_working_directory`
2. Leia o conteúdo do `init_prompt_path` (prompt de iniciação do Implementation Agent)
3. Construa o prompt combinado: conteúdo do init_prompt + separador `---` + `Agora, receba e execute a seguinte Atribuição de Tarefa:` + separador `---` + Prompt de Atribuição de Tarefa completo
4. Escreva o prompt combinado em um arquivo temporário em `prompt_tmp_dir` (ex: `.apm/tmp/task_X_Y_prompt.md`)
5. Execute via Bash o seguinte comando curl para lançar a sessão:
   `curl -s -X POST {api_url} -H "Content-Type: application/json" -d '{"promptFile":"{caminho_absoluto_do_tmp}","workingDirectory":"{default_working_directory}","mode":"{default_mode}","name":"APM {agent_assignment} - {task_ref}"}'`
6. Confirme ao Usuário que a sessão foi lançada com o ID retornado e informe que ele pode acompanhar em http://localhost:3001/

**Método Alternativo — Copiar e Colar Manual:**
Se `.apm/launcher-config.json` não existir ou `enabled` for `false`, apresente os Prompts de Atribuição de Tarefa como **um único bloco de código markdown com frontmatter YAML no topo** para o Usuário copiar e colar manualmente para uma nova sessão de Implementation Agent.

## 3. Integração de Contexto de Dependências
Quando tarefas consumidoras dependem de saídas de produtores ("Depende de: Saída da Task X.Y" na Orientação do Plano de Implementação), o Manager fornece contexto baseado na atribuição do agente:

### 3.1. Dependências do Mesmo Agente (Orientação Contextual)
Quando o **mesmo Implementation Agent** trabalhou nas tarefas produtora e consumidora:

**Abordagem Contextual:**
- Forneça referências específicas de saída e detalhes-chave de implementação para recordar
- Inclua localizações relevantes de arquivos e artefatos importantes criados
- Assuma familiaridade de trabalho mas forneça orientação concreta para integração
- O nível de detalhe varia baseado na complexidade da dependência e intervalo de tempo entre tarefas

**Exemplo Simples de Contexto do Mesmo Agente:**
```markdown
## Contexto de Dependências
Baseado no seu trabalho da Task 2.1, use o middleware de autenticação que você criou em `src/middleware/auth.js` e as funções de validação JWT para esta tarefa de integração frontend.
```

**Exemplo Complexo de Contexto do Mesmo Agente:**
```markdown
## Contexto de Dependências
Construindo sobre sua implementação da Task 2.3 da API:

**Saídas-Chave a Usar:**
- Endpoints de autenticação em `src/api/auth.js` (POST /api/login, GET /api/verify)
- Middleware de validação de usuário em `src/middleware/auth.js`
- Atualizações de esquema de banco de dados em `migrations/003_add_user_roles.sql`

**Detalhes de Implementação para Recordar:**
- Tokens JWT incluem papel e permissões do usuário no payload
- Tratamento de erros retorna objetos de erro padronizados com formato código/mensagem
- Limitação de taxa aplicada a tentativas de login (implementada no middleware)

**Abordagem de Integração:**
Para esta tarefa, estenda o sistema existente de permissões baseadas em papéis que você construiu para lidar com os novos requisitos do painel administrativo.
```

#### Diretrizes de Contexto do Mesmo Agente
- **Dependências Simples**: Referencie arquivos e saídas-chave com breve orientação de integração
- **Dependências Complexas**: Inclua lista de saídas-chave, detalhes importantes de implementação e abordagem clara de integração
- **Considerações de Intervalo de Tempo**: Mais detalhes quando tempo significativo passou entre tarefas relacionadas
- **Referências de Arquivo**: Sempre inclua caminhos específicos de arquivo para saídas que precisam ser usadas ou estendidas
- **Continuidade de Implementação**: Enfatize construir sobre trabalho anterior em vez de começar do zero

### 3.2. Dependências Entre Agentes (Contexto de Integração Abrangente)
Quando **Implementation Agents diferentes** trabalharam nas tarefas produtora e consumidora (Tarefas têm tag "pelo Agent X"):

**Abordagem de Contexto Abrangente:**
- Sempre forneça etapas detalhadas de integração com instruções explícitas de leitura de arquivo
- Inclua resumos abrangentes de saída e orientação de uso independentemente da complexidade da dependência
- Forneça protocolos de esclarecimento com o Usuário para pontos ambíguos de integração
- A complexidade afeta apenas a quantidade de trabalho de integração, não o nível de detalhe fornecido

**Template de Contexto Entre Agentes:**

De cada seção abaixo, use as opções que melhor se encaixam nos requisitos específicos de integração de contexto.
```markdown
## Contexto de Dependências
Esta tarefa [depende de/se baseia em/integra com] [descrição da Task X.Y] implementada por [Agente_Produtor]:

**Etapas de Integração (complete em uma resposta):**
1. [Leia/Revise/Examine] [arquivo/documentação específica] em [caminho do arquivo] para entender [aspecto/funcionalidade específica]
2. [Estude/Analise] [arquivos de implementação] em [diretório/caminhos de arquivo] para entender [abordagem técnica/estruturas de dados/padrões]
3. [Examine/Revise] [arquivos de teste/exemplos] em [caminhos de arquivo] para [padrões de uso/comportamentos esperados/exemplos de integração]
4. [Etapas adicionais de integração conforme necessário para saídas específicas]

**Resumo da Saída do Produtor:**
- [Funcionalidade/recurso-chave]: [Descrição do que foi construído e como funciona]
- [Arquivos/endpoints importantes]: [Localizações e propósitos das saídas-chave]
- [Estruturas de dados/interfaces]: [Formatos de dados, tipos ou contratos importantes]
- [Tratamento de erros/validação]: [Como erros são tratados e quais formatos são usados]
- [Segurança/autenticação]: [Quaisquer medidas de segurança ou requisitos de autenticação]

**Requisitos de Integração:**
- [Requisito específico 1]: [Como a tarefa consumidora deve integrar com a saída do produtor]
- [Requisito específico 2]: [Especificações adicionais de integração]
- [Padrões de uso]: [Como usar adequadamente as saídas do produtor]
- [Restrições/limitações]: [Limitações ou restrições importantes a considerar]

**Protocolo de Esclarecimento com Usuário:**
Se [aspecto específico de integração] for ambíguo após completar as etapas de integração, pergunte ao Usuário sobre [áreas específicas de esclarecimento].
```

**Diretrizes de Criação de Contexto Entre Agentes:**
- **Sempre Abrangente**: Independentemente da complexidade da dependência, forneça etapas completas de integração, resumos de saída e requisitos selecionando das opções que correspondem aos requisitos de dependência
- **Instruções Específicas de Arquivo**: Sempre inclua caminhos explícitos de arquivo e o que procurar em cada arquivo
- **Cobertura Completa de Saída**: Documente todas as saídas relevantes, interfaces e padrões de uso da tarefa produtora
- **Requisitos de Integração**: Especifique exatamente como a tarefa consumidora deve integrar com as saídas do produtor
- **Protocolos de Esclarecimento**: Sempre inclua caminho de esclarecimento com o Usuário para pontos ambíguos de integração
- **Suposição**: O Agente Consumidor tem zero familiaridade com o trabalho do produtor - explique tudo necessário para integração bem-sucedida

### 3.3. Execução da Integração de Contexto
**Para Dependências do Mesmo Agente:**
- Sem seção separada de etapas de integração no Prompt de Atribuição de Tarefa
- Inclua seção mínima "Contexto de Dependências" com `dependency_context: true` no YAML

**Para Dependências Entre Agentes:**
- Inclua seção detalhada "Contexto de Dependências" com `dependency_context: true` no YAML
- Implementation Agent completa todas as etapas de integração em uma resposta antes da tarefa principal

### 3.4. Diretrizes de Integração de Contexto para Manager Agents

**Criação de Contexto do Mesmo Agente:**
- Revise o Registro de Memória da tarefa produtora para saídas-chave e entregas
- Referencie trabalho anterior sem repetir instruções detalhadas
- Foque na conexão de saída e continuação do trabalho

**Criação de Contexto Entre Agentes:**
- Revise minuciosamente o Registro de Memória da tarefa produtora para saídas, localizações de arquivos, abordagens
- Crie instruções detalhadas de leitura e revisão de arquivos
- Forneça resumo abrangente de saída e orientação de uso
- Inclua protocolo de esclarecimento com o Usuário para integrações complexas

## 4. Revisão do Registro de Memória
Quando o Implementation Agent retornar, **revise o Registro de Memória conforme .apm/guides/Memory_Log_Guide.md seção §5**. Avalie o status de conclusão da tarefa, identifique bloqueadores e verifique se as saídas correspondem às expectativas do Plano de Implementação. Escaneie o frontmatter YAML do registro:
- Se `important_findings: true` ou `compatibility_issue: true`: Leia os arquivos fonte ou saídas específicas referenciados no registro para verificar as descobertas. **Não prossiga baseado apenas no conteúdo do registro.**

## 5. Framework de Próxima Ação
Baseado na revisão do registro, determine a próxima etapa apropriada:

### 5.1. Fluxo de Trabalho de Continuação
- Tarefa completa e bem-sucedida → Emita **próximo Prompt de Atribuição de Tarefa** conforme Plano de Implementação (Ciclo de Tarefas continua)
- Fase completa → **Crie resumo da fase**, inicie próxima fase

### 5.2. Ações de Acompanhamento
- Tarefa precisa de refinamento → Envie **prompt de acompanhamento** de correção ao mesmo agente (se bloqueadores técnicos persistirem, considere **Delegação Ad-Hoc no prompt de acompanhamento**)
- Suposições do plano inválidas ou quaisquer outras alterações necessárias → **Atualize o Plano de Implementação**

### 5.3. Critérios de Decisão
- **Completa**: Todas as entregas produzidas, requisitos atendidos
- **Parcial**: Algum progresso feito, problemas específicos identificados
- **Bloqueada**: Não é possível prosseguir sem input externo ou resolução

## 6. Protocolo de Delegação Ad-Hoc
Defina `ad_hoc_delegation: true` apenas quando o Plano de Implementação contiver etapas explícitas de delegação para a tarefa.

### 6.1. Responsabilidades do Manager
Quando o Plano de Implementação contiver etapas explícitas de delegação, os Manager Agents devem:
- Extrair requisitos de delegação da etapa do Plano de Implementação
- **Identificar tipo de delegação** (Debug, Pesquisa ou outro) da etapa de delegação do Plano de Implementação
- **Incluir referências explícitas de guias** para tipos padrão de delegação no Prompt de Atribuição de Tarefa se possível
- Especificar o que delegar e entregas esperadas no prompt

**Referências de Comandos Padrão de Delegação**:
- **Delegação de Debug**: Referencie .claude/commands/apm-8-delegate-debug.md
- **Delegação de Pesquisa**: Referencie .claude/commands/apm-7-delegate-research.md
- **Delegações Customizadas**: Referencie arquivos de comandos customizados apropriados se disponíveis

### 6.2. Requisitos de Integração
- Implementation Agent cria prompt de delegação e gerencia o fluxo de trabalho
- Agentes Ad-Hoc trabalham em um branch separado gerenciado pelo Implementation Agent que os atribuiu; eles não registram na Memória
- O agente original incorpora as descobertas e registra a delegação enquanto o Usuário exclui a sessão de chat de delegação (opcional)

---

**Fim do Guia**