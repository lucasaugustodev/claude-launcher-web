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
    const data = {
      nodes: nodes.map(n => ({ ...n, selected: undefined })),
      edges: edges.map(e => ({ ...e, selected: undefined })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ─── Custom Process Node ───

function ProcessNode({ data, selected }) {
  const heat = data.heatScore != null ? data.heatScore : calcHeatScore(data);
  const color = getHeatColor(heat);

  return h('div', {
    style: {
      background: '#1e1e2e',
      border: '2px solid ' + (selected ? '#89b4fa' : color),
      borderRadius: 8,
      padding: 12,
      minWidth: 200,
      maxWidth: 280,
      color: '#cdd6f4',
      fontSize: 12,
      fontFamily: '-apple-system, sans-serif',
      boxShadow: selected ? '0 0 12px rgba(137,180,250,0.4)' : '0 2px 8px rgba(0,0,0,0.3)',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }
  },
    h(Handle, { type: 'target', position: Position.Top, style: { background: color, width: 8, height: 8 } }),

    // Header
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
      h('strong', { style: { fontSize: 14, flex: 1, marginRight: 8 } }, data.nome || 'Sem nome'),
      h('span', {
        style: {
          background: color, color: '#000', borderRadius: 4,
          padding: '2px 8px', fontSize: 10, fontWeight: 'bold', flexShrink: 0,
        }
      }, heat)
    ),

    // Stats grid
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: '#a6adc8' } },
      h('span', null, '\u23F1 ', data.frequencia || '-'),
      h('span', null, '\uD83D\uDC64 ', data.responsavel || '-'),
      h('span', null, '\uD83D\uDCAA ', data.esforco || '-'),
      h('span', null, '\uD83C\uDFAF ', data.impacto || '-'),
    ),

    // Systems
    data.sistemas && data.sistemas.length > 0 &&
      h('div', { style: { marginTop: 6, fontSize: 10, color: '#7f849c' } },
        '\uD83D\uDD27 ', data.sistemas.join(', ')
      ),

    // Friction
    data.friccao &&
      h('div', { style: { marginTop: 6, fontSize: 10, color: '#f38ba8', fontStyle: 'italic' } },
        '\u26A1 ', data.friccao
      ),

    h(Handle, { type: 'source', position: Position.Bottom, style: { background: color, width: 8, height: 8 } })
  );
}

const nodeTypes = { process: ProcessNode };

// ─── Node Edit Modal ───

function NodeEditModal({ node, onSave, onClose, onDelete }) {
  const [form, setForm] = useState({
    nome: '',
    frequencia: 'semanal',
    responsavel: '',
    sistemas: '',
    esforco: 'medio',
    impacto: 'medio',
    friccao: '',
    ...(node ? {
      ...node.data,
      sistemas: Array.isArray(node.data.sistemas) ? node.data.sistemas.join(', ') : (node.data.sistemas || ''),
    } : {}),
  });

  const handleChange = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = () => {
    const sistemas = form.sistemas.split(',').map(s => s.trim()).filter(Boolean);
    const data = {
      nome: form.nome,
      frequencia: form.frequencia,
      responsavel: form.responsavel,
      sistemas,
      esforco: form.esforco,
      impacto: form.impacto,
      friccao: form.friccao,
    };
    data.heatScore = calcHeatScore(data);
    onSave(data);
  };

  const field = (label, name, type, options) => {
    if (type === 'select') {
      return h(React.Fragment, null,
        h('label', null, label),
        h('select', { value: form[name], onChange: handleChange(name) },
          options.map(o => h('option', { key: o.value, value: o.value }, o.label))
        )
      );
    }
    if (type === 'textarea') {
      return h(React.Fragment, null,
        h('label', null, label),
        h('textarea', { value: form[name], onChange: handleChange(name), rows: 2 })
      );
    }
    return h(React.Fragment, null,
      h('label', null, label),
      h('input', { type: 'text', value: form[name], onChange: handleChange(name) })
    );
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
        node && onDelete && h('button', {
          className: 'btn btn-danger btn-sm',
          style: { marginRight: 'auto' },
          onClick: () => { onDelete(); onClose(); }
        }, 'Excluir'),
        h('button', { className: 'btn btn-sm', onClick: onClose }, 'Cancelar'),
        h('button', { className: 'btn btn-primary btn-sm', onClick: handleSubmit }, 'Salvar'),
      )
    )
  );
}

// ─── Agent Chat Panel ───

