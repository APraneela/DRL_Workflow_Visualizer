import React, { useMemo, useEffect } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  Edge, 
  Node, 
  MarkerType,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Transition } from '../lib/drlParser';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WorkflowGraphProps {
  transitions: Transition[];
  onSelectTransition?: (transition: Transition) => void;
  selectedId?: string | null;
}

// Custom Node Types
const StateNode = ({ data, selected }: { data: { label: string, isSource?: boolean, transition?: Transition }, selected?: boolean }) => (
  <div className={cn(
    "flex flex-col items-center justify-center min-w-[140px] px-4 py-3 rounded-xl border-2 shadow-md text-center text-[11px] font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer",
    data.isSource 
      ? "border-slate-400 bg-white text-slate-600" 
      : cn(
          "border-brand-accent bg-[#eff6ff] text-brand-text hover:border-blue-500 hover:shadow-lg",
          selected && "border-blue-600 bg-blue-100 ring-4 ring-blue-500/20 shadow-xl scale-105"
        )
  )}>
    <Handle type="target" position={Position.Left} className="!bg-brand-accent !w-2 !h-2" />
    <span className="mb-1">{data.label}</span>
    {!data.isSource && data.transition && (
      <span className="text-[8px] font-extrabold uppercase text-brand-accent/60 tracking-wider">Inspect Logic</span>
    )}
    <Handle type="source" position={Position.Right} className="!bg-brand-accent !w-2 !h-2" />
  </div>
);

const nodeTypes = {
  state: StateNode,
};

function GraphInner({ transitions, onSelectTransition, selectedId }: WorkflowGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { setCenter, getNodes } = useReactFlow();

  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const sourceStates = new Set<string>();

    transitions.forEach((t, i) => {
      const fromId = `source-${t.fromState}`;
      const toId = `target-${t.toState}-${t.toStep}-${i}`;
      
      if (!sourceStates.has(t.fromState)) {
        sourceStates.add(t.fromState);
        nodes.push({
          id: fromId,
          type: 'state',
          data: { label: t.fromState, isSource: true },
          position: { x: 0, y: 0 },
        });
      }

      nodes.push({
        id: toId,
        type: 'state',
        data: { 
          label: `${t.toState.toUpperCase()} | ${t.toStep}`,
          isSource: false,
          transition: t
        },
        selected: selectedId === t.id,
        position: { x: 0, y: 0 },
      });

      edges.push({
        id: `edge-${t.id}`,
        source: fromId,
        target: toId,
        label: t.hasCondition ? '⚠️ Condition' : t.type,
        labelStyle: { fill: t.hasCondition ? '#f59e0b' : '#64748b', fontWeight: 600, fontSize: 10 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: 'white', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 },
        animated: !t.rejected && !t.hasCondition,
        style: { 
          stroke: t.rejected ? '#ef4444' : (t.hasCondition ? '#94a3b8' : '#3b82f6'),
          strokeWidth: 2,
          strokeDasharray: t.hasCondition ? '4,4' : '0',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: t.rejected ? '#ef4444' : (t.hasCondition ? '#94a3b8' : '#3b82f6'),
        },
      });
    });

    // Hierarchical Layout Calculation
    const sortedSources = Array.from(sourceStates).sort();
    let currentY = 50;
    const HORIZONTAL_GAP = 550;
    const VERTICAL_STEP = 120;
    const GROUP_GAP = 100;

    sortedSources.forEach((source) => {
      const matchingTransitions = transitions.filter(t => t.fromState === source);
      const groupHeight = Math.max(1, matchingTransitions.length) * VERTICAL_STEP;
      
      const sNode = nodes.find(n => n.id === `source-${source}`);
      if (sNode) {
        sNode.position = { 
          x: 50, 
          y: currentY + (groupHeight / 2) - 40 
        };
      }

      matchingTransitions.forEach((t, tIdx) => {
        const targetId = `target-${t.toState}-${t.toStep}-${transitions.indexOf(t)}`;
        const tNode = nodes.find(n => n.id === targetId);
        if (tNode) {
          tNode.position = { 
            x: HORIZONTAL_GAP, 
            y: currentY + (tIdx * VERTICAL_STEP) 
          };
        }
      });

      currentY += groupHeight + GROUP_GAP;
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [transitions, selectedId]);

  // Sync internal state
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // EXTERNAL FOCUS SYNC: Removed centering/zooming as requested
  useEffect(() => {
    // Only highlighting is handled via props.selectedId in the ReactFlow nodes memo
  }, [selectedId]);

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 64px)' }} className="bg-[#f1f5f9] relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (!node.data.isSource && node.data.transition && onSelectTransition) {
            onSelectTransition(node.data.transition);
          }
        }}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid={true}
        snapGrid={[15, 15]}
      >
        <Background color="#cbd5e1" gap={20} />
        <Controls />
      </ReactFlow>

      <div className="absolute top-6 right-6 z-20">
        <button 
          onClick={() => {
            setNodes(initialNodes);
            setEdges(initialEdges);
          }}
          className="bg-white border border-brand-border px-3 py-2 rounded-lg text-[10px] font-bold text-brand-text shadow-sm hover:bg-slate-50 transition-colors uppercase tracking-wider"
        >
          Reset Layout
        </button>
      </div>

      <div className="absolute bottom-6 right-6 bg-white border border-brand-border p-4 rounded-xl shadow-lg text-[10px] space-y-2 pointer-events-none z-20 w-44">
        <h4 className="font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-2 invisible md:visible">Canvas Legend</h4>
        <div className="flex items-center gap-3">
          <div className="w-3 h-1 bg-brand-accent rounded"></div>
          <span className="font-bold text-slate-600">Standard Path</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-3 h-1 bg-brand-danger rounded"></div>
          <span className="font-bold text-slate-600">Rejection Path</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-3 h-1 border-t-2 border-dashed border-slate-400"></div>
          <span className="font-bold text-slate-600">Conditional</span>
        </div>
        <p className="pt-2 text-[9px] text-slate-400 italic">Nodes are draggable</p>
      </div>
    </div>
  );
}

export default function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
