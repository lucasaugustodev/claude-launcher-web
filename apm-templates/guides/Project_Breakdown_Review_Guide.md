# APM 0.5.4 - Guia de Revisão da Divisão do Projeto

> **Idioma de comunicação**: Todos os agentes devem se comunicar sempre em português brasileiro com o usuário.

Este guia define como os Setup Agents conduzem revisão direcionada e selecionada pelo usuário dos Planos de Implementação para detectar e corrigir problemas críticos de qualidade de tarefas antes do aprimoramento. Usando contexto fresco da criação do Plano de Implementação, os agentes propõem áreas específicas para revisão sistemática e permitem que os usuários escolham quais seções recebem análise detalhada.

---

## 1. Visão Geral do Protocolo de Revisão

### Propósito da Revisão
Conduzir revisão sistemática em porções selecionadas pelo usuário do Plano de Implementação para identificar e corrigir problemas críticos de qualidade de tarefas:
- Violações de empacotamento de tarefas (múltiplas atividades distintas em uma tarefa)
- Erros de classificação (designação errada de etapa única vs múltiplas etapas)
- Padrões de correspondência de template (formatação rígida entre tarefas)
- Falhas de conformidade com requisitos do usuário (requisitos da Síntese de Contexto ausentes)
- Erros de escopo de execução de tarefa (suposições sobre plataformas externas)

### Metodologia de Revisão Orientada por Contexto
**Proposta do Agente → Seleção do Usuário → Revisão Sistemática Direcionada → Correção Abrangente**

**Fluxo de Trabalho da Revisão:**
1. **Proposta Inteligente**: O agente analisa o contexto fresco do Plano de Implementação para recomendar áreas de revisão
2. **Seleção do Usuário**: O usuário escolhe quais tarefas/fases recebem revisão sistemática
3. **Análise Sistemática**: Aplique a metodologia completa de testes apenas às áreas selecionadas
4. **Correção Abrangente**: Corrija todos os problemas nas áreas selecionadas, garanta aderência estrita ao formato estabelecido
5. **Revisão Final do Usuário**: Apresente o plano atualizado completo para aprovação

**Eficiência**: Poder completo de revisão sistemática aplicado apenas onde mais valioso

---

## 2. Proposta Inteligente de Áreas de Revisão

### 2.1. Análise de Contexto para Geração de Propostas
**Aproveite o contexto fresco de criação do Plano de Implementação para identificar alvos de revisão de alto valor:**

**Consciência de Contexto Imediata:**
- **Tarefas Multi-Etapas Complexas**: Tarefas com 6+ etapas que podem precisar de divisão
- **Abrangência Tecnológica**: Tarefas cobrindo múltiplos domínios ou áreas de habilidade
- **Itens de Caminho Crítico**: Tarefas com múltiplas dependências ou passagens entre agentes
- **Áreas de Requisitos do Usuário**: Seções contendo elementos enfatizados da Síntese de Contexto
- **Pontos de Integração Externa**: Tarefas envolvendo deploy, configuração ou coordenação de plataformas

### 2.2. Categorias de Proposta
**Recomende áreas de revisão baseadas em padrões detectados:**

**Áreas de Alta Complexidade:**
- Fases com múltiplas tarefas de 6+ etapas
- Tarefas abrangendo diferentes domínios tecnológicos
- Seções com dependências densas entre agentes

**Áreas de Caminho Crítico:**
- Tarefas que bloqueiam múltiplas outras tarefas
- Pontos de passagem entre agentes
- Tarefas de integração com plataformas externas

**Áreas de Requisitos do Usuário:**
- Seções implementando requisitos enfatizados da Síntese de Contexto
- Tarefas envolvendo preferências ou restrições específicas do usuário

**Áreas de Preocupação com Padrões:**
- Grupos de tarefas com formatação idêntica
- Seções que podem ter problemas de correspondência de template

### 2.3. Formato de Apresentação de Propostas
**Apresente recomendações claras e acionáveis ao usuário:**

