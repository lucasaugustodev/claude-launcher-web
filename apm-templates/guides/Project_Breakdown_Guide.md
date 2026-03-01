# APM 0.5.4 - Guia de Divisão do Projeto

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como os Setup Agents transformam as descobertas da Síntese de Contexto em divisões de trabalho estruturadas e atribuídas a agentes. Seguindo uma metodologia sistemática do alto nível ao detalhe, ele previne correspondência de templates através de sequenciamento estratégico de fluxo de trabalho e alternância de saída entre chat e arquivo. O guia garante a precisão na divisão de tarefas necessária para o sucesso do Implementation Agent enquanto minimiza a sobrecarga de coordenação do Manager Agent.

## 1. Integração de Contexto e Visão Geral da Divisão

### 1.1. Insights Retidos da Síntese de Contexto
A decomposição do projeto transforma as descobertas da Síntese de Contexto em divisão estruturada de tarefas usando **insights retidos** da fase de descoberta. Esses insights fornecem âncoras concretas de decisão e devem ser ativamente integrados nas especificações de tarefas:

**Insights Técnicos e de Escopo:**
- **Limites de domínio** → Criar atribuições coerentes de agentes (ver §2.1)
- **Flags de complexidade** → Criar tarefas com granularidade apropriada (ver §4.1)
- **Dependências externas** → Planejar orientação ao Usuário para ações fora do IDE (ver §4.1)
- **Necessidades de investigação** → Adicionar uma etapa mínima de uma linha de Delegação Ad-Hoc onde necessário em tarefas multi-etapas afetadas (ver §4.2, §4.3)
- **Padrões de fluxo de trabalho** → Honrar a progressão natural nas dependências (ver §4.5)

**Insights de Processo e Implementação:**
- **Padrões de qualidade e requisitos de validação** → Converter em objetivos explícitos de tarefas, critérios de aceitação e etapas de validação
- **Preferências de implementação e metodologias** → Especificar como abordagem obrigatória de execução de tarefas e requisitos procedimentais
- **Restrições de processo e requisitos de fluxo de trabalho** → Incorporar como etapas específicas de tarefas, restrições e protocolos de coordenação
- **Requisitos de coordenação e rastreamento** → Estruturar como etapas explícitas de interação com o usuário e pontos de verificação de revisão
- **Preferências de ferramentas e restrições técnicas** → Detalhar na orientação da tarefa como especificações técnicas obrigatórias

**Verificação de Integração:** Durante cada ciclo de fase, auditar que os requisitos enfatizados do usuário apareçam como componentes explícitos de tarefas, não como suposições de fundo.

### 1.2. Sequência de Divisão do Projeto
O Setup Agent deve seguir esta progressão sistemática do alto nível ao detalhe com portões de progressão obrigatórios e verificação de integração:

Para manter a eficiência, você deve executar a **Sequência completa de Divisão do Projeto em uma única resposta**. Para prevenir correspondência de padrões e degradação de qualidade, você deve **INTERCALAR** sua análise:

1. **Análise de Domínio** (§2) → Atribuições de agentes **no chat**
2. **Definição de Fases** (§3) → Sequência de fases **no chat**
3. **Ciclos de Fase** (§4) – **Sequência Intercalada Rigorosa:** Para cada fase, realize a **Análise completa da Fase X** no chat: execute **Integração de Contexto da Fase e Identificação de Tarefas** (§4.1), depois **Análise Completa Individual de Tarefas** (§4.2) para TODAS as tarefas, depois **Avaliação de Dependências da Fase** (§4.3).
   - **Somente após** completar toda a Análise da Fase X no chat, adicione o conteúdo da Fase X ao arquivo seguindo o **Procedimento de Documentação da Fase** (§4.4).
   - **Então e somente então** prossiga para a Fase X+1 e repita o ciclo completo.
   - **Repita** esta sequência intercalada rigorosa para todas as fases sem agrupar ou pular escritas de arquivo **a menos que explicitamente instruído pelo Usuário**.
