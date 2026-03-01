---
priority: 7
command_name: delegate-research
description: Fornece o template para delegar uma tarefa de pesquisa a um Agente Ad-Hoc
---

# APM 0.5.4 - Guia de Delegação de Pesquisa

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como os Implementation Agents delegam trabalho de pesquisa para Agentes Ad-Hoc de Pesquisa. Use este guia quando encontrar lacunas de conhecimento sobre documentação atual, APIs, SDKs ou especificações técnicas necessárias para conclusão da tarefa.

---

## 1  Visão Geral do Fluxo de Trabalho de Delegação
Agentes Ad-Hoc de Pesquisa operam em **sessões de chat separadas** gerenciadas pelo Implementation Agent que delega:

### Gerenciamento de Branch
- **Operação Independente**: Agentes Ad-Hoc trabalham em sessões branch isoladas sem acesso ao contexto principal do projeto
- **Coordenação com Usuário**: O Usuário abre nova sessão de chat, cola o prompt de delegação, retorna com as descobertas
- **Preservação de Contexto**: A sessão de delegação permanece aberta para potencial redelegação até fechamento formal

### Processo de Passagem
1. **Criar Prompt**: Use o template abaixo com contexto completo de pesquisa
2. **Usuário Abre Sessão**: O Usuário inicia novo chat Ad-Hoc de Pesquisa e cola o prompt
3. **Pesquisador Trabalha**: O agente Ad-Hoc investiga fontes e fornece informações/descobertas atuais colaborando com o Usuário
4. **Usuário Retorna**: O Usuário traz as descobertas de volta ao Implementation Agent para integração

---

## 2  Template do Prompt de Delegação
Apresente o prompt de delegação **no chat como um único bloco de código markdown com frontmatter YAML no topo** para cópia e colagem do Usuário para nova sessão Ad-Hoc de Pesquisa

```markdown
---
research_type: [documentation|api_spec|sdk_version|integration|compatibility|best_practices|other]
information_scope: [targeted|comprehensive|comparative]
knowledge_gap: [outdated|missing|conflicting]
delegation_attempt: [1|2|3|...]
---

# Delegação de Pesquisa: [Tópico Breve de Pesquisa]

## Contexto da Pesquisa
[Descreva quais informações são necessárias e por que são obrigatórias para conclusão da tarefa]

## Abordagem de Execução da Pesquisa
**Objetivo Principal**: Coletar informações atuais e autoritativas que os Implementation Agents precisam para prosseguir com a execução da tarefa
**Entrega de Informações Necessária**: Forneça documentação pesquisada, melhores práticas ou especificações técnicas para uso do Implementation Agent
**Foco em Informações Atuais**: Acesse fontes oficiais e documentação recente em vez de fornecer orientação teórica
**Transferência de Conhecimento**: Entregue descobertas estruturadas que respondam diretamente às perguntas do Implementation Agent para permitir continuação da tarefa

## Requisitos de Execução da Pesquisa
**Uso Obrigatório de Ferramentas**: Você deve usar ferramentas de busca web e fetch web para acessar documentação oficial atual e verificar informações. Não confie apenas em dados de treinamento ou conhecimento prévio.
**Padrão de Informação Atual**: Todas as descobertas devem ter origem em documentação oficial, repositórios GitHub ou fontes autoritativas e confiáveis acessadas durante esta sessão de pesquisa.
**Protocolo de Verificação**: Cruze referências de múltiplas fontes atuais para garantir precisão e atualidade das informações.

## Estado Atual do Conhecimento
[O que o Implementation Agent atualmente sabe/assume vs o que é incerto ou potencialmente desatualizado]

## Perguntas Específicas de Pesquisa
[Liste perguntas direcionadas que precisam de resposta, seja específico sobre o que você precisa saber]

## Fontes Esperadas
[Liste sites de documentação específicos, repos oficiais do GitHub, docs de API ou recursos confiáveis para o agente Ad-Hoc investigar]

## Requisitos de Integração
[Explique como as descobertas da pesquisa serão aplicadas à tarefa atual]

## Descobertas de Pesquisa Anteriores
[Incluir apenas se delegation_attempt > 1]
[Resuma descobertas de tentativas anteriores de pesquisa Ad-Hoc e por que foram inadequadas]

## Nota de Execução da Delegação
**Siga exatamente o fluxo de trabalho do seu prompt de iniciação**: Complete a Etapa 1 (avaliação/confirmação de escopo), Etapa 2 (execução + descobertas + solicitação de confirmação) e Etapa 3 (entrega final em markdown) como respostas separadas.
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

### Integração de Informações
- **Validar Atualidade**: Garanta que as informações são atuais e de fontes autoritativas
- **Verificar Acionabilidade**: Confirme que as descobertas podem ser diretamente aplicadas ao contexto da tarefa
- **Documentação**: Registre o processo de delegação e resultados da pesquisa no Registro de Memória da tarefa

### Framework de Decisão de Redelegação
**Informação Adequada**: Encerre a sessão de delegação, prossiga com a conclusão da tarefa usando as descobertas da pesquisa
**Informação Inadequada**: Refine o prompt usando descobertas do Ad-Hoc e redelogue ao mesmo Agente Ad-Hoc:
- **Incorporar Insights**: Atualize a seção "Descobertas de Pesquisa Anteriores" com aprendizados específicos
- **Refinar Perguntas**: Adicione consultas mais específicas baseadas nas lacunas iniciais da pesquisa
- **Incrementar Contador**: Atualize o campo `delegation_attempt` no YAML

### Critérios de Encerramento de Sessão
- **Sucesso**: Informação atual e acionável encontrada e validada para o contexto da tarefa
- **Limite de Recursos**: Após 3-4 tentativas de delegação sem informação adequada
- **Escalação**: Escalação formal ao Manager Agent com referência da sessão de delegação para lacunas persistentes de conhecimento

### Requisitos de Registro de Memória
Documente no Registro de Memória da tarefa:
- **Justificativa da Pesquisa**: Por que a pesquisa foi delegada e quais informações eram necessárias
- **Resumo da Sessão**: Número de tentativas e principais descobertas
- **Informação Aplicada**: Como as descobertas da pesquisa foram integradas à conclusão da tarefa
- **Status da Sessão**: Encerrada com informação adequada OU escalada com referência da sessão

---

**Fim do Guia**