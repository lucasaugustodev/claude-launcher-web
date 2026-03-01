# APM 0.5.4 - Guia do Sistema de Memória

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia explica como as sessões APM armazenam e evoluem a memória usando o sistema **Dynamic-MD**.

As responsabilidades de memória são atribuídas ao *Manager Agent* - que mantém o sistema. Detalhes sobre arquivos individuais de Registro de Memória estão em .apm/guides/Memory_Log_Guide.md.

## 1  Visão Geral do Sistema de Memória
O Sistema de Memória Dynamic-MD organiza a memória com a seguinte estrutura:

- **Layout de armazenamento:** Pasta `.apm/Memory/` + `Memory_Root.md` + subpastas `Phase_XX_<slug>/` no diretório `.apm/`
- **Formato de registro:** Um `Task_XX_<slug>.md` de Registro de Memória por tarefa
- **Sumarização:** Após cada fase ser concluída, uma subseção inline é adicionada ao arquivo `Memory_Root.md` resumindo a fase

**Registros de Memória** capturam contexto granular no nível de tarefa e são escritos pelos Implementation Agents após cada conclusão de tarefa. Consulte .apm/guides/Memory_Log_Guide.md para esquemas e regras de escrita.

## 2  Responsabilidades do Manager Agent
Principais responsabilidades do Manager Agent ao manter o Sistema de Memória durante uma sessão APM:

1. **Inicialização do Cabeçalho do Memory Root (Apenas Primeira Sessão)**: Antes de iniciar a execução da primeira fase, preencha o cabeçalho de `.apm/Memory/Memory_Root.md`. O arquivo é pré-criado pela ferramenta CLI `agentic-pm` usando `apm init`, com um template de cabeçalho contendo placeholders. Substitua todos os placeholders por valores reais antes de prosseguir para a execução da fase.

2. Manter a estrutura do Sistema de Memória (pastas/registros) sincronizada com o Plano de Implementação atual. Atualizar conforme Fases ou Tarefas mudem.

3. Após cada fase, criar e adicionar um resumo conciso referenciando os Registros de Memória relevantes.

### Gerenciamento de Fases e Tarefas
**Nota**: O cabeçalho do Memory Root deve ser preenchido antes do início da execução da primeira fase (ver responsabilidade #1 acima).

1. Na entrada da fase, criar `.apm/Memory/Phase_XX_<slug>/` se ausente. Para cada tarefa na fase, criar um Registro de Memória **completamente vazio**, seguindo .apm/guides/Memory_Log_Guide.md:
    - `Task_Y_Z_<slug>.md`

**Todos os Registros de Memória da fase atual devem ser criados ANTES do primeiro Prompt de Atribuição de Tarefa para cada tarefa.**
**Use o ID e título da tarefa do Plano de Implementação (exclua a atribuição do agente).**
**Exemplo: Tarefa "Task 2.1 - Deploy de Atualizações | Agent_Backend" → `Task_2_1_Deploy_Updates.md`**

2. Após cada execução de tarefa, revisar o Registro de Memória **preenchido pelo Implementation Agent**, fornecido via Usuário.
   - Se o registro contiver `important_findings: true` ou `compatibility_issues: true`, você **DEVE** inspecionar os arquivos de saída/artefatos referenciados para validar as descobertas antes de tomar uma decisão.


3. No final da fase, adicionar um resumo a `.apm/Memory/Memory_Root.md`:
    ```markdown
    ## Fase XX – <Nome da Fase> Resumo
    * Resumo do resultado (≤ 200 palavras)
    * Lista de Agentes envolvidos
    * Links para todos os registros de tarefas da fase
    ```
    Mantenha os resumos ≤30 linhas.

---

**Fim do Guia**