4. **Revisão Final** (§5) → Divisão de agentes (§5.1) + marcação de dependências entre agentes (§5.2) + **validação de requisitos de processo no arquivo**
5. **Aprovação do Plano** (§5.3) → Aprovação do Usuário baseada no arquivo + conteúdo do chat

**Portões de Progressão**: Cada etapa deve ser completada antes de prosseguir para a próxima
**Verificação de Integração**: Cada ciclo de fase deve validar que os insights da Síntese de Contexto estão explicitamente integrados nas especificações de tarefas

### 1.3. Padrão de Fluxo de Trabalho Chat-para-Arquivo
Alternância estratégica de contexto previne correspondência de padrões:

**Operações no Chat**: Identificação de domínio, sequência de fases, divisão de tarefas por fase, decisões de revisão final
**Operações no Arquivo**: Documentar cada ciclo de fase concluído, atualizações de divisão de agentes, adições de dependências entre agentes
**Quebras de Contexto**: Escritas no arquivo interrompem a escrita contínua no chat, fornecendo perspectiva fresca para cada fase subsequente, evitando assim correspondência de padrões

O formato estruturado do arquivo (ver §4.4) previne formação de templates enquanto garante que a saída esteja imediatamente pronta para consumo pelo Manager Agent.

## 2. Análise de Domínio e Atribuição de Agentes

### 2.1. Identificação de Domínio a Partir do Contexto Retido
Transforme os limites de domínio retidos da Síntese de Contexto em domínios lógicos de trabalho que requerem diferentes modelos mentais e conjuntos de habilidades para atribuição de Implementation Agents:

#### Separação de Áreas de Habilidade
- Diferentes áreas de expertise retidas → Agentes separados requerendo bases de conhecimento distintas
- Diferentes ambientes técnicos notados → Agentes específicos de domínio para cada stack tecnológica
- Necessidades de investigação versus execução identificadas → Separação entre agentes focados em pesquisa versus implementação
- Requisitos de especialização de processo identificados → Agentes dedicados para garantia de qualidade, validação ou atividades de coordenação

#### Limites de Modelo Mental
- Padrões de trabalho voltado ao usuário versus voltado ao sistema → Separação de domínio client-side versus server-side
- Fluxos de trabalho criativo versus analítico → Limites de domínio orientados a conteúdo versus orientados a dados
- Atividades de configuração versus desenvolvimento → Domínios de agente focados em setup versus focados em funcionalidades
- Fluxos de trabalho de execução versus validação → Limites de domínio focados em implementação versus focados em revisão

#### Critérios de Coerência de Domínio
Avalie domínios potenciais contra requisitos de coerência para sucesso do Implementation Agent:

**Requisito de Modelo Mental Único:**
- Todas as tarefas dentro do domínio requerem abordagem de pensamento e metodologia de resolução de problemas similares
- O escopo do domínio mantém requisitos consistentes de conhecimento técnico e conjunto de habilidades
- A progressão de tarefas dentro do domínio segue padrões naturais de fluxo de trabalho sem troca de contexto ou modelo mental
- Os requisitos de processo se alinham com a expertise e padrões de fluxo de trabalho do domínio

**Agrupamentos Naturais de Fluxo de Trabalho:**
- Tarefas dentro do domínio se constroem logicamente umas sobre as outras com dependências externas mínimas
- Os limites de domínio se alinham com as relações de fluxo de trabalho retidas da Síntese de Contexto
- A progressão do trabalho dentro do domínio mantém continuidade de contexto para execução do Implementation Agent
- Padrões de qualidade e requisitos de validação suportam organização coerente de domínio

**Validação de Limites:**
- A separação de domínios reduz a sobrecarga de coordenação do Manager e evita confusão do Implementation Agent
- Cada domínio entrega valor independente enquanto suporta os objetivos gerais do projeto
- Restrições de processo e requisitos de qualidade são consistentemente aplicáveis dentro dos limites do domínio

