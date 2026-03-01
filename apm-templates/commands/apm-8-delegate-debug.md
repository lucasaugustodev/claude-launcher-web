---
priority: 8
command_name: delegate-debug
description: Fornece o template para delegar uma tarefa complexa de debugging a um Agente Ad-Hoc
---

# APM 0.5.4 - Guia de Delegação de Debug

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como os Implementation Agents delegam trabalho complexo de debugging para Agentes Ad-Hoc de Debug. Use este guia quando encontrar bugs maiores (> 2 trocas OU problemas imediatamente complexos/sistêmicos) conforme definido no Prompt de Iniciação do Implementation Agent ou se explicitamente definido no Prompt de Atribuição de Tarefa.

---

## 1  Visão Geral do Fluxo de Trabalho de Delegação
Agentes Ad-Hoc de Debug operam em **sessões de chat separadas** gerenciadas pelo Implementation Agent que delega:

### Gerenciamento de Branch
- **Operação Independente**: Agentes Ad-Hoc trabalham em sessões branch isoladas sem acesso ao contexto principal do projeto
- **Coordenação com Usuário**: O Usuário abre nova sessão de chat, cola o prompt de delegação, retorna com a solução
- **Preservação de Contexto**: A sessão de delegação permanece aberta para potencial redelegação até que o bug seja resolvido ou escalado

### Processo de Passagem
1. **Criar Prompt**: Use o template abaixo com contexto completo de debugging e detalhes do erro
2. **Usuário Abre Sessão**: O Usuário inicia novo chat Ad-Hoc de Debug e cola o prompt
3. **Debugger Trabalha**: O agente Ad-Hoc de fato debuga e resolve o problema, colaborando com o Usuário conforme necessário
4. **Usuário Retorna**: O Usuário traz a solução funcional de volta ao Implementation Agent para continuação da tarefa

---

## 2  Template do Prompt de Delegação
Apresente o prompt de delegação **no chat como um único bloco de código markdown com frontmatter YAML no topo** para cópia e colagem do Usuário para nova sessão Ad-Hoc de Debug

```markdown
---
bug_type: [crash|logic_error|performance|integration|environment|other]
complexity: [complex|systemic|unknown]
previous_attempts: [número de trocas de debugging já tentadas pelo Implementation Agent]
delegation_attempt: [1|2|3|...]
---

# Delegação de Debug: [Descrição Breve do Bug]

## Abordagem de Execução do Debug
**Objetivo Principal**: De fato resolver este bug para permitir continuação da tarefa, não pesquisar informações sobre debugging
**Solução Funcional Necessária**: Forneça correção funcional que o Implementation Agent possa incorporar imediatamente
**Debug ao Vivo**: Trabalhe com mensagens de erro reais, ambiente real e colaboração com o Usuário para resolver o problema
**Protocolo de Escalação**: Se o bug provar-se irresolúvel após tentativas minuciosas de debugging, documente descobertas para escalação

## Requisitos de Execução do Debug
**Execução de Terminal Obrigatória**: Execute as etapas de reprodução fornecidas usando seu acesso ao terminal. Siga as etapas listadas para reproduzir o bug você mesmo.
**Protocolo de Uso de Ferramentas**: Você tem acesso ao terminal e sistema de arquivos. Use essas ferramentas para reproduzir problemas em vez de solicitar colaboração do Usuário imediatamente.
**Debug Ativo**: Use ferramentas e comandos disponíveis para debugar ativamente em vez de recorrer à colaboração do usuário por padrão
**Orientado por Iniciativa**: Tome propriedade do processo de debugging e trabalhe em direção à resolução usando as capacidades do seu ambiente
**Colabore Quando Necessário**: Solicite assistência do Usuário apenas quando tentativas de reprodução falharem devido a limitações ambientais ou falta de acesso a dados específicos

## Colaboração com Usuário para Debug Complexo
**Abordagem Secundária**: Use quando tentativas iniciais de reprodução e debugging requerem suporte adicional
**Quando Colaborar**: Após tentar reprodução, se o bug provar-se complexo e precisar de diagnóstico em ambiente ao vivo ou ações fora do seu ambiente IDE
**Ações Disponíveis do Usuário**: Solicite saídas de comandos do terminal, logs de erro, conteúdo de arquivos, comandos de diagnóstico e inspeção de ambiente
**Resolução Interativa de Problemas**: Guie o Usuário através de processo de debugging passo a passo, analise resultados e itere até a resolução

## Contexto do Bug
[Descreva o que o código/sistema deveria fazer, onde o bug ocorre e que execução de tarefa está bloqueada]

## Etapas de Reprodução
1. [Instruções passo a passo para reproduzir o bug]
2. [Inclua entradas específicas, condições ou gatilhos]
3. [Note quaisquer dependências de ambiente ou requisitos de setup]

## Comportamento Atual vs Esperado
- **Atual**: [O que realmente acontece - inclua mensagens de erro EXATAS, stack traces ou sintomas de falha]
- **Esperado**: [O que deveria acontecer para a tarefa continuar com sucesso]

## Tentativas de Debug Que Falharam
[Documente tentativas de debugging já feitas pelo Implementation Agent:]
- [Tentativas de solução específicas e seus resultados]
- [Padrões de erro observados durante debugging]
- [Insights obtidos sobre causas raiz potenciais]

## Contexto de Ambiente
[Linguagem de programação, versões de framework, SO, dependências, mudanças recentes e quaisquer fatores específicos de ambiente]

## Contexto de Código/Arquivo
[Forneça trechos de código relevantes, caminhos de arquivo, arquivos de configuração ou componentes do sistema envolvidos no bug]

## Descobertas de Delegação Anteriores
[Incluir apenas se delegation_attempt > 1]
[Resuma tentativas de debug anteriores: o que foi tentado, o que foi descoberto, por que o bug permanece não resolvido]

## Nota de Execução da Delegação
**Siga exatamente o fluxo de trabalho do seu prompt de iniciação**: Complete a Etapa 1 (avaliação/confirmação de escopo), Etapa 2 (debugging real + solução + solicitação de confirmação) e Etapa 3 (entrega final da solução) como respostas separadas.
```

