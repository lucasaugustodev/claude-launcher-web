// ─── Planning Page — Process Discovery with React Flow ───
// ES Module: uses React (not Preact) for React Flow compatibility

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Handle, Position, MarkerType
} from 'https://esm.sh/reactflow@11.11.4?deps=react@18.3.1,react-dom@18.3.1';

const h = React.createElement;

// ─── Constants ───

const STORAGE_KEY = 'planning-process-map';

const FREQ_OPTIONS = [
  { value: 'diario', label: 'Diario' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'sob_demanda', label: 'Sob demanda' },
];
const LEVEL_OPTIONS = [
  { value: 'alto', label: 'Alto' },
  { value: 'medio', label: 'Medio' },
  { value: 'baixo', label: 'Baixo' },
];

const FREQ_VALUES = { diario: 4, semanal: 3, mensal: 2, sob_demanda: 1 };
const LEVEL_VALUES = { alto: 3, medio: 2, baixo: 1 };

function calcHeatScore(data) {
  const freq = FREQ_VALUES[data.frequencia] || 1;
  const effort = LEVEL_VALUES[data.esforco] || 1;
  const impact = LEVEL_VALUES[data.impacto] || 1;
  return freq * effort * impact;
}

function getHeatColor(score) {
  if (score <= 6) return '#4ade80';
  if (score <= 12) return '#a3e635';
  if (score <= 18) return '#facc15';
  if (score <= 27) return '#fb923c';
  return '#ef4444';
}

// ─── Persistence ───

function saveState(nodes, edges) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
  } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Parse [PROCESSES] blocks from agent text ───

function extractProcesses(text) {
  const match = text.match(/\[PROCESSES\]\s*([\s\S]*?)\s*\[\/PROCESSES\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// Strip [PROCESSES] blocks from display text
function stripProcessBlocks(text) {
  return text.replace(/\[PROCESSES\][\s\S]*?\[\/PROCESSES\]/g, '').trim();
}

// ─── Custom Process Node ───

function ProcessNode({ data, selected }) {
  const heat = data.heatScore != null ? data.heatScore : calcHeatScore(data);
  const color = getHeatColor(heat);

  return h('div', {
    style: {
      background: '#1e1e2e',
      border: '2px solid ' + (selected ? '#89b4fa' : color),
      borderRadius: 8, padding: 12, minWidth: 200, maxWidth: 280,
      color: '#cdd6f4', fontSize: 12, fontFamily: '-apple-system, sans-serif',
      boxShadow: selected ? '0 0 12px rgba(137,180,250,0.4)' : '0 2px 8px rgba(0,0,0,0.3)',
    }
  },
    h(Handle, { type: 'target', position: Position.Top, style: { background: color, width: 8, height: 8 } }),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
      h('strong', { style: { fontSize: 14, flex: 1, marginRight: 8 } }, data.nome || 'Sem nome'),
      h('span', { style: { background: color, color: '#000', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 'bold', flexShrink: 0 } }, heat)
    ),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: '#a6adc8' } },
      h('span', null, '\u23F1 ', data.frequencia || '-'),
      h('span', null, '\uD83D\uDC64 ', data.responsavel || '-'),
      h('span', null, '\uD83D\uDCAA ', data.esforco || '-'),
      h('span', null, '\uD83C\uDFAF ', data.impacto || '-'),
    ),
    data.sistemas && data.sistemas.length > 0 && h('div', { style: { marginTop: 6, fontSize: 10, color: '#7f849c' } }, '\uD83D\uDD27 ', data.sistemas.join(', ')),
    data.friccao && h('div', { style: { marginTop: 6, fontSize: 10, color: '#f38ba8', fontStyle: 'italic' } }, '\u26A1 ', data.friccao),
    h(Handle, { type: 'source', position: Position.Bottom, style: { background: color, width: 8, height: 8 } })
  );
}

const nodeTypes = { process: ProcessNode };

// ─── Node Edit Modal ───

