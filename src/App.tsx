import { ArrowRightCircle, ChevronDown, FileCode, Play, Trash2, Upload, Workflow, X, Sparkles, Target, Info, Copy, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, { useEffect, useMemo, useState } from 'react';
import WorkflowGraph from './components/WorkflowGraph';
import { parseDrl, WorkflowGroup, Transition } from './lib/drlParser';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Local human-readable logic translation refined for recruiter focus
const translateLogic = (conditions: string): string => {
  if (!conditions) return "This status change is unrestricted. Any application can be moved to this step.";
  
  let raw = conditions.trim();
  const prefix = "To proceed with this status change, the recruiter must ensure the following conditions are met:\n\n";
  
  // Extract patterns like RuleUtil.evaluateListCondition(field && "operator" && "values")
  const listMatches = Array.from(raw.matchAll(/RuleUtil\.evaluateListCondition\s*\(([^)]+)\)/g));
  const detectedLogic: string[] = [];

  if (listMatches.length > 0) {
    for (const match of listMatches) {
      let inner = match[1];
      inner = inner.replace(/&&/g, ' ').replace(/"/g, '').replace(/`/g, '');
      
      const tokens = inner.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        let field = tokens[0].replace(/([A-Z])/g, ' $1').toLowerCase().trim();
        const isNot = tokens.some(t => t.toLowerCase() === 'not' || t.toLowerCase() === 'notin');
        const operator = isNot ? 'must NOT be one of' : 'must be one of';
        const values = tokens.slice(1).filter(t => 
          !['in', 'notin', 'not', tokens[0]].includes(t.toLowerCase())
        ).join(', ');
        
        detectedLogic.push(`The **${field}** ${operator} (**${values}**)`);
      }
    }
  }

  // Handle remaining parts of the logic (complex methods like equalsIgnoreCase)
  let clean = raw.replace(/JobApplication\s*\(/, '').replace(/RuleUtil\.evaluateListCondition\s*\([^)]+\)/g, '').replace(/\)$/, '');
  const parts = clean.split(/&&|\|\|/).map(p => p.trim()).filter(p => p.length > 2);
  
  parts.forEach(part => {
    let t = part;
    const isNegative = t.startsWith('!');
    if (isNegative) t = t.substring(1).trim();

    // Handle common methods
    t = t.replace(/\.equalsIgnoreCase\s*\(\s*""\s*\)/g, ' is NOT empty');
    t = t.replace(/\.equalsIgnoreCase\s*\("([^"]+)"\)/g, ' matches "$1"');
    t = t.replace(/\.equals\s*\("([^"]+)"\)/g, ' matches "$1"');

    t = t
      .replace(/==\s*true/g, ' is active')
      .replace(/==\s*false/g, ' is inactive')
      .replace(/==/g, ' is ')
      .replace(/!=/g, ' is not ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/[\(\)"]/g, '')
      .trim();

    if (t.length > 1) {
      if (isNegative) {
        detectedLogic.push(`Requirement: **${t}** must be FALSE/EMPTY`);
      } else {
        detectedLogic.push(t.charAt(0).toUpperCase() + t.slice(1));
      }
    }
  });

  if (detectedLogic.length > 0) {
    const connector = raw.includes('||') ? 'ANY' : 'ALL';
    const list = [...new Set(detectedLogic)].map(d => `• ${d}`).join(`\n`);
    return `${prefix}${list}\n\n*Recruiter verification of ${connector} requirements above is mandatory.*`;
  }

  return "The system evaluates specific field requirements to validate this status transition.";
};

const SAMPLE_DRL = `
rule "Default Definition - step a - Action - from Screen"
when
    $j : JobApplication(currentState == "Screen")
then
    $j.setResult("{\\"step\\": \\"Recruiter Screen\\", \\"state\\": \\"Screening\\", \\"rejected\\": false, \\"workflowStepId\\": \\"101\\"}");
end

rule "Default Definition - step b - Conclusion - from Screen"
when
    $j : JobApplication(currentState == "Screen", score < 50)
then
    $j.setResult("{\\"step\\": \\"Rejection Email\\", \\"state\\": \\"Rejected\\", \\"rejected\\": true, \\"workflowStepId\\": \\"102\\"}");
end

rule "High Volume - step a - Action - from Initial"
when
    $j : JobApplication(currentState == "Initial", volume > 1000)
then
    $j.setResult("{\\"step\\": \\"Auto Filter\\", \\"state\\": \\"Processing\\", \\"rejected\\": false, \\"workflowStepId\\": \\"201\\"}");
end

rule "High Volume - step b - Action - from Initial"
when
    $j : JobApplication(currentState == "Initial")
then
    $j.setResult("{\\"step\\": \\"Standard Review\\", \\"state\\": \\"Review\\", \\"rejected\\": false, \\"workflowStepId\\": \\"202\\"}");
end

rule "Executive - step a - Action - from Review"
when
    $j : JobApplication(currentState == "Review", isVip == true)
then
    $j.setResult("{\\"step\\": \\"Partner Interview\\", \\"state\\": \\"Final Phase\\", \\"rejected\\": false, \\"workflowStepId\\": \\"301\\"}");
end
`;