**Estrutura do Formato:**
```markdown
## Recomendações de Revisão Sistemática

Baseado no Plano de Implementação que acabei de criar, recomendo revisão sistemática para:

**Áreas de Alta Complexidade:**
- **[ID da Fase/Tarefa]** ([indicadores de complexidade: contagem de multi-etapas, abrangência de domínio, etc.])
- **[ID da Fase/Tarefa]** ([raciocínio específico de complexidade])

**Áreas de Caminho Crítico:**
- **[ID da Fase/Tarefa]** ([descrição de dependência e impacto])
- **[ID da Fase/Tarefa]** ([requisitos de coordenação externa])

**Integração de Requisitos do Usuário:**
- **[ID da Fase/Tarefa]** ([requisitos específicos da Síntese de Contexto implementados])

**Preocupações com Padrões:**
- **[Intervalo de Tarefas]** ([problemas de correspondência de template ou formatação identificados])

**Recomendação:** Foque a revisão sistemática em [seleções de maior valor] para máximo impacto.

**Sua Escolha:** Selecione qualquer combinação das recomendações acima, ou especifique outras tarefas/fases que você gostaria de revisar. Aplicarei análise sistemática completa apenas às suas áreas selecionadas.
```

**Diretrizes de Proposta:**
- Limite recomendações a 4-6 itens máximo para tomada de decisão clara
- Forneça raciocínio específico para cada recomendação
- Destaque 1-2 prioridades principais para orientação do usuário
- Sempre ofereça flexibilidade ao usuário para modificar seleções

---

## 3. Processo de Seleção do Usuário

### 3.1. Opções de Seleção
**Seleção flexível permitindo controle do usuário:**

**Formatos de Seleção que o Usuário Pode Escolher:**
- **Seleção de Fase Completa**: "Revise [Fase X]" (todas as tarefas na fase especificada)
- **Múltiplas Fases**: "Revise [Fases X e Y]" (múltiplas fases completas)
- **Tarefas Individuais**: "Revise [Task X.Y] e [Task Z.A]" (seleções de tarefas específicas)
- **Intervalos de Tarefas**: "Revise [Tasks X.Y-X.Z]" (grupos sequenciais de tarefas)
- **Combinações Mistas**: "Revise [Fase X] e [Task Y.Z]" (fases mais tarefas individuais)
- **Abordagem por Exclusão**: "Revise tudo exceto [identificadores de Fase/Tarefa]" (abrangente menos exclusões)

**Capacidades Adicionais de Seleção:**
- O usuário pode adicionar tarefas não incluídas nas recomendações do agente
- O usuário pode solicitar foco em aspectos específicos (classificação, empacotamento, integração de requisitos)
- O usuário pode modificar recomendações do agente adicionando ou removendo itens

### 3.2. Confirmação de Seleção
**Confirmação clara do escopo de revisão antes de prosseguir:**

**Formato de Confirmação:**
```markdown
**Selecionado para Revisão Sistemática:**
- [Seleções de fase/tarefa com contagem de tarefas]
- [Seleções de tarefas individuais]
- [Quaisquer áreas de foco especial solicitadas]

**Total:** [X] tarefas recebendo análise sistemática completa
**Prosseguindo com revisão sistemática das áreas selecionadas...**
```

**Requisitos de Confirmação:**
- Liste todas as fases e tarefas individuais selecionadas
- Forneça contagem total de tarefas para clareza de escopo
- Confirme quaisquer áreas de foco especial ou restrições
- Obtenha aprovação explícita do usuário antes de prosseguir

---

## 4. Análise Sistemática (Apenas Áreas Selecionadas)

### 4.1. Metodologia Crítica de Revisão
**Questione decisões anteriores usando questionamento analítico para identificar melhorias genuínas:**

**CRÍTICO**: O Setup Agent acabou de criar essas tarefas usando raciocínio específico. A revisão sistemática deve questionar analiticamente esse raciocínio para encontrar oportunidades genuínas de melhoria, não simplesmente confirmar decisões anteriores.

### 4.2. Framework de Teste Analítico
**Para cada tarefa selecionada, aplique questionamento analítico estruturado:**

**Task [X.Y]: [Nome da Tarefa] - Revisão Sistemática**

**Análise de Escopo:**
- **Decisão Atual**: "Para esta tarefa, escolhi [decisão de escopo]. Por que isso não é [abordagem alternativa de escopo]?"
- **Avaliação de Complexidade**: "Esta tarefa tem [X] etapas/componentes. Posso dividi-la em 2 ou mais tarefas focadas? Quais seriam os benefícios/desvantagens?"
- **Avaliação de Domínio**: "Atribuí esta ao [Agente]. O [Agente Alternativo] seria mais adequado? Que conhecimento de domínio específico isto requer?"

**Análise de Classificação:**
- **Formato Atual**: "Escolhi formato de [etapa única/múltiplas etapas]. Quais fatores específicos suportam/desafiam esta classificação?"
- **Pontos de Validação**: "Esta tarefa precisa de pontos de confirmação do usuário? Onde um Implementation Agent poderia ficar travado sem orientação?"
- **Eficiência do Fluxo de Trabalho**: "Isto seria mais eficiente como [classificação alternativa]? Que validação é realmente necessária?"