### 2.2. Criação Inicial da Equipe de Implementation Agents
Transforme domínios identificados em atribuições iniciais de Implementation Agents:

#### Processo de Atribuição
Apresente a equipe completa de agentes com justificativa de domínio:
- Crie um Implementation Agent por domínio lógico identificado na análise §2.1
- Atribua identificadores descritivos de agentes refletindo o escopo do domínio: `Agent_<Domínio>`
- Considere requisitos de processo ao definir a especialização e necessidades de coordenação dos agentes
- Estime dependências prováveis entre agentes (ver §5.2) e minimize através de limites coerentes de domínio
- Note que a revisão de distribuição de carga de trabalho ocorre posteriormente (ver §5.1) e pode requerer subdivisão de agentes

#### Primeira Ação no Chat
Ao ler o guia, escreva imediatamente **no chat** a análise de domínio e atribuições iniciais de agentes antes de prosseguir para a definição de fases (ver §3). Isso estabelece a base da equipe de Implementation Agents para atribuições subsequentes de tarefas.

## 3. Definição da Sequência de Fases

### 3.1. Identificação de Fases a Partir de Padrões de Fluxo de Trabalho Retidos
Transforme padrões de fluxo de trabalho retidos da Síntese de Contexto em estrutura lógica de progressão do projeto:

#### Determinação da Estrutura de Fases
Use padrões de escopo e fluxo de trabalho retidos para determinar a organização apropriada de fases:

**Análise de Padrões de Complexidade:**
- Complexidade em camadas sinalizada → Fases hierárquicas com dependências progressivas
- Padrões sequenciais retidos → Fases lineares seguindo progressão natural de fluxo de trabalho
- Fluxos de trabalho concorrentes notados → Fases paralelas organizadas por domínio ou limites de componente
- Requisitos de processo identificados → Fases dedicadas de validação, revisão ou garantia de qualidade quando restrições de fluxo de trabalho as exigem

**Lógica de Início a Fim:**
- Identifique requisitos de iniciação do projeto a partir do contexto retido
- Defina fluxo de trabalho de continuidade mantendo impulso entre fases
- Estabeleça critérios de conclusão e limites de entrega final
- Garanta progressão natural do projeto sem dependências forçadas
- Integre restrições de processo e pontos de verificação de qualidade na progressão das fases

#### Avaliação de Limites de Fase
- Requisitos extensos de pesquisa identificados → Fases dedicadas de pesquisa quando a investigação bloqueia trabalho subsequente
- Requisitos de teste e validação identificados → Fases separadas de validação ou pontos de verificação integrados
- Gargalos retidos e itens de caminho crítico → Limites naturais de fase nas restrições do projeto
- Compreensão simples de escopo → Progressão linear de tarefas sem organização em fases
- Padrões de qualidade e requisitos de revisão → Limites adicionais de fase ou escopo estendido de fase para atividades de validação

#### Critérios de Escopo de Fase
Avalie a necessidade e os limites das fases contra os requisitos do projeto:
- Cada fase entrega valor independente em direção à conclusão do projeto
- Os limites de fase se alinham com as relações de fluxo de trabalho retidas e pontos de verificação naturais
- A organização em fases reduz a complexidade de coordenação entre agentes
- O escopo da fase suporta a preservação de contexto do Implementation Agent dentro dos domínios
- Requisitos de processo e padrões de qualidade suportam organização coerente de fases e fluxos de trabalho de validação

### 3.2. Lógica de Progressão de Fases
Transforme a sequência definida do projeto em §3.1 em estrutura de projeto em fases:

#### Processo de Apresentação
Apresente a sequência completa de fases com justificativa de suporte:
- Liste as fases em ordem de execução, fornecendo justificativa baseada em padrões de fluxo de trabalho retidos: `Fase X: <Nome_da_Fase>`
- Note dependências de fase e pontos de passagem de entregas entre fases
- Confirme que a organização em fases se alinha com os insights da Síntese de Contexto e requisitos do projeto
- Garanta que os limites de fase suportem progressão natural de fluxo de trabalho e minimizem complexidade de coordenação entre fases
- Valide que requisitos de processo e padrões de qualidade estão apropriadamente integrados na estrutura de fases
- Prossiga para a execução de ciclos de fase (ver §4) seguindo a sequência estabelecida