function AgentChat({ onProcessesGenerated, generating, setGenerating }) {
  const [messages, setMessages] = useState([
    { role: 'agent', text: 'Descreva os processos da sua empresa. Pode ser em texto livre — eu vou extrair os processos, responsaveis, frequencias e pontos de friccao automaticamente.' }
  ]);
  const [input, setInput] = useState('');
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;
    setInput('');

    const newMessages = [...messages, { role: 'user', text }];
    setMessages(newMessages);
    setGenerating(true);

    try {
      const resp = await fetch('api/planning/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('token') || ''),
        },
        body: JSON.stringify({
          messages: newMessages.filter(m => m.role === 'user').map(m => m.text),
        }),
      });

      if (!resp.ok) throw new Error('Erro ao analisar processos');
      const data = await resp.json();

      if (data.reply) {
        setMessages(prev => [...prev, { role: 'agent', text: data.reply }]);
      }

      if (data.nodes && data.nodes.length > 0) {
        setMessages(prev => [...prev, {
          role: 'system',
          text: `${data.nodes.length} processo(s) identificado(s) e adicionado(s) ao mapa!`
        }]);
        onProcessesGenerated(data.nodes, data.edges || []);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'agent', text: 'Erro: ' + err.message + '. Tente novamente.' }]);
    } finally {
      setGenerating(false);
    }
  }, [input, messages, generating, onProcessesGenerated, setGenerating]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return h(React.Fragment, null,
    h('div', { className: 'planning-chat', ref: chatRef },
      messages.map((msg, i) =>
        h('div', { key: i, className: 'planning-chat-msg ' + msg.role }, msg.text)
      ),
      generating && h('div', { className: 'planning-loading' },
        h('span', { className: 'planning-loading-dot' }),
        h('span', { className: 'planning-loading-dot' }),
        h('span', { className: 'planning-loading-dot' }),
        h('span', null, 'Analisando...')
      ),
    ),
    h('div', { className: 'planning-chat-input' },
      h('textarea', {
        value: input,
        onChange: (e) => setInput(e.target.value),
        onKeyDown: handleKeyDown,
        placeholder: 'Descreva seus processos...',
        disabled: generating,
      }),
      h('button', {
        className: 'btn btn-primary btn-sm',
        onClick: handleSend,
        disabled: !input.trim() || generating,
      }, 'Enviar'),
    )
  );
}

// ─── Process List Panel ───