**Viabilidade de Implementação:**
- **Capacidade do Agente**: "Quais suposições específicas estou fazendo sobre as capacidades do Implementation Agent? Quais suposições podem estar incorretas?"
- **Requisitos de Contexto**: "Se um Implementation Agent receber esta tarefa com contexto mínimo, o que ele precisaria esclarecido?"
- **Desafios de Execução**: "Quais são os pontos mais prováveis de falha durante a execução da tarefa? Como a especificação da tarefa pode abordar estes?"
- **Meta-Campos**: "Os campos 'Objective', 'Output' e 'Guidance' fornecem direção clara e concisa para o Manager Agent?"

**Integração de Requisitos:**
- **Alinhamento com Síntese de Contexto**: "Quais requisitos da Síntese de Contexto se aplicam a esta tarefa? Eles estão explicitamente integrados ou assumidos?"
- **Coordenação com Usuário**: "Quais ações externas esta tarefa requer? As etapas de coordenação com o usuário estão claramente especificadas?"
- **Clareza da Saída**: "As saídas da tarefa são específicas o suficiente para o próximo Implementation Agent integrar? O que poderia ser ambíguo?"

**Abordagens Alternativas:**
- **Organização Diferente**: "Este trabalho poderia ser estruturado como [abordagem alternativa]? Quais seriam as vantagens?"
- **Otimização de Dependências**: "As dependências para esta tarefa estão otimizadas? A reorganização poderia reduzir a sobrecarga de coordenação?"

### 4.3. Execução da Análise Sistemática
**Aplique o framework analítico a cada tarefa selecionada:**

**Task [X.Y]: [Nome da Tarefa] - Resultados da Análise**

1. **Resultados da Análise de Escopo**:
   - Consideração de Escopo Alternativo: [Análise e decisão]
   - Avaliação de Divisão de Tarefa: [Benefícios/desvantagens avaliados, decisão com raciocínio]
   - Revisão de Atribuição de Agente: [Análise de adequação de domínio e confirmação/mudança]

2. **Resultados da Análise de Classificação**:
   - Justificativa de Formato: [Fatores suportando a classificação atual ou mudança necessária]
   - Avaliação de Pontos de Validação: [Necessidades de confirmação do usuário analisadas]
   - Avaliação de Eficiência: [Oportunidades de otimização de fluxo de trabalho identificadas/confirmadas]

3. **Resultados de Viabilidade de Implementação**:
   - Revisão de Suposições de Capacidade: [Suposições validadas ou correções identificadas]
   - Análise de Requisitos de Contexto: [Esclarecimentos necessários ou suficiência confirmada]
   - Mitigação de Pontos de Falha: [Problemas potenciais identificados e abordados]

4. **Resultados de Integração de Requisitos**:
   - Integração da Síntese de Contexto: [Requisitos explicitamente adicionados ou integração confirmada]
   - Clareza de Coordenação com Usuário: [Etapas de ação externa esclarecidas ou confirmadas]
   - Revisão de Especificação de Saída: [Ambiguidades resolvidas ou clareza confirmada]

5. **Resultados de Abordagens Alternativas**:
   - Alternativas Estruturais: [Abordagens alternativas consideradas, atual justificada ou alterada]
   - Otimização de Dependências: [Melhorias de coordenação identificadas ou atual confirmada]

**Avaliação Geral**: [Melhorias implementadas / Abordagem atual validada com raciocínio específico]

### 4.4. Requisitos de Aprimoramento de Qualidade
**Garanta questionamento construtivo de decisões anteriores:**

**Padrões Analíticos:**
- Cada tarefa selecionada deve ser examinada de múltiplas perspectivas analíticas baseadas em §4.2 e §4.3
- Decisões atuais devem ser explicitamente justificadas quando mantidas
- Abordagens alternativas devem ser genuinamente consideradas, não descartadas

**Análise Baseada em Evidências:**
- "Inicialmente escolhi a abordagem X baseado no raciocínio Y. Após revisão, a consideração Z sugere a melhoria A"
- "Embora a estrutura atual pareça sólida, a análise de viabilidade de implementação revela oportunidade de otimização B"
- "A revisão de especificação da tarefa confirma adequação mas identifica aprimoramento C para clareza do Implementation Agent"
- "As escolhas atuais estão corretas por causa dos fatores X, Y e Z; a análise de alternativas indica que nenhuma outra abordagem forneceria benefício adicional neste contexto"

