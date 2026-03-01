# APM 0.5.4 - Guia de Registro de Memória

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como os Implementation Agents registram seu trabalho para os Manager Agents e Usuários. Os Registros de Memória capturam contexto no nível de tarefa usando o formato **Dynamic-MD**.

Tanto os Manager Agents quanto os Implementation Agents devem ler este guia durante a inicialização da sessão. Os Implementation Agents o referenciam ao registrar; os Manager Agents o utilizam ao revisar registros.

## 1. Visão Geral do Sistema de Memória
Resumo da variante Dynamic-MD do Sistema de Memória, seu layout de armazenamento e formato de registro:

- Armazenamento: pasta `.apm/Memory/` com subpastas `Phase_XX_<slug>/`
- Formato: Um arquivo `Task_XX_<slug>.md` por tarefa (Markdown)

Os Registros de Memória são preenchidos pelos Implementation Agents após cada execução de tarefa ou quando bloqueadores ocorrem. Os Manager Agents revisam os registros para acompanhar o progresso e planejar os próximos passos.

## 2. Formato de Registro de Memória Dynamic-MD
Todas as entradas de Registro de Memória devem seguir uma estrutura precisa para garantir clareza, rastreabilidade e retenção de contexto. Para o Sistema de Memória Dynamic-MD, cada registro fica em um arquivo dedicado criado vazio pelo Manager Agent, depois preenchido pelo Implementation Agent. Use Markdown analisável com front-matter YAML e formatação mínima. Inclua seções opcionais apenas quando seu booleano no front-matter for true:

### 2.1 Flags do Frontmatter
- `important_findings: [true|false]` -> Defina como **true** se você descobriu restrições arquiteturais, novos requisitos ou contexto crítico que necessita de revisão adicional pelo Manager.
- `compatibility_issues: [true|false]` -> Defina como **true** se a saída da tarefa conflita com sistemas existentes ou requer atualização do plano.


### Template de Registro de Memória
```yaml
---
agent: [ID do Agente]
task_ref: [Task_ID]
status: [Completed|Partial|Blocked|Error]
ad_hoc_delegation: [true|false]
compatibility_issues: [true|false]
important_findings: [true|false]
---
```
```markdown

# Registro da Tarefa: [Referência da Tarefa]

## Resumo
[1-2 frases descrevendo o resultado principal]

## Detalhes
[Trabalho realizado, decisões tomadas, etapas executadas em ordem lógica]

## Saída
- Caminhos dos arquivos criados/modificados
- Trechos de código (se necessário, ≤ 20 linhas)
- Alterações de configuração
- Resultados ou entregas

## Problemas
[Bloqueadores específicos ou erros, incluir mensagens de erro se relevante, ou "Nenhum"]

## Preocupações de Compatibilidade
[Incluir esta seção apenas se compatibility_issues: true]
[Quaisquer problemas de compatibilidade identificados]

## Delegação Ad-Hoc
[Incluir esta seção apenas se ad_hoc_delegation: true]
[Detalhes de qualquer delegação de agente que ocorreu durante esta tarefa]

## Descobertas Importantes
[Incluir esta seção apenas se important_findings: true]
[Informações relevantes ao projeto descobertas durante o trabalho que o Manager deve saber]

## Próximos Passos
[Ações de acompanhamento ou instruções para o próximo agente ou "Nenhum"]
```

## 3. Fluxo de Trabalho do Implementation Agent
Principais responsabilidades e etapas do fluxo de trabalho dos Implementation Agents ao trabalhar com o Sistema de Memória:

1. **Receber Atribuição de Tarefa:** O Manager Agent fornece um prompt de tarefa via Usuário com o `memory_log_path` especificado no frontmatter YAML apontando para um arquivo de registro vazio.
2. **Executar Tarefa:** Trabalhar na tarefa atribuída conforme descrito no Prompt de Atribuição de Tarefa. Completar a tarefa ou anotar quaisquer problemas, bloqueadores ou bugs que impeçam a conclusão.
3. **Atualizar Registro:** Preencher todos os campos obrigatórios no arquivo de registro fornecido usando o formato correto definido na seção 2.
4. **Relatar Resultado:** Notificar o Usuário sobre a conclusão da tarefa ou problemas, confirmando que o Registro de Memória foi atualizado.

