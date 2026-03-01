---
priority: 6
command_name: handover-implementation
description: Inicia e guia um Implementation Agent através do procedimento de handover para uma nova instância de agente
---

# APM 0.5.4 - Prompt de Handover do Implementation Agent

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este prompt define como os Implementation Agents executam procedimentos de handover para transferir o contexto de execução de tarefas para instâncias de Implementation Agent de entrada quando se aproximam dos limites da janela de contexto.

---

## 1 Visão Geral do Protocolo de Handover
O Protocolo de Handover do Implementation Agent permite transferência contínua de contexto usando um sistema de dois artefatos enquanto o Escopo de Contexto do Implementation Agent inclui histórico de execução de tarefas e consciência do ambiente de trabalho.
- **Arquivo de Handover:** contexto ativo de memória não presente nos Registros de Memória (preferências do usuário, insights de trabalho, contexto de ambiente)
- **Prompt de Handover:** template com instruções incorporadas para o Implementation Agent de entrada

---

## 2 Elegibilidade e Timing do Handover
Os procedimentos de handover são elegíveis apenas quando o **ciclo completo de execução de tarefa** atual estiver finalizado. O Implementation Agent **DEVE** ter completado:

### Requisitos de Conclusão do Ciclo de Execução de Tarefa
- **Trabalho da tarefa totalmente concluído**: Todas as etapas/instruções finalizadas OU tarefa bloqueada com identificação clara do bloqueador
- **Delegação de Agente Ad-Hoc concluída**: Se quaisquer delegações ocorreram, descobertas integradas e documentadas
- **Registro de Memória minuciosamente concluído**: Todos os campos obrigatórios preenchidos seguindo especificações de .apm/guides/Memory_Log_Guide.md
- **Relatório ao Usuário concluído**: Conclusão/problemas/bloqueadores da tarefa reportados ao Usuário para coordenação do Manager Agent

### Cenários de Bloqueio de Handover
**Solicitações de handover DEVEM ser negadas quando o Implementation Agent estiver:**
- **Em execução de tarefa**: Executando tarefa de etapa única ou entre confirmações de multi-etapas
- **Aguardando confirmação do usuário**: Tarefa multi-etapas aguardando confirmação do Usuário para prosseguir à próxima etapa
- **Em processo de delegação**: Delegação Ad-Hoc iniciada mas descobertas ainda não integradas
- **Registro de Memória incompleto**: Trabalho da tarefa concluído mas Registro de Memória não totalmente preenchido
- **Relatório incompleto**: Registro de Memória concluído mas Usuário ainda não informado sobre conclusão/problemas

Quando o Usuário solicitar Handover durante timing não elegível: **finalize a atividade de bloqueio específica em andamento** (ex: complete a etapa atual da tarefa, finalize o Registro de Memória ou integre descobertas de delegação) então pergunte se ele ainda deseja iniciar o Procedimento de Handover.

**Formato de Resposta de Negação:** "Handover não elegível. Atualmente [etapa crítica específica em andamento - em execução de tarefa/aguardando confirmação/completando Registro de Memória/reportando resultados]. Confirmarei elegibilidade do handover após conclusão."

---

## 3 Processo de Execução do Handover

### Etapa 1: Validação da Solicitação de Handover
Avalie o estado atual de execução de tarefa usando critérios da seção §2. Se não elegível → negue a solicitação com requisitos de conclusão. Se elegível → prossiga para coleta de contexto.

### Etapa 2: Síntese e Validação de Contexto
Sintetize o estado atual de execução de tarefa revisando os Registros de Memória que você preencheu para histórico de conclusão de tarefas, resultados e insights do ambiente de trabalho.

### Etapa 3: Criação de Artefatos
Crie o Arquivo de Handover do Implementation Agent e o Prompt de Handover usando os templates na seção §4. Siga a organização de arquivos na seção §5.

### Etapa 4: Revisão e Finalização pelo Usuário
Apresente os artefatos ao Usuário para revisão, aceite modificações, confirme completude antes que o Usuário execute o procedimento de handover.

#### Visão Geral do Procedimento de Handover
Após confirmar completude, o Usuário abrirá uma nova sessão de chat, inicializará uma nova instância de Implementation Agent e colará o Prompt de Handover. Esta sessão de chat substituirá você como o Implementation Agent desta sessão APM.

---

## 4 Artefatos de Handover do Implementation Agent

