// ============================================================================
// LIGHT ASSISTANT - FRONTEND
// ============================================================================

console.log('[INIT] Light Assistant Loading...');

// ============================================
// DOM ELEMENTS
// ============================================
const $ = (id) => document.getElementById(id);

const elements = {
  textInput: $('textInput'),
  assistantOutput: $('assistantOutput'),
  btnPushToTalk: $('btnPushToTalk'),
  btnNewChat: $('btnNewChat'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  waveform: $('waveform'),
  waveformContainer: $('waveformContainer'),
  conversationsList: $('conversationsList'),
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  mainArea: $('mainArea')
};

// ============================================
// STATE
// ============================================
const state = {
  isRecording: false,
  isSpeaking: false,
  currentConversation: null,
  isStreaming: false,
  conversations: []
};

// ============================================
// WAVEFORM
// ============================================
class Waveform {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.phase = 0;
    this.amplitude = 2;
    this.targetAmplitude = 2;
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
    console.log('[WAVEFORM] Initialized');
  }
  
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }
  
  setActive(active) {
    this.targetAmplitude = active ? 15 : 2;
    if (active) {
      elements.waveformContainer.classList.add('active');
    } else {
      elements.waveformContainer.classList.remove('active');
    }
  }
  
  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.amplitude += (this.targetAmplitude - this.amplitude) * 0.1;
    
    const centerY = this.height / 2;
    
    for (let w = 0; w < 3; w++) {
      this.ctx.beginPath();
      for (let x = 0; x <= this.width; x += 2) {
        const y = centerY + 
          Math.sin((x * 0.02) + this.phase + (w * 0.5)) * this.amplitude;
        x === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y);
      }
      
      const gradient = this.ctx.createLinearGradient(0, 0, this.width, 0);
      gradient.addColorStop(0, 'rgba(139, 90, 43, 0.3)');
      gradient.addColorStop(0.5, 'rgba(139, 90, 43, 0.8)');
      gradient.addColorStop(1, 'rgba(139, 90, 43, 0.3)');
      
      this.ctx.strokeStyle = gradient;
      this.ctx.lineWidth = 2 - (w * 0.3);
      this.ctx.stroke();
    }
    
    this.phase += this.targetAmplitude > 10 ? 0.1 : 0.02;
    requestAnimationFrame(() => this.animate());
  }
}

const waveform = new Waveform(elements.waveform);

// ============================================
// STATUS
// ============================================
function setStatus(type, message) {
  elements.statusDot.className = `status-dot ${type}`;
  elements.statusText.textContent = message;
  
  if (type === 'recording' || type === 'processing') {
    waveform.setActive(true);
  } else {
    waveform.setActive(false);
  }
}

function showUserInput(text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-bubble user-message';
  messageDiv.textContent = text;
  elements.assistantOutput.appendChild(messageDiv);
  hideWelcome();
  scrollToBottom();
}

function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'message-bubble assistant-message';
  errorDiv.innerHTML = `<p style="color: #c62828;">${message}</p>`;
  elements.assistantOutput.appendChild(errorDiv);
  hideWelcome();
  scrollToBottom();
  console.error('[ERROR]', message);
}

function hideWelcome() {
  const welcome = elements.assistantOutput.querySelector('.welcome-message');
  if (welcome) {
    welcome.style.display = 'none';
  }
}

function scrollToBottom() {
  elements.assistantOutput.scrollTop = elements.assistantOutput.scrollHeight;
}

// ============================================
// SPEECH RECOGNITION
// ============================================
async function recordVoice(duration = 6000) {
  return new Promise((resolve, reject) => {
    console.log('[VOICE] Starting speech recognition...');
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      const error = 'Speech recognition not supported in this browser';
      console.error('[VOICE]', error);
      reject(new Error(error));
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    
    let finalTranscript = '';
    let timeout;
    
    recognition.onstart = () => {
      console.log('[VOICE] Recording started');
      timeout = setTimeout(() => {
        console.log('[VOICE] Timeout reached, stopping...');
        recognition.stop();
      }, duration);
    };
    
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
          console.log('[VOICE] Final transcript:', transcript);
        }
      }
    };
    
    recognition.onerror = (event) => {
      clearTimeout(timeout);
      console.error('[VOICE] Error:', event.error);
      if (event.error === 'no-speech') {
        reject(new Error('No speech detected'));
      } else {
        reject(new Error(`Speech error: ${event.error}`));
      }
    };
    
    recognition.onend = () => {
      clearTimeout(timeout);
      console.log('[VOICE] Recording ended. Transcript:', finalTranscript.trim());
      resolve(finalTranscript.trim());
    };
    
    try {
      recognition.start();
    } catch (e) {
      console.error('[VOICE] Failed to start:', e);
      reject(e);
    }
  });
}