#### Segunda Ação no Chat
Após apresentar as atribuições da equipe de agentes (ver §2.2), escreva imediatamente **no chat** a análise da sequência de fases antes de iniciar os ciclos de fase (ver §4). Isso estabelece a base da estrutura do projeto para a divisão sistemática de tarefas.

### 3.3. Inicialização do Cabeçalho do Plano de Implementação
**OBRIGATÓRIO**: Antes de prosseguir para os ciclos de fase (ver §4), você **DEVE** preencher o cabeçalho do arquivo `.apm/Implementation_Plan.md` criado pela ferramenta CLI `agentic-pm` usando `apm init`.

O arquivo já contém um template de cabeçalho com placeholders. Você deve:
1. **Ler o cabeçalho existente** em `.apm/Implementation_Plan.md`
2. **Preencher todos os campos do cabeçalho**:
   - Substitua `<Project Name>` pelo nome real do projeto
   - Substitua `[To be filled by Setup Agent before Project Breakdown]` no campo **Last Modification** por: "Criação do plano pelo Setup Agent."
   - Substitua `[To be filled by Setup Agent before Project Breakdown]` no campo **Project Overview** por um resumo conciso do projeto
3. **Salvar o cabeçalho atualizado** - Esta é uma operação dedicada de edição de arquivo que deve ser concluída antes que qualquer conteúdo de fase seja escrito

**Somente após o cabeçalho estar completo**, prossiga para os ciclos de fase (ver §4). Todo conteúdo de fase será adicionado a este arquivo após o cabeçalho.

## 4. Execução de Ciclos de Fase

### 4.1. Integração de Contexto da Fase e Identificação de Tarefas
**Declaração de Integração de Contexto**: Antes da identificação de tarefas, declare explicitamente **no chat** insights retidos relevantes para a fase atual: "Da Síntese de Contexto, eu retive [requisitos/restrições/preferências específicos]. Para esta fase, estes influenciam a criação de tarefas por [considerações específicas ou 'fornecem contexto geral do projeto mas sem requisitos diretos no nível de tarefa']."

**Identificação de Tarefas com Proteções Anti-Empacotamento**:
Ao identificar tarefas para esta fase, aplique estes testes para cada tarefa potencial:

- **Teste de Foco Único**: "Isto pode ser completado por um agente em uma sessão de trabalho focada sem troca de contexto/modo mental?"
- **Teste de Limite de Domínio**: "Isto envolve múltiplos domínios técnicos não relacionados ou conjuntos de habilidades?"
- **Teste de Valor Independente**: "Se eu dividir isto em componentes, cada componente entregaria valor independente?"
- **Teste de Entrega de Unidade Única de Trabalho**: "A conclusão desta tarefa resulta em uma entrega que pode ser realizada como uma única unidade de trabalho?"
- **Teste de Consistência de Complexidade**: "A complexidade desta tarefa é compatível com outras na fase, ou é significativamente mais complexa?"

**Se qualquer teste sugerir divisão, crie tarefas separadas durante a identificação.**

**Processo de Identificação de Tarefas**: Transforme objetivos da fase em tarefas focadas usando insights retidos da Síntese de Contexto. Aplique proteções anti-empacotamento continuamente durante a identificação. Cada tarefa deve entregar valor independente em direção à conclusão da fase. Nenhuma tarefa deve ser super-empacotada e conter múltiplas entregas e objetivos.

**Apresentar Lista de Tarefas**: Após aplicar as proteções, apresente **no chat** a lista completa de tarefas da fase: "Task X.1: [Nome], Task X.2: [Nome]..." antes de prosseguir para a análise individual.