### Visão Geral dos Artefatos de Handover
**Dois artefatos distintos são criados durante o handover:**
- **Prompt de Handover**: Apresentado **no chat** como bloco de código markdown para cópia e colagem para nova sessão
- **Arquivo de Handover**: Criado como **arquivo markdown físico** em estrutura de diretório dedicada
Crie os Artefatos de Handover seguindo estes templates:

### Template do Prompt de Handover do Implementation Agent
```markdown
# Handover de Implementation Agent APM - [Tipo do Agente]
Você está assumindo como [Tipo_do_Agente X+1] para execução contínua de tarefas do [Agente de Saída X].

## Protocolo de Integração de Contexto
1. **Leia .apm/guides/Memory_Log_Guide.md** para entender a estrutura de Registro de Memória e responsabilidades de registro do Implementation Agent
2. **Leia TODOS os Registros de Memória do agente de saída** (em ordem estritamente ascendente numérica e cronológica; por exemplo, revise Task X.1 antes de Task X.2) ([caminho/para/registros-de-memoria]) para entender histórico de execução de tarefas, resultados e bloqueadores
3. **Declare seu entendimento das suas responsabilidades de registro** baseado no guia e **aguarde confirmação do Usuário** para prosseguir à próxima etapa
4. **Leia o Arquivo de Handover** ([caminho/Tipo_do_Agente_Handover_File_X.md]) para contexto ativo de memória do agente de saída não capturado nos Registros de Memória

## Validação Cruzada
Compare a memória ativa do Arquivo de Handover contra seus Registros de Memória para resultados de execução de tarefas e contexto do ambiente de trabalho. Note contradições para esclarecimento com o Usuário.

## Contexto da Tarefa Atual
- **Última Tarefa Concluída:** [ID da Tarefa e status de conclusão]
- **Ambiente de Trabalho:** [Breve descrição da memória ativa]
- **Preferências do Usuário:** [Preferências-chave da memória ativa]

## Protocolo de Verificação do Usuário
Após síntese de contexto: faça 1-2 perguntas de garantia sobre precisão do histórico de execução de tarefas, se contradições forem encontradas faça perguntas específicas de esclarecimento, aguarde confirmação explícita do Usuário antes de prosseguir.

**Próxima Ação Imediata:** [Status atual - aguardando atribuição]

Confirme o recebimento e inicie o protocolo de integração de contexto imediatamente.
```

### Formato do Arquivo de Handover do Implementation Agent
```yaml
---
agent_type: Implementation
agent_id: Agent_[Nome]_[X]
handover_number: [X]
last_completed_task: [ID da Tarefa]
---
```
```markdown
# Arquivo de Handover do Implementation Agent - [Tipo do Agente]

## Contexto Ativo de Memória
**Preferências do Usuário:** [padrões de feedback, restrições, preferências de desenvolvimento]
**Insights de Trabalho:** [Descobertas sobre a base de código, padrões de fluxo de trabalho, problemas recorrentes, abordagens eficazes - tudo relativo às Atribuições de Tarefa recebidas]

## Contexto de Execução de Tarefa
**Ambiente de Trabalho:** [Localizações de arquivos, padrões da base de código, trechos de código importantes, configuração do ambiente de desenvolvimento, diretórios/arquivos/módulos-chave]
**Problemas Identificados:** [problemas resolvidos/persistentes, bugs persistentes, quaisquer delegações ad-hoc]

## Contexto Atual
**Diretivas Recentes do Usuário:** [Instruções não registradas do usuário, esclarecimentos, modificações de tarefa não capturadas nos Registros de Memória]
**Estado de Trabalho:** [Localizações de arquivo atuais, configuração de ambiente, configuração de ferramentas]
**Insights de Execução de Tarefa:** [Padrões descobertos durante execução de tarefas, abordagens eficazes, problemas a evitar]

## Notas de Trabalho
**Padrões de Desenvolvimento:** [Abordagens eficazes de codificação, soluções preferidas pelo usuário, estratégias bem-sucedidas]
**Configuração de Ambiente:** [Localizações-chave de arquivos, preferências de configuração, padrões de uso de ferramentas]
**Interação com Usuário:** [Padrões eficazes de comunicação, abordagens de esclarecimento, integração de feedback, preferências de explicação para áreas complexas]
```

---

## 5 Organização e Nomenclatura de Arquivos
Armazene os Arquivos de Handover do Implementation Agent em `.apm/Memory/Handovers/[Seu_Nome_de_Agente]_Handovers/`. Use a nomenclatura: `[Seu_Nome_de_Agente]_Handover_File_[Número].md`. **Prompts de Handover são apresentados no chat como blocos de código markdown para fluxo de trabalho de cópia e colagem.**