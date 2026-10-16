const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');
const { ChromaClient } = require('chromadb');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 5000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b';
const CHROMA_HOST = process.env.CHROMA_HOST || 'chromadb';
const CHROMA_PORT = process.env.CHROMA_PORT || '8000';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const chromaClient = new ChromaClient({ path: `http://${CHROMA_HOST}:${CHROMA_PORT}` });

let collectionInstance = null;

async function getOrCreateCollection() {
  if (!collectionInstance) {
    collectionInstance = await chromaClient.getOrCreateCollection({
      name: "dynamic_rag_docs",
      metadata: { "description": "Dynamic user workspace documents" }
    });
  }
  return collectionInstance;
}

// Function to fetch embeddings from Ollama API
async function fetchEmbeddings(texts) {
  try {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/embed`, {
      model: EMBEDDING_MODEL,
      input: texts
    });
    // Ollama's /api/embed returns { embeddings: [[...], [...]] }
    return response.data.embeddings;
  } catch (error) {
    console.error('Ollama Embedding Error:', error.response?.data || error.message);
    throw new Error('Failed to generate embeddings from Ollama service.');
  }
}

// Upload & Initialize / Add Documents
app.post('/api/documents/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files;
    const sessionId = req.body.sessionId || 'default_session';

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const collection = await getOrCreateCollection();
    const uploadedDocs = [];

    for (const file of files) {
      const docId = uuidv4();
      let textContent = '';

      if (file.mimetype === 'application/pdf') {
        const parsedPdf = await pdfParse(file.buffer);
        textContent = parsedPdf.text;
      } else {
        textContent = file.buffer.toString('utf-8');
      }

      const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
      const chunks = await splitter.splitText(textContent);

      if (chunks.length === 0) continue;

      const embeddings = await fetchEmbeddings(chunks);

      const ids = chunks.map(() => uuidv4());
      const metadatas = chunks.map(() => ({ sessionId, docId, fileName: file.originalname }));

      await collection.add({ ids, embeddings, documents: chunks, metadatas });
      uploadedDocs.push({ docId, fileName: file.originalname, chunksCount: chunks.length });
    }

    res.json({ message: 'Documents indexed successfully via Ollama!', documents: uploadedDocs });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List session documents
app.get('/api/documents', async (req, res) => {
  try {
    const sessionId = req.query.sessionId || 'default_session';
    const collection = await getOrCreateCollection();
    const results = await collection.get({ where: { sessionId: sessionId } });

    const docMap = new Map();
    if (results && results.metadatas) {
      results.metadatas.forEach((meta) => {
        if (meta && meta.docId && !docMap.has(meta.docId)) {
          docMap.set(meta.docId, { docId: meta.docId, fileName: meta.fileName });
        }
      });
    }

    res.json({ documents: Array.from(docMap.values()) });
  } catch (error) {
    console.error('List Docs Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove document
app.delete('/api/documents/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    const collection = await getOrCreateCollection();
    await collection.delete({ where: { docId: docId } });
    res.json({ message: `Document ${docId} deleted successfully.` });
  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download document content
app.get('/api/documents/:docId/download', async (req, res) => {
  try {
    const { docId } = req.params;
    const collection = await getOrCreateCollection();
    const results = await collection.get({ where: { docId: docId } });

    if (!results || !results.documents || results.documents.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const fileName = results.metadatas[0]?.fileName || 'document.txt';
    const fullText = results.documents.join('\n\n');

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'text/plain');
    res.send(fullText);
  } catch (error) {
    console.error('Download Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// RAG Chat Endpoint
app.post('/api/chat-openai', async (req, res) => {
  try {
    const { sessionId, message, targetDocIds } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const collection = await getOrCreateCollection();
    const queryEmbeddings = await fetchEmbeddings([message]);
    const queryVector = queryEmbeddings[0];

    const searchResults = await collection.query({
      queryEmbeddings: [queryVector],
      nResults: 4,
      where: sessionId ? { sessionId: sessionId } : undefined,
    });

    let retrievedChunks = searchResults.documents[0] || [];
    let retrievedMetadatas = searchResults.metadatas[0] || [];

    if (targetDocIds && targetDocIds.length > 0) {
      const filteredChunks = [];
      for (let i = 0; i < retrievedChunks.length; i++) {
        if (targetDocIds.includes(retrievedMetadatas[i]?.docId)) {
          filteredChunks.push(retrievedChunks[i]);
        }
      }
      if (filteredChunks.length > 0) retrievedChunks = filteredChunks;
    }

    const contextText = retrievedChunks.join('\n\n---CHUNK---\n\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant. Answer user queries strictly using the provided context chunks. If unknown, state you do not know.' },
        { role: 'user', content: `Context:\n${contextText}\n\nQuestion:\n${message}` }
      ]
    });

    res.json({ reply: completion.choices[0].message.content, sources: retrievedMetadatas });
  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Local RAG Chat Endpoint using Ollama instead of OpenAI
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message, targetDocIds } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const collection = await getOrCreateCollection();
    const queryEmbeddings = await fetchEmbeddings([message]); // Uses Qwen3 embedding via Ollama
    const queryVector = queryEmbeddings[0];

    const searchResults = await collection.query({
      queryEmbeddings: [queryVector],
      nResults: 4,
      where: sessionId ? { sessionId: sessionId } : undefined,
    });

    let retrievedChunks = searchResults.documents[0] || [];
    let retrievedMetadatas = searchResults.metadatas[0] || [];

    if (targetDocIds && targetDocIds.length > 0) {
      const filteredChunks = [];
      for (let i = 0; i < retrievedChunks.length; i++) {
        if (targetDocIds.includes(retrievedMetadatas[i]?.docId)) {
          filteredChunks.push(retrievedChunks[i]);
        }
      }
      if (filteredChunks.length > 0) retrievedChunks = filteredChunks;
    }

    const contextText = retrievedChunks.join('\n\n---CHUNK---\n\n');

    // Call Local Ollama Chat Model (e.g., qwen2.5:3b)
    const chatResponse = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
      model: process.env.CHAT_MODEL || 'qwen2.5:3b',
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant. Answer user queries strictly using the provided context chunks. If unknown, state you do not know.' },
        { role: 'user', content: `Context:\n${contextText}\n\nQuestion:\n${message}` }
      ],
      stream: false
    });

    res.json({ reply: chatResponse.data.message.content, sources: retrievedMetadatas });
  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));