// ============================================
// CONVERSATION MANAGEMENT
// ============================================
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    state.conversations = data.conversations;
    
    console.log('[CONV] Loaded', state.conversations.length, 'conversations');
    
    renderConversationsList();
  } catch (err) {
    console.error('[CONV] Failed to load conversations:', err);
  }
}

function renderConversationsList() {
  if (state.conversations.length === 0) {
    elements.conversationsList.innerHTML = `
      <div class="conversations-loading">No conversations yet</div>
    `;
    return;
  }
  
  elements.conversationsList.innerHTML = '';
  
  state.conversations.forEach(conv => {
    const div = document.createElement('div');
    div.className = `conversation-item ${conv.is_active ? 'active' : ''}`;
    div.innerHTML = `
      <div class="conversation-title">${conv.title}</div>
      <button class="delete-conv-btn" onclick="deleteConversation(event, '${conv.id}')">×</button>
    `;
    
    div.onclick = (e) => {
      if (!e.target.classList.contains('delete-conv-btn')) {
        activateConversation(conv.id);
      }
    };
    
    elements.conversationsList.appendChild(div);
  });
}

async function loadActiveConversation() {
  try {
    const res = await fetch('/api/conversations/active');
    state.currentConversation = await res.json();
    
    console.log('[CONV] Loaded conversation:', state.currentConversation.id);
    
    // Render existing messages
    if (state.currentConversation.messages && state.currentConversation.messages.length > 0) {
      renderMessages(state.currentConversation.messages);
    }
  } catch (err) {
    console.error('[CONV] Failed to load conversation:', err);
  }
}

function renderMessages(messages) {
  // Clear output except welcome message
  const welcome = elements.assistantOutput.querySelector('.welcome-message');
  elements.assistantOutput.innerHTML = '';
  
  if (messages.length === 0) {
    if (welcome) {
      elements.assistantOutput.appendChild(welcome);
    }
    return;
  }
  
  // Render all messages
  messages.forEach(msg => {
    if (msg.role === 'user') {
      const div = document.createElement('div');
      div.className = 'message-bubble user-message';
      div.textContent = msg.content;
      elements.assistantOutput.appendChild(div);
    } else if (msg.role === 'assistant') {
      const div = document.createElement('div');
      div.className = 'message-bubble assistant-message';
      div.innerHTML = marked.parse(msg.content);
      elements.assistantOutput.appendChild(div);
    }
  });
  
  scrollToBottom();
}

async function createNewChat() {
  try {
    console.log('[CONV] Creating new conversation...');
    const res = await fetch('/api/conversations/new', { method: 'POST' });
    state.currentConversation = await res.json();
    
    // Clear UI
    elements.assistantOutput.innerHTML = `
      <div class="welcome-message">
        <p>Hello! I'm Light, your assistant.</p>
        <p class="welcome-sub">Ask me anything to get started.</p>
      </div>
    `;
    
    // Reload conversations list
    await loadConversations();
    
    console.log('[CONV] New conversation created:', state.currentConversation.id);
  } catch (err) {
    console.error('[CONV] Failed to create conversation:', err);
    showError('Failed to create new conversation');
  }
}

async function activateConversation(convId) {
  try {
    console.log('[CONV] Activating conversation:', convId);
    const res = await fetch(`/api/conversations/${convId}/activate`, { method: 'POST' });
    state.currentConversation = await res.json();
    
    // Render messages
    renderMessages(state.currentConversation.messages);
    
    // Update list
    renderConversationsList();
    
    console.log('[CONV] Conversation activated');
  } catch (err) {
    console.error('[CONV] Failed to activate conversation:', err);
    showError('Failed to load conversation');
  }
}