function NodeEditModal({ node, onSave, onClose, onDelete }) {
  const [form, setForm] = useState({
    nome: '', frequencia: 'semanal', responsavel: '', sistemas: '',
    esforco: 'medio', impacto: 'medio', friccao: '',
    ...(node ? {
      ...node.data,
      sistemas: Array.isArray(node.data.sistemas) ? node.data.sistemas.join(', ') : (node.data.sistemas || ''),
    } : {}),
  });

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleSubmit = () => {
    const sistemas = form.sistemas.split(',').map(s => s.trim()).filter(Boolean);
    const data = { nome: form.nome, frequencia: form.frequencia, responsavel: form.responsavel, sistemas, esforco: form.esforco, impacto: form.impacto, friccao: form.friccao };
    data.heatScore = calcHeatScore(data);
    onSave(data);
  };

  const field = (label, name, type, options) => {
    if (type === 'select') return h(React.Fragment, null, h('label', null, label), h('select', { value: form[name], onChange: set(name) }, options.map(o => h('option', { key: o.value, value: o.value }, o.label))));
    if (type === 'textarea') return h(React.Fragment, null, h('label', null, label), h('textarea', { value: form[name], onChange: set(name), rows: 2 }));
    return h(React.Fragment, null, h('label', null, label), h('input', { type: 'text', value: form[name], onChange: set(name) }));
  };

  return h('div', { className: 'planning-modal-overlay', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
    h('div', { className: 'planning-modal' },
      h('h3', null, node ? 'Editar Processo' : 'Novo Processo'),
      field('Nome do processo', 'nome', 'text'),
      field('Frequencia', 'frequencia', 'select', FREQ_OPTIONS),
      field('Responsavel', 'responsavel', 'text'),
      field('Sistemas (separados por virgula)', 'sistemas', 'text'),
      field('Esforco', 'esforco', 'select', LEVEL_OPTIONS),
      field('Impacto', 'impacto', 'select', LEVEL_OPTIONS),
      field('Friccao (o que e chato/manual/lento)', 'friccao', 'textarea'),
      h('div', { className: 'planning-modal-actions' },
        node && onDelete && h('button', { className: 'btn btn-danger btn-sm', style: { marginRight: 'auto' }, onClick: () => { onDelete(); onClose(); } }, 'Excluir'),
        h('button', { className: 'btn btn-sm', onClick: onClose }, 'Cancelar'),
        h('button', { className: 'btn btn-primary btn-sm', onClick: handleSubmit }, 'Salvar'),
      )
    )
  );
}

// ─── Agent Chat Panel (real Claude session) ───

function AgentChat({ onProcessesUpdated }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | connecting | thinking | responding | input_wait | ended
  const chatRef = useRef(null);
  const handlerRef = useRef(null);
  const exitHandlerRef = useRef(null);
  const textBufferRef = useRef('');
  const sessionIdRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (handlerRef.current) API.off('terminal:stream-json', handlerRef.current);
      if (exitHandlerRef.current) API.off('terminal:exit', exitHandlerRef.current);
      if (sessionIdRef.current) API.detachSession(sessionIdRef.current);
    };
  }, []);

  const flushTextBuffer = useCallback(() => {
    const text = textBufferRef.current;
    if (!text) return;
    textBufferRef.current = '';

    // Check for process data
    const processData = extractProcesses(text);
    if (processData) {
      onProcessesUpdated(processData.nodes || [], processData.edges || []);
    }

    const displayText = stripProcessBlocks(text);
    if (displayText) {
      setMessages(prev => [...prev, { role: 'agent', text: displayText }]);
    }
    if (processData) {
      setMessages(prev => [...prev, { role: 'system', text: (processData.nodes || []).length + ' processo(s) mapeado(s) no canvas!' }]);
    }
  }, [onProcessesUpdated]);

  const launchAgent = useCallback(async (initialMsg) => {
    setStatus('connecting');
    setMessages([{ role: 'system', text: 'Iniciando agente de process discovery...' }]);

    try {
      const token = localStorage.getItem('token') || '';
      const resp = await fetch('api/planning/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ message: initialMsg || null }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao iniciar agente');
      }
      const session = await resp.json();
      sessionIdRef.current = session.id;

      // Attach to session WebSocket
      API.attachSession(session.id);

      // Listen for stream-json events
      const handler = (msg) => {
        if (msg.sessionId !== session.id) return;
        const event = msg.event;
        if (!event) return;

        switch (event.type) {
          case 'system':
            if (event.subtype === 'init') setStatus('thinking');
            break;

          case 'assistant': {
            const content = event.message && event.message.content;
            if (!Array.isArray(content)) break;

            for (const block of content) {
              if (block.type === 'text' && block.text) {
                textBufferRef.current += block.text;
                setStatus('responding');
              } else if (block.type === 'tool_use') {
                // Flush any accumulated text before tool
                flushTextBuffer();
                setStatus('thinking');
              }
            }
            break;
          }

          case 'user':
            // Tool result - flush text and show thinking
            flushTextBuffer();
            setStatus('thinking');
            break;

          case 'result':
            // Turn complete
            flushTextBuffer();
            setStatus('input_wait');
            break;
        }
      };

      const exitHandler = (msg) => {
        if (msg.sessionId !== session.id) return;
        flushTextBuffer();
        setStatus('ended');
        setMessages(prev => [...prev, { role: 'system', text: 'Sessao do agente encerrada.' }]);
      };

      handlerRef.current = handler;
      exitHandlerRef.current = exitHandler;
      API.on('terminal:stream-json', handler);
      API.on('terminal:exit', exitHandler);

      setStatus('thinking');
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', text: 'Erro: ' + err.message }]);
      setStatus('idle');
    }
  }, [flushTextBuffer]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    if (!sessionIdRef.current) {
      // First message - launch the agent
      launchAgent(text);
      setMessages(prev => [...prev, { role: 'user', text }]);
      return;
    }

    // Send to existing session
    setMessages(prev => [...prev, { role: 'user', text }]);
    API.sendStreamJsonInput(sessionIdRef.current, text);
    setStatus('thinking');
  }, [input, launchAgent]);

  const stopAgent = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      const token = localStorage.getItem('token') || '';
      await fetch('api/sessions/' + sessionIdRef.current + '/stop', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
      });
    } catch {}
    setStatus('ended');
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const statusLabel = {
    idle: null,
    connecting: 'Conectando...',
    thinking: 'Pensando...',
    responding: 'Respondendo...',
    input_wait: null,
    ended: 'Encerrado',
  };

  return h(React.Fragment, null,
    h('div', { className: 'planning-chat', ref: chatRef },
      messages.length === 0 && h('div', { className: 'planning-chat-msg system' },
        'Descreva sua empresa e seus processos. O agente vai conduzir a conversa e construir o mapa automaticamente.'
      ),
      messages.map((msg, i) => h('div', { key: i, className: 'planning-chat-msg ' + msg.role }, msg.text)),
      statusLabel[status] && h('div', { className: 'planning-loading' },
        h('span', { className: 'planning-loading-dot' }),
        h('span', { className: 'planning-loading-dot' }),
        h('span', { className: 'planning-loading-dot' }),
        h('span', null, statusLabel[status])
      ),
    ),
    h('div', { className: 'planning-chat-input' },
      h('textarea', {
        value: input,
        onChange: (e) => setInput(e.target.value),
        onKeyDown: handleKeyDown,
        placeholder: sessionId ? 'Responda ao agente...' : 'Descreva sua empresa e processos para iniciar...',
        disabled: status === 'connecting' || status === 'ended',
      }),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('button', {
          className: 'btn btn-primary btn-sm',
          onClick: sendMessage,
          disabled: !input.trim() || status === 'connecting' || status === 'ended',
        }, sessionId ? 'Enviar' : 'Iniciar'),
        sessionId && status !== 'ended' && h('button', {
          className: 'btn btn-danger btn-sm',
          onClick: stopAgent,
          style: { fontSize: 11 },
        }, 'Parar'),
      ),
    ),
  );
}