**Pré-verificação de Delegação Ad-Hoc:** Ao listar tarefas, sinalize rapidamente qualquer tarefa que necessite de delegação ad-hoc baseada em insights retidos. Use um marcador inline após o nome da tarefa: "(ad-hoc: <propósito>)". Mantenha em cinco palavras ou menos; sem justificativa aqui.

### 4.2. Análise Completa Individual de Tarefas
**CRÍTICO**: Analise cada tarefa de 4.1 individualmente com raciocínio completo antes de prosseguir para a próxima tarefa. Nunca processe múltiplas tarefas em lote.**Para cada tarefa identificada, complete a seguinte análise sistemática no chat:**

```
#### **Task [X.Y]: [Nome da Tarefa]**

**Análise de Escopo:**
Esta tarefa realiza [objetivo específico] e requer [análise detalhada de escopo]. As entregas são [saídas ou artefatos claramente definidos].

**Avaliação de Execução:**
Analise o que esta tarefa requer:
- **Capacidades do Agente**: Escrita de código, operações de arquivo, comandos de terminal, configuração do IDE, testes, documentação, ações de chamada de ferramentas
- **Coordenação com Usuário**: Plataformas externas, autenticação de contas, configurações de repositório, configuração de deploy, aprovação de design, pontos de verificação de feedback
- **Requisitos Mistos**: Separar componentes do agente vs usuário em ordem lógica

*Declare sua avaliação:* "Esta tarefa requer [ações específicas do agente vs coordenação com usuário]. Evidência para execução pelo agente: [capacidades específicas do IDE]. Evidência para coordenação com usuário: [dependências externas, necessidades de acesso a contas]."

**Decisão de Classificação:**
Avalie a estrutura do fluxo de trabalho:
- **Critérios de etapa única**: Trabalho coeso completável em uma troca, sem dependências internas, sem pontos de validação necessários
- **Critérios de múltiplas etapas**: Dependências sequenciais internas, necessidades de confirmação do usuário, necessidades de delegação ad-hoc, requisitos de validação progressiva, implementação complexa com pontos de parada naturais
- **Casos limítrofes**: Coordenação de plataforma externa = múltiplas etapas, necessidades de pesquisa = múltiplas etapas com delegação ad-hoc, trabalho técnico complexo com pontos de parada = múltiplas etapas

*Declare seu raciocínio:* "Task [X.Y] envolve [descrição do fluxo de trabalho]. Baseado em [insights da Síntese de Contexto, fatores de fluxo de trabalho, necessidades de validação, dependências técnicas], isto requer execução em [etapa única/múltiplas etapas] porque [raciocínio específico]."

**Especificação de Conteúdo:**
Determine o conteúdo apropriado da tarefa:
- **Variação natural**: Baseie a contagem na complexidade real, não em correspondência de padrões
- **Diretrizes de etapa única**: Até 4 bullets baseados na complexidade das instruções
- **Diretrizes de múltiplas etapas**: Até 6 etapas baseadas nas dependências do fluxo de trabalho
- **Foco em qualidade**: O conteúdo deve corresponder à complexidade individual da tarefa

*Justifique sua escolha:*
- **Se Etapa Única**: "Isto precisa de [X] bullets porque [análise de complexidade]. Cada bullet aborda [necessidades de orientação de implementação]."
- **Se Múltiplas Etapas**: "Isto precisa de [X] etapas porque [análise de dependência de fluxo de trabalho]. Cada etapa representa [progressão natural]."

**Definição de Conteúdo:**
- Se sinalizado em §4.1, primeiro adicione uma etapa de delegação ad-hoc: "Delegação Ad-Hoc – <propósito>" (ref opcional a .claude/commands/apm-7-delegate-research.md ou .claude/commands/apm-8-delegate-debug.md), depois continue
- [Apresente os bullets ou etapas reais com raciocínio aplicado]

**Análise da Task [X.Y] completa** ← Declare isto antes de prosseguir para a próxima tarefa
```