**Processo de Questionamento Construtivo:**
- Questione cada decisão significativa tomada durante a criação inicial da tarefa
- Considere a perspectiva do Implementation Agent ao longo da análise
- Identifique oportunidades específicas de melhoria em vez de críticas gerais
- Mantenha o foco no sucesso e clareza da execução da tarefa

### 4.5. Documentação de Problemas
**Rastreie todas as melhorias identificadas nas áreas selecionadas:**

**Formato de Documentação:**
```markdown
**Melhorias Identificadas nas Áreas Selecionadas:**
- [ID da Tarefa]: [Tipo de melhoria] ([aprimoramento aplicado])
- [ID da Tarefa]: [Otimização identificada] ([modificação feita])
- [Intervalo de Tarefas]: [Melhoria de padrão] ([aprimoramento sistemático aplicado])
```

**Requisitos de Documentação:**
- Liste cada tarefa com melhorias identificadas durante a revisão sistemática
- Especifique o tipo de melhoria (otimização de escopo, refinamento de classificação, integração de requisitos, etc.)
- Documente o aprimoramento específico aplicado
- Agrupe melhorias similares para clareza
- Note tarefas onde a abordagem atual foi validada através da análise

---

## 5. Correção Abrangente e Aplicação de Padrões

### 5.1. Correções nas Áreas Selecionadas
**Aplique todas as correções identificadas às tarefas selecionadas:**

- Corrija violações de empacotamento através de divisão de tarefas
- Corrija erros de classificação
- Adicione requisitos do usuário ausentes
- Resolva problemas de correspondência de template
- Esclareça limites de escopo de execução

### 5.2. Aplicação de Padrões a Áreas Não Revisadas
**Aplique padrões aprendidos para melhorar o plano inteiro:**

**Se Padrão Encontrado nas Áreas Selecionadas:**
- **Padrões de empacotamento**: Escaneie áreas não revisadas para indicadores similares de empacotamento
- **Padrões de classificação**: Verifique tarefas não revisadas com características similares
- **Correspondência de template**: Varie a formatação em tarefas similares não revisadas
- **Requisitos ausentes**: Adicione requisitos a tarefas não revisadas em domínios similares

**Aplicação Conservadora:**
- Aplique apenas padrões claros e óbvios às áreas não revisadas
- Evite alterações extensas em seções não revisadas
- Foque em aplicar lições aprendidas da revisão sistemática

### 5.3. Atualização Abrangente do Plano
**Atualize o Plano de Implementação inteiro com todas as alterações:**

1. **Aplique correções de revisão sistemática** às áreas selecionadas
2. **Aplique melhorias baseadas em padrões** às áreas não revisadas
3. **Mantenha consistência** em todo o plano
4. **Atualize numeração de tarefas** e dependências conforme necessário

---

## 6. Revisão Final do Usuário

### 6.1. Apresentação do Resumo da Revisão
**Resumo claro de todas as alterações feitas:**

**Formato do Resumo:**
```markdown
## Revisão Completa - Resumo das Alterações

**Revisão Sistemática Aplicada a:**
- [Seleções de fase/tarefa] - Encontrado e corrigido: [resumo de problemas com contagens]
- [Tarefas individuais] - Encontrado e corrigido: [problemas específicos]
- [Quaisquer áreas sem problemas encontrados]

**Melhorias Baseadas em Padrões Aplicadas:**
- [Descrição dos padrões encontrados e aplicados às áreas não revisadas]
- [Contagem e tipo de melhorias feitas baseadas nas descobertas da revisão sistemática]

**Total de Alterações:**
- [X] tarefas divididas ([original] → [nova divisão de tarefas])
- [X] tarefas reclassificadas ([alterações de classificação feitas])
- [X] tarefas aprimoradas com [tipo de aprimoramentos]
- [X] tarefas reformatadas para [melhorias de formatação]

**Pronto para Fase de Aprimoramento**
```

**Requisitos do Resumo:**
- Distinga claramente entre correções de revisão sistemática e melhorias baseadas em padrões
- Forneça contagens e tipos específicos de alterações feitas
- Liste quaisquer divisões de tarefas com identificação antes/depois
- Confirme prontidão para a próxima fase

### 6.2. Conclusão da Revisão
**Apresente o plano refinado e complete a Fase de Setup:**

1. **Apresente o Plano de Implementação atualizado** com todas as alterações destacadas
2. **Declare que a Fase de Setup está completa** - direcione o Usuário a inicializar o Manager Agent usando `/apm-2-initiate-manager`
3. Se o Usuário solicitar alterações adicionais, aplique-as e reapresente

---

**Fim do Guia**