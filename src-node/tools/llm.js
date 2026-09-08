/**
 * LLM/Ollama integration tools (AI-powered features)
 * 
 * AI-powered features using locally hosted LLM via Ollama
 * Gracefully degrades if Ollama is not running
 */

import { ollamaClient } from '../api/ollama-client.js';
import { db } from '../index.js';

/**
 * Strip the conversational wrapping small models add around short answers, so
 * the value can be dropped straight into a task-name or note field.
 */
function cleanLlmText(text) {
  let value = String(text ?? '').trim();

  // Reasoning models emit a <think> block before the actual answer.
  value = value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  value = value.replace(/^[\s\S]*?<\/think>/i, '').trim();

  // Unwrap a fenced code block if the model wrapped its answer in one.
  const fenced = value.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) value = fenced[1].trim();

  // Drop a leading preamble such as "Enhanced version:" or "Task name:".
  value = value.replace(/^(?:here(?:'s| is)[^:\n]*|enhanced version|enhanced note|revised note|rewritten note|task name|suggested task name|answer|sure[^:\n]*)\s*[:\-]\s*/i, '');
  value = value.trim();

  // Drop matching wrapping quotes.
  const pairs = [['"', '"'], ["'", "'"], ['\u201c', '\u201d']];
  for (const [open, close] of pairs) {
    if (value.length > 1 && value.startsWith(open) && value.endsWith(close)) {
      value = value.slice(open.length, -close.length).trim();
      break;
    }
  }

  // Models often append a trailing rationale after the answer; drop any
  // paragraph that is clearly commentary about the rewrite.
  const paragraphs = value.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const commentary = /^(?:this (?:version|rewrite|note)|i (?:have|'ve)|let me know|note that|the (?:above|rewritten|enhanced))/i;
    const kept = paragraphs.filter(p => !commentary.test(p));
    if (kept.length > 0) value = kept.join('\n\n');
  }

  return value.trim();
}

export const tools = [
  {
    name: 'generate_daily_summary',
    description: 'Generate a professional daily work summary from time entries and notes',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format' },
        style: { type: 'string', enum: ['professional', 'casual', 'technical', 'executive'], description: 'Summary style' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        // Validate date
        if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }

        // Fetch entries and notes for the date
        const entries = db.prepare(`
          SELECT name, duration_mins FROM daily_summary 
          WHERE date = ? 
          ORDER BY name
        `).all(args.date);

        const notes = db.prepare(`
          SELECT note, topic FROM notes 
          WHERE date = ? 
          ORDER BY topic
        `).all(args.date);

        if (entries.length === 0 && notes.length === 0) {
          return {
            success: false,
            message: `No entries or notes for ${args.date}`,
            date: args.date,
            fallback: `Summary for ${args.date}: No entries recorded.`
          };
        }

        // Check if Ollama is available
        const available = await ollamaClient.initialize();
        if (!available) {
          // Fallback: Generate simple bullet-point summary
          const entryText = entries.length > 0
            ? `Work entries:\n${entries.map(e => `- ${e.name} (${e.duration_mins} mins)`).join('\n')}`
            : 'No work entries';

          const noteText = notes.length > 0
            ? `Notes:\n${notes.map(n => `- [${n.topic}] ${n.note}`).join('\n')}`
            : 'No notes';

          return {
            success: false,
            message: 'LLM not available. Using fallback summary.',
            date: args.date,
            entries: entries,
            notes: notes,
            fallback: `${entryText}\n\n${noteText}`
          };
        }

        // Format entries and notes for LLM
        const entrySummary = entries.length > 0
          ? `Work entries:\n${entries.map(e => `- ${e.name} (${e.duration_mins} mins)`).join('\n')}`
          : 'No work entries';

        const noteSummary = notes.length > 0
          ? `Notes:\n${notes.map(n => `- [${n.topic}] ${n.note}`).join('\n')}`
          : 'No notes';

        const fullText = `${entrySummary}\n\n${noteSummary}`;

        const style = args.style || 'professional';
        const styleGuide = {
          professional: 'Make it professional and suitable for business communication.',
          casual: 'Make it friendly and conversational.',
          technical: 'Focus on technical details and accomplishments.',
          executive: 'Make it concise and high-level, suitable for executives.'
        };

        const prompt = `${styleGuide[style]}

Generate a daily work summary for ${args.date} from this log:

${fullText}

Provide a clear, well-structured summary of the day's work.`;

        const result = await ollamaClient.generate(prompt);

        return {
          success: true,
          message: '✅ Summary generated',
          date: args.date,
          summary: result.response.trim(),
          model: result.model,
          entryCount: entries.length,
          noteCount: notes.length,
          style: style
        };
      } catch (error) {
        return {
          success: false,
          message: `Summary generation failed: ${error.message}`,
          date: args.date,
          fallback: 'Unable to generate summary. Please create a manual entry.'
        };
      }
    }
  },
  {
    name: 'categorize_entry',
    description: 'Use LLM to automatically categorize a work entry',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Entry description to categorize' },
        categories: { 
          type: 'array', 
          description: 'Optional list of categories to choose from'
        }
      },
      required: ['description']
    },
    handler: async (args) => {
      try {
        // Check if Ollama is available
        const available = await ollamaClient.initialize();
        if (!available) {
          return {
            success: false,
            message: 'LLM not available',
            original: args.description,
            fallback: 'Uncategorized'
          };
        }

        const categoryList = args.categories && args.categories.length > 0
          ? args.categories.join(', ')
          : 'Development, Meetings, Documentation, Review, Testing, Deployment, Admin, Other';

        const prompt = `Categorize this work entry into ONE of these categories: ${categoryList}

Entry: "${args.description}"

Return ONLY the category name, nothing else.`;

        const result = await ollamaClient.generate(prompt);
        const category = result.response.trim().split('\n')[0].trim();
        
        return {
          success: true,
          message: `✅ Entry categorized as: ${category}`,
          original: args.description,
          category: category,
          model: result.model
        };
      } catch (error) {
        return {
          success: false,
          message: `Categorization failed: ${error.message}`,
          original: args.description,
          fallback: 'Other',
          error: error.message
        };
      }
    }
  },
  {
    name: 'identify_untracked_work',
    description: 'Identify potential gaps and untracked work from daily entries',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format' },
        workingHours: { type: 'number', description: 'Expected working hours (default: 8)' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        // Validate date
        if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }

        const workingHours = args.workingHours || 8;
        const workingMins = workingHours * 60;

        // Fetch entries for the date
        const entries = db.prepare(`
          SELECT name, duration_mins FROM daily_summary 
          WHERE date = ? 
          ORDER BY name
        `).all(args.date);

        const totalMins = entries.reduce((sum, e) => sum + e.duration_mins, 0);
        const unaccountedMins = Math.max(0, workingMins - totalMins);

        // Check if Ollama is available
        const available = await ollamaClient.initialize();
        if (!available) {
          // Fallback: Basic gap analysis
          const gaps = [];
          if (unaccountedMins > 30) {
            gaps.push(`${Math.ceil(unaccountedMins / 60)}+ hours unaccounted for`);
          }
          if (entries.length === 0) {
            gaps.push('No work entries recorded');
          }
          
          return {
            success: false,
            message: 'LLM not available. Using basic gap analysis.',
            date: args.date,
            totalHours: (totalMins / 60).toFixed(2),
            expectedHours: workingHours,
            gaps: gaps,
            entries: entries.length
          };
        }

        // Format entries for LLM analysis
        const entryList = entries.length > 0
          ? entries.map(e => `- ${e.name} (${e.duration_mins} mins)`).join('\n')
          : 'No entries';

        const prompt = `Analyze this work day log and identify gaps, incomplete tasks, or potential follow-ups.

Date: ${args.date}
Expected working hours: ${workingHours}
Total logged hours: ${(totalMins / 60).toFixed(2)}
Unaccounted time: ${(unaccountedMins / 60).toFixed(2)} hours

Logged entries:
${entryList}

Identify:
1. Any obvious gaps or missing work categories
2. Potential incomplete tasks that might need follow-up
3. Suggested follow-up items for the next day

Format as a concise list.`;

        const result = await ollamaClient.generate(prompt);

        return {
          success: true,
          message: '✅ Work gaps identified',
          date: args.date,
          totalHours: (totalMins / 60).toFixed(2),
          expectedHours: workingHours,
          unaccountedHours: (unaccountedMins / 60).toFixed(2),
          analysis: result.response.trim(),
          model: result.model,
          entryCount: entries.length
        };
      } catch (error) {
        return {
          success: false,
          message: `Gap analysis failed: ${error.message}`,
          date: args.date,
          error: error.message
        };
      }
    }
  },
  // Backward compatibility: Keep the old names as aliases
  {
    name: 'llm_categorize_task',
    description: 'Use LLM to automatically categorize task from description (deprecated: use categorize_entry)',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Task description to categorize' },
        categories: { 
          type: 'array', 
          description: 'Optional list of categories'
        }
      },
      required: ['description']
    },
    handler: async (args) => {
      try {
        const available = await ollamaClient.initialize();
        if (!available) {
          return {
            success: false,
            message: 'LLM not available for task categorization',
            textResultForLlm: 'LLM not available. Install Ollama: https://ollama.ai',
            resultType: 'failure'
          };
        }

        const result = await ollamaClient.categorizeText(
          args.description,
          args.categories
        );

        if (result.success) {
          return {
            success: true,
            message: `✅ Task categorized as: ${result.category}`,
            category: result.category,
            model: result.model,
            description: args.description
          };
        } else {
          return {
            success: false,
            message: `Could not categorize. Falling back to: ${result.fallback}`,
            category: result.fallback,
            error: result.error
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Task categorization failed: ${error.message}`,
          textResultForLlm: `Task categorization failed: ${error.message}`,
          resultType: 'failure'
        };
      }
    }
  },
  {
    name: 'llm_generate_summary',
    description: 'Generate daily work summary from time entries and notes (deprecated: use generate_daily_summary)',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format' },
        style: { type: 'string', enum: ['professional', 'casual', 'technical'], description: 'Summary style' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }

        const entries = db.prepare(`
          SELECT name, duration_mins FROM daily_summary 
          WHERE date = ? 
          ORDER BY name
        `).all(args.date);

        const notes = db.prepare(`
          SELECT note, topic FROM notes 
          WHERE date = ? 
          ORDER BY topic
        `).all(args.date);

        if (entries.length === 0 && notes.length === 0) {
          return `No entries or notes for ${args.date}`;
        }

        const available = await ollamaClient.initialize();
        if (!available) {
          return {
            success: false,
            message: 'LLM not available for summary generation',
            fallback: `Work summary for ${args.date}: ${entries.length} entries, ${notes.length} notes`,
            entries: entries,
            notes: notes
          };
        }

        const entrySummary = entries.length > 0
          ? `Work entries:\n${entries.map(e => `- ${e.name} (${e.duration_mins} mins)`).join('\n')}`
          : 'No work entries';

        const noteSummary = notes.length > 0
          ? `Notes:\n${notes.map(n => `- [${n.topic}] ${n.note}`).join('\n')}`
          : 'No notes';

        const fullText = `${entrySummary}\n\n${noteSummary}`;

        const style = args.style || 'professional';
        const prompt = `Generate a ${style} daily work summary from this log for ${args.date}:

${fullText}

Provide a concise summary of the day's work.`;

        const result = await ollamaClient.generate(prompt);

        return {
          success: true,
          message: '✅ Summary generated',
          date: args.date,
          summary: result.response.trim(),
          model: result.model,
          entryCount: entries.length,
          noteCount: notes.length,
          style: style
        };
      } catch (error) {
        return {
          success: false,
          message: `Summary generation failed: ${error.message}`,
          textResultForLlm: `Summary generation failed: ${error.message}`,
          resultType: 'failure'
        };
      }
    }
  }
];