// ─── Process List Panel ───

function ProcessList({ nodes, onSelectNode, onAddNode }) {
  const sorted = useMemo(() =>
    [...nodes].filter(n => n.type === 'process').sort((a, b) => (b.data.heatScore || 0) - (a.data.heatScore || 0)),
    [nodes]
  );

  return h('div', { className: 'planning-process-list' },
    h('div', { style: { padding: '8px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', { style: { fontSize: 12, color: '#a6adc8' } }, sorted.length + ' processo(s)'),
      h('button', { className: 'btn btn-primary btn-sm', onClick: onAddNode }, '+ Novo'),
    ),
    sorted.map(node => {
      const heat = node.data.heatScore || calcHeatScore(node.data);
      const color = getHeatColor(heat);
      return h('div', { key: node.id, className: 'planning-process-item', onClick: () => onSelectNode(node.id) },
        h('span', { className: 'heat-dot', style: { background: color } }),
        h('span', { className: 'name' }, node.data.nome || 'Sem nome'),
        h('span', { className: 'score', style: { background: color, color: '#000' } }, heat),
      );
    }),
  );
}

// ─── Main Planning Canvas ───

let nodeIdCounter = 1;

function PlanningApp() {
  const saved = useMemo(() => loadState(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(saved?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(saved?.edges || []);
  const [mode, setMode] = useState('agent');
  const [editNode, setEditNode] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    if (saved?.nodes?.length) {
      const maxId = Math.max(...saved.nodes.map(n => parseInt(n.id) || 0));
      nodeIdCounter = maxId + 1;
    }
  }, []);

  useEffect(() => { saveState(nodes, edges); }, [nodes, edges]);

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({ ...params, animated: true, style: { stroke: '#6c7086' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6c7086' } }, eds));
  }, [setEdges]);

  const onNodeDoubleClick = useCallback((_, node) => {
    if (node.type === 'process') setEditNode(node);
  }, []);

  const handleEditSave = useCallback((data) => {
    if (editNode) {
      setNodes(nds => nds.map(n => n.id === editNode.id ? { ...n, data: { ...n.data, ...data } } : n));
      setEditNode(null);
    }
  }, [editNode, setNodes]);

  const handleEditDelete = useCallback(() => {
    if (editNode) {
      setNodes(nds => nds.filter(n => n.id !== editNode.id));
      setEdges(eds => eds.filter(e => e.source !== editNode.id && e.target !== editNode.id));
      setEditNode(null);
    }
  }, [editNode, setNodes, setEdges]);

  const addNewNode = useCallback((data) => {
    const id = String(nodeIdCounter++);
    const count = nodes.filter(n => n.type === 'process').length;
    setNodes(nds => [...nds, {
      id, type: 'process',
      position: { x: 50 + (count % 3) * 300, y: 50 + Math.floor(count / 3) * 200 },
      data: { ...data, heatScore: calcHeatScore(data) },
    }]);
    setShowAddModal(false);
  }, [nodes, setNodes]);

  // Agent replaces ALL processes each time (full snapshot)
  const onProcessesUpdated = useCallback((processNodes, processEdges) => {
    const newNodes = processNodes.map((p, i) => {
      const id = String(i + 1);
      const col = i % 3;
      const row = Math.floor(i / 3);
      const data = {
        nome: p.nome || 'Processo ' + (i + 1),
        frequencia: p.frequencia || 'semanal',
        responsavel: p.responsavel || '',
        sistemas: p.sistemas || [],
        esforco: p.esforco || 'medio',
        impacto: p.impacto || 'medio',
        friccao: p.friccao || '',
      };
      data.heatScore = calcHeatScore(data);
      return { id, type: 'process', position: { x: 80 + col * 300, y: 80 + row * 220 }, data };
    });

    const newEdges = (processEdges || []).map((e, i) => ({
      id: 'e-' + i,
      source: String((parseInt(e.source) || 0) + 1),
      target: String((parseInt(e.target) || 0) + 1),
      animated: true, label: e.label || '',
      style: { stroke: '#6c7086' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6c7086' },
    }));

    nodeIdCounter = processNodes.length + 1;
    setNodes(newNodes);
    setEdges(newEdges);
  }, [setNodes, setEdges]);

  const clearAll = useCallback(() => {
    if (confirm('Limpar todo o mapa de processos?')) {
      setNodes([]); setEdges([]); nodeIdCounter = 1;
    }
  }, [setNodes, setEdges]);

  // Delete selected nodes
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        setNodes(nds => {
          const sel = nds.filter(n => n.selected);
          if (!sel.length) return nds;
          const ids = new Set(sel.map(n => n.id));
          setEdges(eds => eds.filter(e => !ids.has(e.source) && !ids.has(e.target)));
          return nds.filter(n => !n.selected);
        });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setNodes, setEdges]);

  return h('div', { className: 'planning-container' },
    // Sidebar
    h('div', { className: 'planning-sidebar' },
      h('div', { className: 'planning-sidebar-header' }, h('h3', null, '\uD83D\uDDFA Planejamento')),
      h('div', { className: 'planning-mode-tabs' },
        h('button', { className: 'planning-mode-tab' + (mode === 'agent' ? ' active' : ''), onClick: () => setMode('agent') }, '\uD83E\uDD16 Agente'),
        h('button', { className: 'planning-mode-tab' + (mode === 'user' ? ' active' : ''), onClick: () => setMode('user') }, '\u270F\uFE0F Manual'),
      ),
      mode === 'agent'
        ? h(AgentChat, { onProcessesUpdated })
        : h(ProcessList, { nodes, onSelectNode: (id) => setEditNode(nodes.find(n => n.id === id)), onAddNode: () => setShowAddModal(true) }),
    ),

    // Canvas
    h('div', { className: 'planning-canvas' },
      h('div', { className: 'planning-toolbar' },
        h('button', { onClick: () => setShowAddModal(true) }, '+ Processo'),
        h('button', { onClick: clearAll }, '\uD83D\uDDD1 Limpar'),
        h('button', { onClick: () => {
          const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], { type: 'application/json' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'process-map.json'; a.click();
        }}, '\u2B07 Exportar'),
      ),

      h(ReactFlow, {
        nodes, edges, onNodesChange, onEdgesChange, onConnect, onNodeDoubleClick, nodeTypes,
        fitView: true, deleteKeyCode: null,
        style: { background: '#11111b' },
        defaultEdgeOptions: { animated: true, style: { stroke: '#6c7086' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6c7086' } },
      },
        h(Background, { color: '#313244', gap: 20, size: 1 }),
        h(Controls, { showInteractive: false }),
        h(MiniMap, {
          nodeColor: (n) => n.type === 'process' ? getHeatColor(n.data.heatScore || calcHeatScore(n.data)) : '#45475a',
          maskColor: 'rgba(0,0,0,0.6)', style: { background: '#1e1e2e' },
        }),
      ),

      h('div', { className: 'planning-legend' },
        h('span', null, 'Heat:'),
        ...[['#4ade80', 'Baixo'], ['#facc15', 'Medio'], ['#fb923c', 'Alto'], ['#ef4444', 'Critico']].map(([c, l]) =>
          h('span', { key: l, className: 'planning-legend-item' }, h('span', { className: 'planning-legend-dot', style: { background: c } }), l)
        ),
      ),
    ),

    editNode && h(NodeEditModal, { node: editNode, onSave: handleEditSave, onClose: () => setEditNode(null), onDelete: handleEditDelete }),
    showAddModal && h(NodeEditModal, { node: null, onSave: addNewNode, onClose: () => setShowAddModal(false) }),
  );
}

// ─── Mount function for LegacyPage ───

let root = null;

window.renderPlanningPage = function(container) {
  if (!document.getElementById('reactflow-css')) {
    const link = document.createElement('link');
    link.id = 'reactflow-css';
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/reactflow@11.11.4/dist/style.css';
    document.head.appendChild(link);
  }

  container.style.height = '100%';
  container.style.display = 'flex';

  const wrapper = document.createElement('div');
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  container.appendChild(wrapper);

  root = createRoot(wrapper);
  root.render(h(PlanningApp));

  const observer = new MutationObserver(() => {
    if (!container.contains(wrapper)) {
      root?.unmount();
      root = null;
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
};