async function deleteConversation(event, convId) {
  event.stopPropagation();
  
  if (!confirm('Delete this conversation?')) {
    return;
  }
  
  try {
    console.log('[CONV] Deleting conversation:', convId);
    await fetch(`/api/conversations/${convId}`, { method: 'DELETE' });
    
    // Reload conversations and active conversation
    await loadConversations();
    await loadActiveConversation();
    
    console.log('[CONV] Conversation deleted');
  } catch (err) {
    console.error('[CONV] Failed to delete conversation:', err);
    showError('Failed to delete conversation');
  }
}

// ============================================
// CHAT API
// ============================================
async function sendMessage(message) {
  if (!message || !message.trim()) {
    console.error('[CHAT] Empty message received');
    return;
  }
  
  if (state.isStreaming) {
    console.warn('[CHAT] Already streaming, ignoring');
    return;
  }
  
  console.log('[CHAT] Sending message:', message);
  
  setStatus('processing', 'Thinking...');
  state.isStreaming = true;
  
  try {
    console.log('[CHAT] Calling /api/chat endpoint...');
    
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: message.trim() })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    console.log('[CHAT] Response received, starting stream...');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble assistant-message';
    elements.assistantOutput.appendChild(messageDiv);
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let chunkCount = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[CHAT] Stream ended');
        break;
      }
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.error) {
              console.error('[CHAT] Server error:', data.error);
              showError(data.error);
              break;
            }
            
            if (data.content) {
              chunkCount++;
              fullResponse += data.content;
              messageDiv.innerHTML = marked.parse(fullResponse);
              scrollToBottom();
            }
            
            if (data.done) {
              console.log(`[CHAT] Stream complete. ${chunkCount} chunks, ${fullResponse.length} chars`);
              setStatus('', 'Ready');
              
              // Reload conversations list to update title
              loadConversations();
            }
          } catch (e) {
            console.error('[CHAT] Parse error:', e);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('[CHAT] Error:', error);
    showError(error.message);
  } finally {
    state.isStreaming = false;
    setStatus('', 'Ready');
  }
}

// ============================================
// EVENT HANDLERS
// ============================================

// Push to Talk
elements.btnPushToTalk.addEventListener('click', async () => {
  if (state.isRecording || state.isSpeaking) return;
  
  console.log('[PTT] Button clicked');
  
  try {
    state.isRecording = true;
    elements.btnPushToTalk.classList.add('recording');
    setStatus('recording', 'Listening...');
    
    const text = await recordVoice();
    
    if (text) {
      showUserInput(text);
      await sendMessage(text);
    } else {
      showError('No speech detected');
    }
  } catch (err) {
    console.error('[PTT] Error:', err);
    showError(err.message);
  } finally {
    state.isRecording = false;
    elements.btnPushToTalk.classList.remove('recording');
    setStatus('', 'Ready');
  }
});

// Text Input
elements.textInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = elements.textInput.value.trim();
    
    if (!text) {
      console.warn('[TEXT] Empty input');
      return;
    }
    
    console.log('[TEXT] Submit:', text);
    
    elements.textInput.value = '';
    
    showUserInput(text);
    await sendMessage(text);
  }
});

// New Chat
elements.btnNewChat.addEventListener('click', createNewChat);

// Sidebar Toggle
elements.sidebarToggle.addEventListener('click', () => {
  elements.sidebar.classList.toggle('collapsed');
  console.log('[UI] Sidebar toggled');
});

// ============================================
// INITIALIZATION
// ============================================
console.log('[INIT] Setting up...');
loadConversations();
loadActiveConversation();
setStatus('', 'Ready');

console.log('[INIT] Light Assistant Ready');

// Health check
console.log('[HEALTH] Checking server status...');
fetch('/health')
  .then(r => r.json())
  .then(data => {
    console.log('[HEALTH] Server status:', data);
    if (data.ollama === 'offline') {
      console.error('[HEALTH] Ollama is offline!');
      showError('Ollama is not running. Start it with: ollama serve');
    } else {
      console.log('[HEALTH] All systems operational');
    }
  })
  .catch(err => {
    console.error('[HEALTH] Health check failed:', err);
    showError('Cannot connect to server');
  });