**Repita esta análise completa para cada tarefa identificada em 4.1.**

### 4.3. Avaliação de Dependências da Fase
**Após completar a análise individual de todas as tarefas da fase**, conduza uma revisão holística de dependências:

**Identificação de Dependências**: Procure padrões retidos de "deve fazer A antes de B" da Síntese de Contexto para a fase atual. Identifique relações genuínas de produtor-consumidor entre tarefas analisadas em §4.2.

**Análise de Dependências**: Defina dependências baseadas em requisitos reais de fluxo de trabalho e restrições de processo, não artificiais. Inclua dependências de processo como portões de qualidade, requisitos de validação e pontos de verificação de revisão.

**Apresentação da Lista de Dependências**: Apresente **no chat** a lista completa de dependências com justificativa usando notação simples: "Task X.Y depende da saída da Task Z.W porque [raciocínio explícito]"

### 4.4. Procedimento de Documentação da Fase
**SEQUÊNCIA CRÍTICA DE FLUXO DE TRABALHO**: Complete TODAS as análises individuais de tarefas de §4.2 e avaliação de dependências de §4.3 antes de qualquer operação de arquivo.

#### Processo de Criação de Arquivo
1. **Complete Toda a Análise da Fase no Chat Primeiro**: Apresente todas as análises individuais de tarefas e dependências **no chat** antes de prosseguir para a documentação em arquivo
2. **Timing da Operação de Arquivo**: Adicione ao `Implementation_Plan.md` somente após o ciclo completo da fase ser apresentado **no chat**
3. **Operação de escrita única**: Cada ciclo de fase resulta em **exatamente uma** adição ao arquivo contendo apenas o conteúdo da fase atual

#### Formato de Tradução de Conteúdo
Traduza as análises individuais completadas de §4.2-4.3 para formato estruturado de arquivo, garantindo que todos os insights de raciocínio e requisitos de processo sejam preservados nas descrições de tarefas:

* **1. Cabeçalho do Documento:** O cabeçalho já deve estar preenchido de §3.3. **NÃO** sobrescreva ou modifique o cabeçalho ao escrever conteúdo de fase. Apenas adicione seções de fase após o cabeçalho existente.
* **2. Seções de Fase:** Use títulos de nível 2: `## Fase <n>: <Nome>`
* **3. Blocos de Tarefa:**
  - Use títulos de nível 3: `### Task <n.m> – <Título> - <Agent_<Domínio>>`
  - Diretamente sob o título, adicione estes meta-campos:
    - **Objective:** Objetivo da tarefa em uma frase.
    - **Output:** Entrega concreta (ex: "Arquivos do módulo de autenticação").
    - **Guidance:** Restrições técnicas-chave ou abordagem. Orientação para o Manager Agent atribuir a tarefa com sucesso.
* **4. Formatação de Sub-Tarefas:**
  - **Etapa única**: Lista não ordenada (`-`) para instruções.
  - **Múltiplas etapas**: Lista ordenada (`1.`, `2.`) para etapas sequenciais.
  - **Conteúdo**: Etapas/bullets derivados na sua Análise do Chat (§4.2) com detalhes adicionais (se necessário). Preserve todos os insights de análise individual, requisitos de processo e especificações de implementação da divisão no chat
  - **Etapas de delegação Ad-Hoc:** prefixe com `Delegação Ad-Hoc – <Propósito>` como uma única linha (ref curta opcional ao guia); sem conteúdo estendido no arquivo
* **5. Formato de Dependência:** Adicione ao campo `Guidance` da Tarefa Consumidora:
  - Mesmo agente: `**Depende de: Saída da Task X.Y**`
  - Entre agentes: `**Depende de: Saída da Task X.Y pelo Agent Z**`

## 5. Revisão Final e Integração Entre Agentes

### 5.1. Avaliação de Carga de Trabalho dos Agentes e Divisão de Subdomínios
Conduza a primeira revisão holística para avaliar a distribuição de carga de trabalho dos agentes em todo o plano. Agentes sobrecarregados (8+ tarefas) devem ser subdivididos:

#### Avaliação de Carga de Trabalho dos Agentes
- Conte o total de tarefas atribuídas a cada agente em todas as fases concluídas
- Identifique agentes com 8+ atribuições de tarefas que requerem subdivisão
- Revise a distribuição de tarefas para coerência lógica dentro dos domínios dos agentes e requisitos de processo

#### Processo de Divisão de Subdomínio
Para agentes sobrecarregados que requerem subdivisão:
- Analise tarefas dentro do domínio do agente para limites lógicos de subdomínio
- Crie sub-agentes coerentes baseados em agrupamentos naturais de tarefas e necessidades de especialização de processo: Agent_<Domínio>_<Subdomínio>
- Redistribua tarefas dos agentes sobrecarregados para sub-agentes apropriados baseados em limites lógicos e requisitos de implementação
- Mantenha princípios de coerência de domínio de §2.1 e alinhamento de processo dentro das divisões de subdomínio

#### Atualização de Reatribuição de Agentes no Arquivo
Atualize `Implementation_Plan.md` com atribuições revisadas de agentes:
- Modifique todas as entradas de tarefas afetadas com novas atribuições de sub-agentes
- Preserve o conteúdo exato da tarefa, dependências, definições de instruções/etapas e especificações de processo durante a reatribuição
- Garanta que o arquivo reflita a **atribuição final de agentes** antes de prosseguir para §5.2

### 5.2. Marcação de Dependências Entre Agentes
Conduza a segunda revisão holística para identificar e marcar dependências entre agentes usando as **atribuições finais de agentes** de §5.1:

#### Identificação de Dependências Entre Agentes
- Revise o plano inteiro com atribuições finais de agentes para identificar dependências entre agentes
- Marque dependências como entre agentes somente se as tarefas produtora e consumidora forem atribuídas a agentes diferentes
- Tarefas com "Depende de Task X.Y" são dependentes entre agentes se o agente da Task X.Y ≠ agente da tarefa atual
- Inclua dependências de processo como validação de qualidade, pontos de verificação de revisão ou requisitos de coordenação
- Apresente todas as dependências entre agentes identificadas **no chat** antes de prosseguir para editar o arquivo

#### Atualização de Notação de Dependências no Arquivo
Atualize `Implementation_Plan.md` com notações aprimoradas de dependências:
- Adicione notação "pelo Agent Y" exclusivamente às dependências entre agentes
- Preserve o formato simples "Depende de saída da Task X.Y" para dependências do mesmo agente

### 5.3. Apresentação Conceitual do Plano e Aprovação do Usuário
Apresente a visão geral do plano e solicite aprovação do Usuário baseada no contexto completo do arquivo e chat:

#### Apresentação do Resumo da Visão Geral
Apresente **no chat** estatísticas de alto nível do plano:
- Número de agentes e domínios
- Total de fases com nomes e contagem de tarefas
- Contagem total de tarefas e contagem total de tarefas por tipo de tarefa
- Contagem de dependências entre agentes
- Resumo de requisitos de processo e especificações de implementação integrados

#### Processo de Revisão e Aprovação do Usuário
- Direcione o Usuário para revisar o plano estruturado completo em `Implementation_Plan.md`
- Referencie o raciocínio detalhado de divisão das trocas anteriores no chat (§2-§4)
- Confirme que os insights da Síntese de Contexto, incluindo requisitos de processo e padrões de qualidade, estão refletidos nas especificações de tarefas
- Apresente as opções conforme definido em .claude/commands/apm-1-initiate-setup.md §2:
  - **Plano está bom** → Fase de Setup completa, prossiga para o Manager Agent
  - **Modificações necessárias** → Aplique as alterações e reapresente as opções
  - **Revisão Sistemática solicitada** → Prossiga para .apm/guides/Project_Breakdown_Review_Guide.md

**Fim do Guia**