### Confirmação de Entrega
Após apresentar o prompt de delegação no chat, explique o fluxo de trabalho ad-hoc ao Usuário:
1. Copie o bloco de código markdown completo contendo o prompt de delegação
2. Abra nova sessão de chat do agente Ad-Hoc e inicialize-a com .claude/commands/apm-4-initiate-adhoc.md
3. Cole o prompt de delegação para iniciar o trabalho ad-hoc
4. Retorne com as descobertas para integração

---

## 3  Protocolo de Integração e Redelegação
Quando o Usuário retornar com as descobertas do Agente Ad-Hoc, siga estas etapas:

### Integração da Solução
- **Aplicar Solução Funcional**: Implemente a correção fornecida e verifique a resolução do bug no contexto da tarefa
- **Continuar Execução da Tarefa**: Retome a tarefa a partir do ponto onde o bug bloqueou o progresso
- **Documentar Resolução**: Registre o processo de debugging e a solução no Registro de Memória da tarefa

### Framework de Decisão de Redelegação
**Bug Resolvido**: Encerre a sessão de delegação, continue com a conclusão da tarefa usando a solução fornecida
**Bug Parcialmente Resolvido**: Se a correção estiver incompleta, refine o prompt com novas descobertas e redelogue:
- **Incorporar Progresso de Debug**: Atualize "Descobertas de Delegação Anteriores" com descobertas específicas e soluções parciais
- **Refinar Contexto do Problema**: Adicione detalhes descobertos durante tentativas de debugging
- **Incrementar Contador**: Atualize o campo `delegation_attempt` no YAML

**Bug Irresolúvel**: Se a delegação retornar descobertas de escalação, pare a execução da tarefa e escale ao Manager Agent

### Critérios de Encerramento de Sessão
- **Sucesso**: Bug resolvido com solução funcional, execução da tarefa pode continuar
- **Limite de Recursos**: Após 3-4 tentativas de delegação sem resolução
- **Escalação**: O agente Ad-Hoc determina que o bug é irresolúvel e fornece documentação de escalação

### Protocolo de Escalação
Quando o agente Ad-Hoc de Debug retornar descobertas indicando bug irresolúvel:
- **Pare a execução da tarefa imediatamente**
- **Preserve contexto de debugging** para potenciais tentativas futuras de resolução
- **Registre bloqueador técnico e contexto** no Registro de Memória com referência da sessão de delegação e análise de causa raiz
- **Usuário reporta ao Manager Agent** para reatribuição de tarefa, modificação de plano ou escalação técnica

### Requisitos de Registro de Memória
Documente no Registro de Memória da tarefa:
- **Descrição do Bug**: Problema original que bloqueou a execução da tarefa
- **Resumo da Sessão de Debug**: Número de tentativas, abordagem de colaboração e descobertas técnicas
- **Solução Aplicada**: Correção funcional fornecida e como permite continuação da tarefa
- **Status da Sessão**: Resolvido com solução OU escalado com detalhes técnicos

---

**Fim do Guia**