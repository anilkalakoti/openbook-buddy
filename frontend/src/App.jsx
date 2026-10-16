import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

export default function App() {
  const [sessionId] = useState('session_' + Math.random().toString(36).substring(2, 9));
  const [documents, setDocuments] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedDocFilter, setSelectedDocFilter] = useState('');

  const fetchDocuments = async () => {
    try {
      const res = await axios.get(`${API_BASE}/documents?sessionId=${sessionId}`);
      setDocuments(res.data.documents);
    } catch (err) {
      console.error('Error fetching docs:', err);
    }
  };

  useEffect(() => { fetchDocuments(); }, []);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFiles || selectedFiles.length === 0) return;

    const formData = new FormData();
    formData.append('sessionId', sessionId);
    for (let i = 0; i < selectedFiles.length; i++) {
      formData.append('files', selectedFiles[i]);
    }

    setUploading(true);
    try {
      await axios.post(`${API_BASE}/documents/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSelectedFiles(null);
      fetchDocuments();
      alert('Documents successfully vectorized and initialized!');
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!confirm('Are you sure you want to remove this document?')) return;
    try {
      await axios.delete(`${API_BASE}/documents/${docId}`);
      fetchDocuments();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleDownloadDoc = (docId) => {
    window.open(`${API_BASE}/documents/${docId}/download`, '_blank');
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || loadingChat) return;

    const userMsg = inputMessage;
    setInputMessage('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);

    setLoadingChat(true);
    try {
      const res = await axios.post(`${API_BASE}/chat`, {
        sessionId,
        message: userMsg,
        targetDocIds: selectedDocFilter ? [selectedDocFilter] : [],
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error communicating with server.' }]);
    } finally {
      setLoadingChat(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif', backgroundColor: '#f4f7f6' }}>
      <div style={{ width: '320px', backgroundColor: '#ffffff', borderRight: '1px solid #ddd', padding: '20px', display: 'flex', flexDirection: 'column' }}>
        <h2>Workspace Files</h2>
        <p style={{ fontSize: '11px', color: '#666' }}>Session: {sessionId}</p>

        <form onSubmit={handleUpload} style={{ marginTop: '15px', marginBottom: '20px' }}>
          <input type="file" multiple onChange={(e) => setSelectedFiles(e.target.files)} style={{ marginBottom: '10px', width: '100%' }} />
          <button type="submit" disabled={uploading} style={{ width: '100%', padding: '10px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {uploading ? 'Vectorizing (Qwen3)...' : 'Upload & Initialize'}
          </button>
        </form>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <h3>Active Docs ({documents.length})</h3>
          {documents.length === 0 ? (
            <p style={{ color: '#888', fontSize: '13px' }}>No documents in workspace.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {documents.map((doc) => (
                <li key={doc.docId} style={{ padding: '8px', marginBottom: '8px', backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '4px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{doc.fileName}</div>
                  <div style={{ marginTop: '5px', display: 'flex', gap: '5px' }}>
                    <button onClick={() => handleDownloadDoc(doc.docId)} style={{ fontSize: '10px', padding: '3px 6px', cursor: 'pointer' }}>Download</button>
                    <button onClick={() => handleDeleteDoc(doc.docId)} style={{ fontSize: '10px', padding: '3px 6px', backgroundColor: '#dc3545', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginTop: '15px' }}>
          <label style={{ fontSize: '11px', fontWeight: 'bold' }}>Filter Query by Document:</label>
          <select value={selectedDocFilter} onChange={(e) => setSelectedDocFilter(e.target.value)} style={{ width: '100%', padding: '6px', marginTop: '5px' }}>
            <option value="">All Session Documents</option>
            {documents.map((doc) => (
              <option key={doc.docId} value={doc.docId}>{doc.fileName}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid #ddd' }}>
          <h2>Dynamic RAG Chatbot (OpenAI + Local Qwen3 Embeddings)</h2>
        </div>

        <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#aaa', marginTop: '50px' }}>
              <p>Initialize your session by uploading files on the left sidebar, then chat with your docs!</p>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div key={index} style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                backgroundColor: msg.role === 'user' ? '#007bff' : '#f1f0f0',
                color: msg.role === 'user' ? '#fff' : '#000',
                padding: '12px 16px', borderRadius: '8px', maxWidth: '70%', wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            ))
          )}
          {loadingChat && <div style={{ color: '#666', fontStyle: 'italic' }}>Querying context vector base...</div>}
        </div>

        <form onSubmit={handleSendMessage} style={{ padding: '20px', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
          <input type="text" value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} placeholder="Ask anything about your documents..." style={{ flex: 1, padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }} />
          <button type="submit" style={{ padding: '12px 20px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Send</button>
        </form>
      </div>
    </div>
  );
}