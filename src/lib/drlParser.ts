export interface Transition {
  id: string;
  ruleName: string;
  stage: string;
  stepId: string;
  type: string;
  fromState: string;
  toStep: string;
  toState: string;
  rejected: boolean;
  workflowStepId: string;
  hasCondition: boolean;
  conditions: string;
}

export interface WorkflowGroup {
  stage: string;
  transitions: Transition[];
}

export function parseDrl(drlContent: string): WorkflowGroup[] {
  const rules = drlContent.split(/^rule\s+/m).filter(r => r.trim().length > 0);
  const transitions: Transition[] = [];

  rules.forEach((ruleText, index) => {
    try {
      // 1. Extract Rule Name
      const nameMatch = ruleText.match(/"([^"]+)"/);
      if (!nameMatch) return;
      const ruleName = nameMatch[1];
      
      // Attempt to extract Stage from parentheses: "Job Application (Default Definition)" -> "Default Definition"
      const stageMatch = ruleName.match(/\(([^)]+)\)/);
      let stage = stageMatch ? stageMatch[1] : "";
      
      // If no parentheses, fallback to dash separation or the whole name
      if (!stage) {
        const nameParts = ruleName.split(" - ");
        stage = nameParts[0]?.trim() || "Unknown Stage";
      }

      // Try to find Step ID (e.g., "step a")
      const stepIdMatch = ruleName.match(/step\s+([a-zA-Z0-9]+)/i);
      const stepId = stepIdMatch ? stepIdMatch[0] : "";

      // Try to find Type (Action/Conclusion)
      const typeMatch = ruleName.match(/(Action|Conclusion)/i);
      const type = typeMatch ? typeMatch[0] : "Action";

      // 2. Extract When Block
      const whenBlockMatch = ruleText.match(/when([\s\S]*?)then/);
      if (!whenBlockMatch) return;
      const whenBlock = whenBlockMatch[1].trim();

      // 3. Extract From State
      const stateMatch = whenBlock.match(/currentState\s*==\s*"([^"]+)"/i);
      let fromState = stateMatch ? stateMatch[1] : "";
      
      // Fallback: look for "from [State]" in the rule name
      if (!fromState) {
        const fromMatch = ruleName.match(/from\s+([a-zA-Z0-9\s]+)$/i);
        fromState = fromMatch ? fromMatch[1].trim() : "Start";
      }

      // 4. Extract conditions (Balanced Parentheses approach)
      const wrappedStart = whenBlock.indexOf('(');
      let conditions = "";
      
      if (wrappedStart !== -1) {
        // Find everything inside the top-level parentheses of the main rule pattern
        const afterStart = whenBlock.substring(wrappedStart + 1);
        let balance = 1;
        let wrappedEnd = -1;
        for (let i = 0; i < afterStart.length; i++) {
          if (afterStart[i] === '(') balance++;
          else if (afterStart[i] === ')') balance--;
          
          if (balance === 0) {
            wrappedEnd = i;
            break;
          }
        }
        
        if (wrappedEnd !== -1) {
          conditions = afterStart.substring(0, wrappedEnd).trim();
        } else {
          // Fallback if parens aren't balanced
          conditions = afterStart.trim();
        }
      } else {
        // Fallback for simple patterns without parens
        conditions = whenBlock.replace(/^\$?\w+\s*:\s*\w+/, "").trim();
      }

      // Remove specific technical filters like currentState
      conditions = conditions
        .replace(/currentState\s*==\s*"[^"]*"\s*(?:&&\s*|\|\|\s*)*/gi, "")
        .replace(/(?:&&\s*|\|\|\s*)currentState\s*==\s*"[^"]*"/gi, "")
        .trim();

    // Clean up leading/trailing logic operators and commas
    conditions = conditions.replace(/^[,\s&|]+/, "").replace(/[,\s&|]+$/, "").trim();
    // Replace remaining commas with && for better readability
    conditions = conditions.replace(/,/g, " && ");
    
    const hasCondition = conditions.length > 2;

      // 5. Extract Then Block JSON
      const thenBlockMatch = ruleText.match(/then([\s\S]*?)end/);
      if (!thenBlockMatch) return;
      const thenBlock = thenBlockMatch[1].trim();
      
      const jsonMatch = thenBlock.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return;
      
      // Handle escaped JSON within the DRL string
      let jsonString = jsonMatch[0];
      
      // Clean up escaped quotes \" -> "
      let cleanedJson = jsonString.replace(/\\"/g, '"');
      
      let resultData;
      try {
        resultData = JSON.parse(cleanedJson);
      } catch (e) {
        // Fallback: simple regex search if JSON.parse fails
        // We look for both escaped and unescaped field names
        const findVal = (key: string) => {
          const regex = new RegExp(`[\\\\"]*${key}[\\\\"]*\\s*:\\s*[\\\\"]*([^\\\\",{}]+)[\\\\"]*`, 'i');
          const m = jsonString.match(regex);
          return m ? m[1].trim() : null;
        };

        resultData = {
          step: findVal('step') || "Unknown Step",
          state: findVal('state') || "Unknown State",
          rejected: (findVal('rejected') || "").toLowerCase() === 'true',
          workflowStepId: findVal('workflowStepId') || ""
        };
      }

      transitions.push({
        id: `rule-${index}`,
        ruleName,
        stage,
        stepId,
        type,
        fromState,
        toStep: resultData.step || "Unknown Step",
        toState: resultData.state || "Unknown State",
        rejected: !!resultData.rejected,
        workflowStepId: resultData.workflowStepId || "",
        hasCondition,
        conditions
      });
    } catch (e) {
      console.warn("Failed to parse rule:", ruleText.substring(0, 100), e);
    }
  });

  // Group by stage
  const groups: Record<string, Transition[]> = {};
  transitions.forEach(t => {
    if (!groups[t.stage]) groups[t.stage] = [];
    groups[t.stage].push(t);
  });

  return Object.entries(groups).map(([stage, transitions]) => ({
    stage: stage || "Default Definition",
    transitions
  }));
}