function ProcessList({ nodes, onSelectNode, onAddNode }) {
  const sorted = useMemo(() => {
    return [...nodes]
      .filter(n => n.type === 'process')
      .sort((a, b) => (b.data.heatScore || 0) - (a.data.heatScore || 0));
  }, [nodes]);

  return h('div', { className: 'planning-process-list' },
    h('div', { style: { padding: '8px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', { style: { fontSize: 12, color: '#a6adc8' } }, sorted.length + ' processo(s)'),
      h('button', { className: 'btn btn-primary btn-sm', onClick: onAddNode }, '+ Novo'),
    ),
    sorted.map(node => {
      const heat = node.data.heatScore || calcHeatScore(node.data);
      const color = getHeatColor(heat);
      return h('div', {
        key: node.id,
        className: 'planning-process-item',
        onClick: () => onSelectNode(node.id),
      },
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
  const [editNode, setEditNode] = useState(null); // null or node object
  const [showAddModal, setShowAddModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const reactFlowRef = useRef(null);

  // Initialize counter
  useEffect(() => {
    if (saved?.nodes?.length) {
      const maxId = Math.max(...saved.nodes.map(n => parseInt(n.id) || 0));
      nodeIdCounter = maxId + 1;
    }
  }, []);

  // Auto-save on changes
  useEffect(() => {
    saveState(nodes, edges);
  }, [nodes, edges]);

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      animated: true,
      style: { stroke: '#6c7086' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6c7086' },
    }, eds));
  }, [setEdges]);

  const onNodeDoubleClick = useCallback((event, node) => {
    if (node.type === 'process') {
      setEditNode(node);
    }
  }, []);

  const handleEditSave = useCallback((data) => {
    if (editNode) {
      setNodes(nds => nds.map(n =>
        n.id === editNode.id ? { ...n, data: { ...n.data, ...data } } : n
      ));
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
    const existingCount = nodes.filter(n => n.type === 'process').length;
    const col = existingCount % 3;
    const row = Math.floor(existingCount / 3);

    setNodes(nds => [...nds, {
      id,
      type: 'process',
      position: { x: 50 + col * 300, y: 50 + row * 200 },
      data: { ...data, heatScore: calcHeatScore(data) },
    }]);
    setShowAddModal(false);
  }, [nodes, setNodes]);

  // Agent generates processes
  const onProcessesGenerated = useCallback((processNodes, processEdges) => {
    const startId = nodeIdCounter;
    const newNodes = processNodes.map((p, i) => {
      const id = String(nodeIdCounter++);
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
      return {
        id,
        type: 'process',
        position: { x: 80 + col * 300, y: 80 + row * 220 },
        data,
      };
    });

    const newEdges = (processEdges || []).map((e, i) => ({
      id: 'e-gen-' + Date.now() + '-' + i,
      source: String(startId + (parseInt(e.source) || 0)),
      target: String(startId + (parseInt(e.target) || 0)),
      animated: true,
      label: e.label || '',
      style: { stroke: '#6c7086' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6c7086' },
    }));

    setNodes(nds => [...nds, ...newNodes]);
    setEdges(eds => [...eds, ...newEdges]);
  }, [setNodes, setEdges]);

  const clearAll = useCallback(() => {
    if (confirm('Limpar todo o mapa de processos?')) {
      setNodes([]);
      setEdges([]);
      nodeIdCounter = 1;
    }
  }, [setNodes, setEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        setNodes(nds => {
          const selected = nds.filter(n => n.selected);
          if (selected.length === 0) return nds;
          const selectedIds = new Set(selected.map(n => n.id));
          setEdges(eds => eds.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
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
      h('div', { className: 'planning-sidebar-header' },
        h('h3', null, '\uD83D\uDDFA Planejamento'),
      ),
      h('div', { className: 'planning-mode-tabs' },
        h('button', {
          className: 'planning-mode-tab' + (mode === 'agent' ? ' active' : ''),
          onClick: () => setMode('agent'),
        }, '\uD83E\uDD16 Agente'),
        h('button', {
          className: 'planning-mode-tab' + (mode === 'user' ? ' active' : ''),
          onClick: () => setMode('user'),
        }, '\u270F\uFE0F Manual'),
      ),
      mode === 'agent'
        ? h(AgentChat, { onProcessesGenerated, generating, setGenerating })
        : h(ProcessList, { nodes, onSelectNode: (id) => {
            const node = nodes.find(n => n.id === id);
            if (node) setEditNode(node);
          }, onAddNode: () => setShowAddModal(true) }),
    ),

    // Canvas
    h('div', { className: 'planning-canvas' },
      h('div', { className: 'planning-toolbar' },
        h('button', { onClick: () => setShowAddModal(true) }, '+ Processo'),
        h('button', { onClick: clearAll }, '\uD83D\uDDD1 Limpar'),
        h('button', { onClick: () => {
          const data = JSON.stringify({ nodes, edges }, null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'process-map.json'; a.click();
          URL.revokeObjectURL(url);
        }}, '\u2B07 Exportar'),
      ),

      h(ReactFlow, {
        ref: reactFlowRef,
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onNodeDoubleClick,
        nodeTypes,
        fitView: true,
        deleteKeyCode: null,
        style: { background: '#11111b' },
        defaultEdgeOptions: {
          animated: true,
          style: { stroke: '#6c7086' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6c7086' },
        },
      },
        h(Background, { color: '#313244', gap: 20, size: 1 }),
        h(Controls, { showInteractive: false }),
        h(MiniMap, {
          nodeColor: (node) => {
            if (node.type !== 'process') return '#45475a';
            const heat = node.data.heatScore || calcHeatScore(node.data);
            return getHeatColor(heat);
          },
          maskColor: 'rgba(0,0,0,0.6)',
          style: { background: '#1e1e2e' },
        }),
      ),

      // Heat legend
      h('div', { className: 'planning-legend' },
        h('span', null, 'Heat:'),
        h('span', { className: 'planning-legend-item' },
          h('span', { className: 'planning-legend-dot', style: { background: '#4ade80' } }), 'Baixo'),
        h('span', { className: 'planning-legend-item' },
          h('span', { className: 'planning-legend-dot', style: { background: '#facc15' } }), 'Medio'),
        h('span', { className: 'planning-legend-item' },
          h('span', { className: 'planning-legend-dot', style: { background: '#fb923c' } }), 'Alto'),
        h('span', { className: 'planning-legend-item' },
          h('span', { className: 'planning-legend-dot', style: { background: '#ef4444' } }), 'Critico'),
      ),
    ),

    // Edit modal
    editNode && h(NodeEditModal, {
      node: editNode,
      onSave: handleEditSave,
      onClose: () => setEditNode(null),
      onDelete: handleEditDelete,
    }),

    // Add modal
    showAddModal && h(NodeEditModal, {
      node: null,
      onSave: addNewNode,
      onClose: () => setShowAddModal(false),
    }),
  );
}

// ─── Mount function for LegacyPage ───

let root = null;

window.renderPlanningPage = function(container) {
  // Add reactflow CSS if not already added
  if (!document.getElementById('reactflow-css')) {
    const link = document.createElement('link');
    link.id = 'reactflow-css';
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/reactflow@11.11.4/dist/style.css';
    document.head.appendChild(link);
  }

  // Container needs explicit height for React Flow
  container.style.height = '100%';
  container.style.display = 'flex';

  // Mount React app
  const wrapper = document.createElement('div');
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  container.appendChild(wrapper);

  root = createRoot(wrapper);
  root.render(h(PlanningApp));

  // Cleanup when LegacyPage unmounts (innerHTML = '')
  const observer = new MutationObserver(() => {
    if (!container.contains(wrapper)) {
      root?.unmount();
      root = null;
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
};