## 4. Fluxo de Trabalho do Manager Agent
Principais responsabilidades e etapas do fluxo de trabalho dos Manager Agents ao manter o Sistema de Memória:

1. **Criar Registros Vazios:** No início de cada fase, criar arquivos de registro **completamente vazios** (ou seções inline) para todas as tarefas da fase. **NÃO preencha nenhum conteúdo.** Os Implementation Agents preencherão toda a estrutura ao executar as tarefas.
2. **Anexar às Atribuições:** Incluir o caminho apropriado do arquivo de registro vazio (ou seção inline) com cada prompt de atribuição de tarefa enviado aos Implementation Agents.
3. **Revisar Registros Concluídos:** Quando o Usuário retornar com uma tarefa concluída, revisar o conteúdo do registro para:
  - Se `important_findings` ou `compatibility_issues` forem **true**, você é obrigado a ler os arquivos e artefatos referenciados para validar o contexto antes de tomar decisões.
  - Status de conclusão e qualidade da tarefa
  - Quaisquer bloqueadores ou problemas que requerem atenção
  - Saídas que informam atribuições de tarefas subsequentes
4. **Decidir Próxima Ação:** Com base na revisão do registro, determinar se deve:
  - Enviar prompt de acompanhamento para o mesmo agente (se a tarefa foi bloqueada ou precisa de refinamento)
  - Atribuir agente ad-hoc para trabalho especializado ou resolução de problemas
  - Continuar com a próxima tarefa planejada (se tudo estiver bem)

## 5. Diretrizes de Conteúdo

### 5.1. Escrevendo de Forma Concisa e Eficaz
- Resuma resultados em vez de listar cada etapa
- Foque em decisões-chave e razões, especialmente se os planos mudaram
- Referencie artefatos pelo caminho, evite blocos de código grandes
- Inclua trechos de código apenas para lógica nova, complexa ou crítica (≤ 20 linhas)
- Vincule ações aos requisitos da descrição da tarefa quando relevante
- Inclua explicações valiosas fornecidas durante a execução da tarefa quando oferecerem insights ao usuário

### 5.2. Tratamento de Código e Saída
- Para alterações de código: mostre trechos relevantes com caminhos de arquivo, não arquivos inteiros
- Para saídas grandes: salve em arquivo separado e referencie o caminho
- Para mensagens de erro: inclua stack traces ou detalhes de erro relevantes
- Para configurações: anote as configurações-chave alteradas e o motivo

### 5.3. Problemas e Bloqueadores
Ao registrar bloqueadores ou erros:
- Seja específico sobre o que impediu a conclusão
- Forneça informações acionáveis para o Manager Agent
- Inclua mensagens de erro ou informações diagnósticas
- Sugira soluções potenciais se possível

### 5.4. Comparação de Qualidade de Exemplo

- Registro ruim: "Trabalhei no endpoint da API. Fiz algumas alterações no arquivo. Houve alguns problemas mas eu os corrigi. O endpoint funciona agora."

- Bom Registro:
```markdown
---
agent: Agent_Backend
task_ref: Task 2.3
status: Completed
ad_hoc_delegation: false
compatibility_issues: false
important_findings: false
---

# Registro da Tarefa: Task 2.3 - Endpoint de Usuário da API

## Resumo
Implementei o endpoint POST /api/users com validação de entrada e corrigi problemas de CORS que bloqueavam requisições do frontend.

## Detalhes
- Adicionei rota de registro de usuário em routes/users.js usando express-validator para verificações de email e senha
- Atualizei configurações de CORS no server.js para permitir integração com frontend
- Testei endpoint com dados válidos/inválidos para confirmar validação e correções de CORS

## Saída
- Arquivos modificados: routes/users.js, server.js
- Funcionalidade do endpoint: Aceita {email, password, name}; valida entrada; retorna 201 em sucesso, 400 em erro
- Lógica de validação chave adicionada para formato de email, comprimento de senha e campo de nome obrigatório

## Problemas
Nenhum

## Próximos Passos
- Adicionar testes unitários/integração para validação e CORS
- Atualizar documentação da API para novo endpoint
```

---

**Fim do Guia**