export default function App() {
  const [drlInput, setDrlInput] = useState(SAMPLE_DRL);
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>([]);
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [selectedTransition, setSelectedTransition] = useState<Transition | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [showFlowPopup, setShowFlowPopup] = useState(false);
  const [viewMode, setViewMode] = useState<'editor' | 'map'>('editor');
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isCopied, setIsCopied] = useState(false);

  const allConditions = useMemo(() => {
    // Flatten all transitions from all groups and get their conditions
    const conditions = workflowGroups.flatMap((g: WorkflowGroup) => g.transitions)
      .filter((t: Transition) => t.hasCondition && t.conditions.trim())
      .map((t: Transition) => t.conditions.trim());
    
    // Return unique conditions
    return [...new Set(conditions)];
  }, [workflowGroups]);

  const totalConditionsCount = useMemo(() => {
    return workflowGroups.reduce((acc, g) => {
      return acc + g.transitions.filter(t => t.hasCondition && t.conditions.trim()).length;
    }, 0);
  }, [workflowGroups]);

  const totalRulesCount = useMemo(() => {
    return workflowGroups.reduce((acc, g) => acc + g.transitions.length, 0);
  }, [workflowGroups]);

  const handleCopyConditions = () => {
    if (allConditions.length === 0) return;
    
    const textToCopy = `Total Conditions: ${allConditions.length}\n\n` + 
      allConditions.map((c, i) => `${i + 1}. ${c}`).join('\n');
    
    navigator.clipboard.writeText(textToCopy).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const currentGroup = useMemo(() => {
    return workflowGroups.find((g: WorkflowGroup) => g.stage === selectedStage);
  }, [workflowGroups, selectedStage]);

  const cardRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  // Build the complete tree starting from common entry points
  const fullWorkflowTree = useMemo(() => {
    if (!currentGroup) return null;
    const all = currentGroup.transitions;
    
    // Identify entry points (states that aren't a 'toState' for any transition, or just defaults like Review)
    const allToStates = new Set(all.map((t: Transition) => t.toState.trim().toLowerCase()));
    let roots = [...new Set(all.map((t: Transition) => t.fromState))].filter((s: string) => !allToStates.has(s.trim().toLowerCase()));
    
    if (roots.length === 0 && all.length > 0) roots = ["Review"]; // Default fallback

    const buildTree = (state: string, path: string = "", depth: number = 0, visited: Record<string, number> = {}): any => {
      const currentId = path ? `${path} -> ${state}` : state;
      const htmlId = currentId.replace(/\s+/g, '-').replace(/->/g, 'to');
      
      const stateKey = state.toLowerCase();
      const count = visited[stateKey] || 0;

      // Allow 2 occurrences in a path to handle status re-entry/loops (Round 1 -> Round 2 etc)
      if (depth > 12 || count >= 2) {
        return { 
          id: currentId,
          htmlId,
          state, 
          children: [],
          isTrulyTerminal: !all.some((t: Transition) => t.fromState.trim().toLowerCase() === state.trim().toLowerCase())
        };
      }
      
      const newVisited = { ...visited, [stateKey]: count + 1 };

      const nextTransitions = all.filter((t: Transition) => t.fromState.trim().toLowerCase() === state.trim().toLowerCase());
      const nextStates = [...new Set(nextTransitions.map((t: Transition) => t.toState))];

      return {
        id: currentId,
        htmlId,
        state,
        isTrulyTerminal: nextTransitions.length === 0,
        children: nextStates.map((ns: string) => buildTree(ns, currentId, depth + 1, newVisited))
      };
    };

    return roots.map((r: string) => buildTree(r));
  }, [currentGroup]);

  const handleParse = () => {
    const groups = parseDrl(drlInput);
    setWorkflowGroups(groups);
    if (groups.length > 0) {
      setSelectedStage(groups[0].stage);
    }
    setSelectedTransition(null);
    setExplanations({}); 
    setShowFlowPopup(false);
  };

  const handleSelectTransition = (transition: Transition) => {
    setSelectedTransition(transition);
    
    // Scroll Inspector to the card
    const element = cardRefs.current[transition.id];
    if (element) {
      setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  };

  const handleExplain = (transition: Transition) => {
    if (explanations[transition.id]) return;
    const result = translateLogic(transition.conditions);
    setExplanations(prev => ({ ...prev, [transition.id]: result }));
  };

  // Lineage calculation for the state flow popup
  const lineage = useMemo(() => {
    if (!selectedTransition || !currentGroup) return null;
    
    const t = selectedTransition;
    const all = currentGroup.transitions;
    
    // 1. Previous: Unique states that end where this one starts
    const previousRules = all.filter((p: Transition) => 
      p.toState.trim().toLowerCase() === t.fromState.trim().toLowerCase()
    );
    const parentStates = [...new Set(previousRules.map((p: Transition) => p.fromState))];

    // 2. Current vantage point
    const currentFrom = t.fromState;

    // 3. Unique Alternatives: Group possible branches by destination state
    const branchesAtState = all.filter((a: Transition) => 
      a.fromState.trim().toLowerCase() === t.fromState.trim().toLowerCase()
    );
    
    const uniqueBranches = Array.from(new Set(branchesAtState.map((b: Transition) => b.toState))).map((stateName: string) => {
      return {
        toState: stateName,
        isPrimary: stateName.trim().toLowerCase() === t.toState.trim().toLowerCase()
      };
    });

    // 4. Next Steps: Unique states reachable from the target state
    const nextRules = all.filter((n: Transition) => 
      n.fromState.trim().toLowerCase() === t.toState.trim().toLowerCase()
    );
    const uniqueNextStates = [...new Set(nextRules.map((ns: Transition) => ns.toState))];

    return {
      parents: parentStates,
      entry: currentFrom,
      branches: uniqueBranches,
      targetState: t.toState,
      nextSteps: uniqueNextStates
    };
  }, [selectedTransition, currentGroup]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const content = e.target?.result as string;
      setDrlInput(content);
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    handleParse();
  }, []); 

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-brand-bg text-brand-text">
       {viewMode === 'editor' ? (
        <>
          {/* HEADER */}
          <header className="h-16 bg-white border-b border-brand-border flex items-center justify-between px-6 z-10 shrink-0 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-brand-accent p-2 rounded text-white shadow-sm shadow-blue-200">
                <Workflow className="w-5 h-5" />
              </div>
              <span className="font-bold text-xl tracking-tight text-slate-900">RuleFlow<span className="text-brand-accent">DRL</span></span>
            </div>

            <div className="hidden md:flex items-center gap-4 w-1/3">
              <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider whitespace-nowrap">Active Stage</label>
              <div className="relative flex-1">
                <select
                  value={selectedStage}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedStage(e.target.value)}
                  className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 transition-all cursor-pointer hover:bg-slate-100 focus:ring-2 focus:ring-blue-100 outline-none"
                >
                  {workflowGroups.length === 0 && <option value="">No stages found</option>}
                  {workflowGroups.map((g: WorkflowGroup) => (
                    <option key={g.stage} value={g.stage}>
                      {g.stage}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div className="flex gap-2">
              <label className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold border border-slate-200 cursor-pointer hover:bg-slate-200 transition-all flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload DRL
                <input 
                  type="file" 
                  accept=".drl,.txt" 
                  className="hidden" 
                  onChange={handleFileUpload}
                />
              </label>
              <button 
                onClick={() => {
                  setHighlightedNodeId(null);
                  setViewMode('map');
                }}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-[11px] font-bold border border-slate-800 shadow-lg hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2"
              >
                <Workflow className="w-3.5 h-3.5 text-blue-400" />
                Full Workflow Map
              </button>
              <button 
                onClick={handleParse}
                className="px-4 py-2 bg-brand-accent text-white rounded-lg text-sm font-bold shadow-md shadow-blue-100 hover:bg-blue-600 transition-all active:scale-95 flex items-center gap-2"
              >
                <Play className="w-3 h-3 fill-current" />
                Parse DRL
              </button>
            </div>
          </header>

      <div className="flex-1 flex overflow-hidden">
        {/* SIDEBAR */}
        <aside className="w-80 bg-brand-sidebar text-white flex flex-col shrink-0 border-r border-slate-700">
          <div className="p-6 space-y-8 flex-1 overflow-y-auto">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Input Source</h3>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-800 rounded border border-slate-700">
                  <FileCode className="w-3 h-3 text-blue-400" />
                  <span className="text-[9px] font-bold text-slate-300 truncate max-w-[100px]">
                    {fileName || (drlInput === SAMPLE_DRL ? 'SAMPLE' : 'Custom')}
                  </span>
                </div>
              </div>
              <div className="relative group">
                <textarea
                  value={drlInput}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    setDrlInput(e.target.value);
                    if (fileName) setFileName(null);
                  }}
                  className="w-full h-[400px] bg-[#0f172a] text-[#94a3b8] font-mono text-[11px] p-4 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors resize-none leading-relaxed"
                  placeholder="Paste DRL here..."
                />
                <button
                  onClick={() => setDrlInput('')}
                  className="absolute right-4 bottom-4 p-2 bg-slate-800 text-slate-400 rounded-md hover:text-red-400 transition-colors border border-slate-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-4">Workflow Stats</h3>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50 flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-white leading-none">{totalRulesCount}</div>
                  <div className="text-[7px] text-slate-400 font-bold uppercase tracking-tighter mt-1.5 text-center">Total Steps</div>
                </div>
                <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50 flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-white leading-none">{totalConditionsCount}</div>
                  <div className="text-[7px] text-slate-400 font-bold uppercase tracking-tighter mt-1.5 text-center">Conditions</div>
                </div>
                <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/50 flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-white leading-none">{workflowGroups.length}</div>
                  <div className="text-[7px] text-slate-400 font-bold uppercase tracking-tighter mt-1.5 text-center">Stages</div>
                </div>
              </div>
              <p className="text-[7px] text-slate-500 mb-6 italic px-1 opacity-80">
                * Analysis reflects the entire DRL rulesheet content.
              </p>

              {allConditions.length > 0 && (
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">DRL Logic Analysis</span>
                    </div>
                    <span className="text-[10px] font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
                      {allConditions.length} Unique
                    </span>
                  </div>
                  
                  <button
                    onClick={handleCopyConditions}
                    disabled={allConditions.length === 0}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95",
                      isCopied 
                        ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                        : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                    )}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Conditions Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy All Conditions
                      </>
                    )}
                  </button>
                  <p className="text-[9px] text-slate-500 mt-2 text-center italic">
                    Includes all criteria across {workflowGroups.length} stages
                  </p>
                </div>
              )}
            </section>
          </div>

          <div className="p-6 border-t border-slate-700 bg-slate-900/50">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
              <span>Engine Status: Active</span>
            </div>
          </div>
        </aside>

        {/* CANVAS */}
        <main className="flex-1 overflow-hidden relative bg-[#f1f5f9]">
          <AnimatePresence mode="wait">
            {currentGroup ? (
              <motion.div
                key={selectedStage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full"
              >
                <WorkflowGraph 
                  transitions={currentGroup.transitions} 
                  onSelectTransition={handleSelectTransition}
                  selectedId={selectedTransition?.id}
                />
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50">
                <Workflow className="w-16 h-16 mb-4 opacity-20" />
                <p className="font-bold text-xl text-slate-300">No active visualization</p>
                <p className="text-sm text-slate-400 mt-2">Paste DRL in the sidebar and click Parse</p>
              </div>
            )}
          </AnimatePresence>
        </main>

        <aside className="w-96 bg-white border-l border-brand-border flex flex-col shrink-0 overflow-hidden">
          <div className="p-6 h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">Properties Inspector</h3>
              {selectedTransition && (
                <button 
                  onClick={() => setSelectedTransition(null)}
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all flex items-center gap-1"
                >
                  Clear Selection
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-4">
              <AnimatePresence mode="popLayout">
                {currentGroup?.transitions.map((t: Transition, i: number) => {
                  const isSelected = selectedTransition?.id === t.id;
                  const explanation = explanations[t.id];

                  return (
                    <motion.div
                      key={t.id}
                      ref={el => { cardRefs.current[t.id] = el; }}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ 
                        opacity: 1, 
                        x: 0,
                        scale: isSelected ? 1.02 : 1,
                        borderColor: isSelected ? '#3b82f6' : '#e2e8f0',
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.03)' : '#fff'
                      }}
                      transition={{ 
                        delay: i * 0.05,
                        scale: { type: 'spring', stiffness: 300, damping: 20 }
                      }}
                      onClick={() => handleSelectTransition(t)}
                      className={cn(
                        "group cursor-pointer bg-white border rounded-xl p-4 transition-all duration-300",
                        isSelected ? "shadow-lg shadow-blue-100 border-blue-400" : "hover:border-slate-300 hover:shadow-sm"
                      )}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <span className={cn(
                          "text-[9px] font-extrabold tracking-widest uppercase",
                          isSelected ? "text-blue-500" : "text-slate-400"
                        )}>
                          {t.ruleName.split(' - ')[1] || 'RULE'}
                        </span>
                        <div className="flex gap-1">
                          {isSelected && (
                            <div className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[8px] font-black uppercase flex items-center gap-1 animate-pulse">
                              <Target className="w-2.5 h-2.5" />
                              Active Selection
                            </div>
                          )}
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase",
                            t.rejected ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                          )}>
                            {t.rejected ? 'Rejected' : 'Success'}
                          </div>
                        </div>
                      </div>
                      
                      <div className={cn(
                        "flex items-center gap-2 mb-4 px-2 py-1.5 rounded-lg border transition-colors",
                        isSelected ? "bg-blue-50 border-blue-100" : "bg-slate-50 border-slate-100"
                      )}>
                        <span className="text-[11px] font-bold text-slate-600 truncate">{t.fromState}</span>
                        <ArrowRightCircle className={cn("w-3 h-3", isSelected ? "text-blue-400" : "text-slate-300")} />
                        <span className="text-[11px] font-bold text-slate-900 truncate">{t.toStep}</span>
                      </div>

                      {t.hasCondition && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Gate Conditions</label>
                            <button 
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleExplain(t);
                              }}
                              className={cn(
                                "text-[9px] font-black uppercase flex items-center gap-1.5 transition-colors",
                                explanation ? "text-emerald-500" : "text-blue-500 hover:text-blue-600"
                              )}
                            >
                              {explanation ? <Info className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                              {explanation ? "Explained" : "Explain Local Logic"}
                            </button>
                          </div>
                          <div className={cn(
                            "p-3 rounded-lg text-[10px] font-mono leading-relaxed break-all transition-all",
                            isSelected ? "bg-slate-900 text-amber-400" : "bg-amber-50 text-amber-800 border border-amber-100"
                          )}>
                            {t.conditions}
                          </div>

                          {isSelected && (
                            <button 
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                setSelectedTransition(t);
                                setShowFlowPopup(true);
                              }}
                              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-500 text-white text-[10px] font-bold uppercase hover:bg-blue-600 transition-all shadow-md shadow-blue-100"
                            >
                              <Workflow className="w-3 h-3" />
                              View State Flow Lineage
                            </button>
                          )}
                          
                          <AnimatePresence>
                            {explanation && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 overflow-hidden shadow-sm shadow-emerald-50"
                              >
                                <div className="text-[10px] text-emerald-900 font-medium leading-relaxed whitespace-pre-line italic">
                                  {explanation}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                      
                      {isSelected && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 pt-4 border-t border-blue-100 flex items-center gap-2"
                        >
                          <div className="flex-1 text-[9px] text-blue-400 font-bold italic">
                            Node centered in canvas view
                          </div>
                          <Target className="w-3 h-3 text-blue-300" />
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </aside>
      </div>
      {/* FLOW LINEAGE POPUP */}
      <AnimatePresence>
        {showFlowPopup && lineage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFlowPopup(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-white"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">System State Lineage</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Vantage: {lineage.entry}</p>
                  </div>
                  <button 
                    onClick={() => setShowFlowPopup(false)}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="flex flex-col items-center overflow-hidden">
                  {/* PARENTS */}
                  <div className="flex gap-4 mb-6 overflow-x-auto w-full justify-start px-8 pb-2 no-scrollbar">
                    {lineage.parents.length > 0 ? lineage.parents.map((p: string) => (
                      <div key={p} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-500 shadow-sm transition-all hover:border-slate-300 whitespace-nowrap">
                        {p}
                      </div>
                    )) : (
                      <div className="px-4 py-2 bg-slate-200/50 rounded-lg text-[11px] font-bold text-slate-400 mx-auto">Entry Point</div>
                    )}
                  </div>

                  {/* VERTICAL LINE */}
                  <div className="w-px h-8 bg-gradient-to-b from-slate-200 to-blue-500 mb-2" />

                  {/* VANTAGE POINT */}
                  <div className="px-8 py-4 bg-blue-500 text-white rounded-2xl shadow-xl shadow-blue-200 font-black text-sm tracking-wide z-10 scale-110 mb-4 animate-pulse uppercase">
                    {lineage.entry}
                  </div>

                  {/* FORK HEADER */}
                  <div className="w-full relative mb-8">
                    <div className="absolute top-[32px] left-0 right-0 h-px bg-slate-200" />
                    <div className="flex w-full items-start overflow-x-auto pb-6 px-4 gap-6 no-scrollbar justify-start">
                      {lineage.branches.map((b: { toState: string; isPrimary: boolean }, idx: number) => {
                        const isPrimary = b.isPrimary;
                        return (
                          <div key={b.toState} className="flex flex-col items-center relative group min-w-[140px] pt-8 first:ml-auto last:mr-auto">
                            {/* Connector line up to horizontal bar */}
                            <div className="absolute top-0 w-px h-8 bg-slate-200 select-none group-hover:bg-blue-300 transition-colors" />
                            
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.1 }}
                              className={cn(
                                "w-full px-4 py-3 rounded-xl border text-center transition-all",
                                isPrimary 
                                  ? "bg-slate-900 text-white border-slate-900 shadow-lg scale-105 z-20" 
                                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600 shadow-sm"
                              )}
                            >
                              <div className="text-[9px] font-black uppercase tracking-tighter mb-1 opacity-60">
                                {isPrimary ? "Selected Target" : "Alternative"}
                              </div>
                              <div className="text-[11px] font-bold leading-tight truncate">
                                {b.toState}
                              </div>
                            </motion.div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-slate-100 w-full">
                    <h3 className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center justify-center gap-2">
                       <ArrowRightCircle className="w-3 h-3 text-blue-500" />
                       Next Possible Steps from {lineage.targetState}
                    </h3>
                    
                    <div className="flex overflow-x-auto gap-3 pb-4 px-8 justify-start w-full no-scrollbar">
                      {lineage.nextSteps.length > 0 ? lineage.nextSteps.map((ns: string, idx: number) => (
                        <motion.div
                          key={ns}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.5 + (idx * 0.1) }}
                          className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-[10px] font-bold shadow-sm whitespace-nowrap hover:bg-emerald-100 transition-colors"
                        >
                          {ns}
                        </motion.div>
                      )) : (
                        <div className="text-[10px] text-slate-300 font-bold italic py-4 bg-slate-50/50 w-full text-center rounded-xl border border-dashed border-slate-200">
                          Terminal Stage (No subsequent transitions found in this ruleset)
                        </div>
                      )}
                    </div>

                    <p className="text-[9px] text-slate-400 font-medium italic mt-8 text-center opacity-70">
                      Workflow visualization based on the {selectedStage} definition stage.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        </>
      ) : (
        /* FULL LIFECYCLE MAP VIEW */
        <div className="h-screen flex flex-col bg-slate-950 text-white overflow-hidden">
          {/* MAP HEADER */}
          <header className="h-20 shrink-0 bg-slate-900 border-b border-white/5 flex items-center justify-between px-10 z-10 shadow-2xl">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setViewMode('editor')}
                className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all text-slate-400 hover:text-white group"
              >
                <X className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </button>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Workflow className="w-5 h-5 text-blue-400" />
                  <h2 className="text-xl font-black tracking-tight text-white">Lifecycle Logic Architecture</h2>
                </div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">{selectedStage} Stage Context</p>
              </div>
            </div>

            <div className="flex items-center gap-8">
               <div className="flex items-center gap-4 bg-slate-800/50 p-1 rounded-2xl border border-white/5 mr-4">
                  <button 
                    onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
                    className="p-2 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
                  >
                    <span className="text-xl font-bold">-</span>
                  </button>
                  <span className="text-[10px] font-black w-12 text-center text-slate-300">{(zoom * 100).toFixed(0)}%</span>
                  <button 
                    onClick={() => setZoom(z => Math.min(2, z + 0.1))}
                    className="p-2 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
                  >
                    <span className="text-xl font-bold">+</span>
                  </button>
               </div>

               <div className="flex items-center gap-6 bg-slate-800/50 px-6 py-3 rounded-2xl border border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_12px_rgba(59,130,246,0.8)]"></div>
                    <span className="text-[10px] font-black uppercase text-slate-400">Entry State</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 bg-slate-900 border-2 border-slate-600 rounded-full"></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase text-slate-400">Intermediate State</span>
                      <span className="text-[7px] font-bold text-slate-600 uppercase">Transitions Possible</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.5)]"></div>
                    <span className="text-[10px] font-black uppercase text-slate-400">Final Step</span>
                  </div>
                </div>
                <button 
                  onClick={() => setViewMode('editor')}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-500 transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                >
                  Editor Mode
                </button>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-24 scrollbar-hide bg-[radial-gradient(circle_at_center,rgba(30,58,138,0.15),transparent_70%)] relative">
            <div 
              className="min-w-max flex flex-col items-center transition-transform duration-300 ease-out origin-top"
              style={{ transform: `scale(${zoom})` }}
            >
              {fullWorkflowTree?.map((root: any, rIdx: number) => (
                <div key={rIdx} className="mb-40 last:mb-0">
                  <WorkflowLevel node={root} level={0} highlight={highlightedNodeId} />
                </div>
              ))}
            </div>
          </main>
          
          <footer className="h-12 shrink-0 bg-slate-900 border-t border-white/5 flex items-center justify-center px-10">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em] opacity-40">
              Interactive Logic Visualization Engine • Real-time Rule Sync
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}

