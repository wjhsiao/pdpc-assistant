import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Load the PDPC data
  const dataPath = path.join(process.cwd(), 'src/data/pdpc_data.json');
  const pdpcData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Helper to initialize AI
  let ai: GoogleGenAI | null = null;
  function getAI() {
    if (!ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is required');
      ai = new GoogleGenAI({ apiKey });
    }
    return ai;
  }

  // API Route for querying the assistant
  app.post('/api/query', async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }

      const client = getAI();

      const systemPrompt = `You are a highly professional Personal Data Protection Act (PDPC) legal assistant in Taiwan.
Your goal is to help users understand how the PDPC applies to their real-world scenarios or questions.

CRITICAL INSTRUCTION: You MUST strictly use the following JSON data, which contains PDPC articles and official interpretations (函釋), to answer the user's query.

JSON DATA:
${JSON.stringify(pdpcData)}

Response Requirements:
1. Understand the core intent behind the user's natural language query.
2. Locate the most relevant PDPC articles and their corresponding interpretations from the provided JSON data.
3. Explain how the regulations apply to the user's scenario in a clear, accessible, and structured manner.
4. Do NOT output raw JSON data. Write in a professional, empathetic, and structured format using Markdown.
5. ALWAYS explicitly cite the relevant article number (e.g., "第15條") and the specific interpretation reference number (e.g., "函釋字號：個資籌法字第1140002172號") that you base your answer on.
6. If the JSON data does not contain an interpretation that fits the scenario, clearly state that the provided interpretations do not directly cover the specific scenario, but provide the closest applicable principle if one exists in the data. Do NOT invent laws or use outside knowledge to invent an interpretation.`;

      let retryCount = 0;
      let lastError;
      
      while (retryCount < 3) {
        try {
          const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: query,
            config: {
              systemInstruction: systemPrompt,
            }
          });
          return res.json({ text: response.text });
        } catch (error: any) {
          lastError = error;
          if (error.status === 503 || error.message?.includes('high demand') || error.message?.includes('UNAVAILABLE')) {
            retryCount++;
            console.log(`Model is experiencing high demand (503). Retrying ${retryCount}/3 after a short delay...`);
            await new Promise(r => setTimeout(r, 2000 * retryCount));
          } else {
            throw error;
          }
        }
      }
      
      throw lastError;

    } catch (error: any) {
      console.error('Error generating AI response:', error);
      res.status(500).json({ error: error.message || 'An error occurred while generating the response' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