// Recursive component for the full workflow tree
function WorkflowLevel({ node, level, highlight }: { node: any, level: number, highlight?: string | null }) {
  const isHighlighted = highlight && node.id === highlight;
  const isTerminal = node.isTrulyTerminal;

  useEffect(() => {
    if (isHighlighted) {
      setTimeout(() => {
        document.getElementById(`node-${node.htmlId}`)?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'center'
        });
      }, 300);
    }
  }, [isHighlighted, node.htmlId]);

  return (
    <div className="flex flex-col items-center relative" id={`node-${node.htmlId}`}>
      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.9 }}
        animate={{ 
          opacity: 1, 
          y: 0, 
          scale: isHighlighted ? 1.15 : 1,
          zIndex: isHighlighted ? 10 : 1
        }}
        transition={{ 
          delay: level * 0.05,
          scale: { type: "spring", stiffness: 300, damping: 15 }
        }}
        className={cn(
          "px-8 py-4 rounded-2xl border-2 font-black text-sm min-w-[200px] text-center transition-all shadow-2xl relative",
          level === 0 
            ? "bg-blue-600 text-white border-blue-400 shadow-blue-500/20" 
            : isTerminal 
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" 
              : "bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-400",
          isHighlighted && "ring-[8px] ring-blue-500/30 border-blue-400 shadow-blue-500/40 bg-blue-600 text-white"
        )}
      >
        {isHighlighted && (
           <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap animate-bounce shadow-xl border border-white/20">
             Selected Step
           </div>
        )}
        <span className="uppercase tracking-tight inline-block mb-1">{node.state}</span>
        <div className={cn(
          "text-[8px] font-black uppercase tracking-[0.2em] opacity-50",
          level === 0 && "text-blue-200 opacity-100",
          isTerminal && "text-emerald-400 opacity-100"
        )}>
          {level === 0 ? "Entry point" : isTerminal ? "Final Step" : "Active status"}
        </div>
      </motion.div>

      {node.children && node.children.length > 0 && (
        <div className="flex flex-col items-center mt-10">
          <div className="w-px h-10 bg-gradient-to-b from-slate-700 to-slate-500" />
          <div className="flex items-start gap-12 relative pt-10">
            {node.children.length > 1 && (
              <div className="absolute top-0 left-[100px] right-[100px] h-px bg-slate-700" />
            )}
            
            {node.children.map((child: any, idx: number) => (
              <div key={idx} className="flex flex-col items-center relative">
                <div className="absolute top-[-40px] w-px h-10 bg-slate-700" />
                <WorkflowLevel node={child} level={level + 1} highlight={highlight} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


