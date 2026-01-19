// ============================================================================
// LIGHT ASSISTANT - FRONTEND
// Fixed: Text input, streaming, error handling
// Enhanced: Proper error logging and debugging
// ============================================================================

console.log('[INIT] Light Assistant Loading...');

// ============================================
// DOM ELEMENTS
// ============================================
const $ = (id) => document.getElementById(id);

const elements = {
  // Input
  textInput: $('textInput'),
  
  // Output
  assistantOutput: $('assistantOutput'),
  
  // Controls
  btnPushToTalk: $('btnPushToTalk'),
  btnWakeWord: $('btnWakeWord'),
  btnClearHistory: $('btnClearHistory'),
  wakeWordText: $('wakeWordText'),
  
  // Status
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  
  // Waveform
  waveform: $('waveform'),
  waveformOverlay: $('waveformOverlay')
};

// ============================================
// STATE
// ============================================
const state = {
  isRecording: false,
  isSpeaking: false,
  wakeWordActive: false,
  currentStream: null,
  wakeRecognition: null
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
    this.targetAmplitude = active ? 20 : 2;
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
  
  // Show/hide waveform based on activity
  if (type === 'recording' || type === 'processing') {
    elements.waveformOverlay.classList.remove('hidden');
    waveform.setActive(true);
  } else {
    elements.waveformOverlay.classList.add('hidden');
    waveform.setActive(false);
  }
}

function showUserInput(text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-bubble user-message';
  messageDiv.textContent = text;
  elements.assistantOutput.appendChild(messageDiv);
  elements.assistantOutput.scrollTop = elements.assistantOutput.scrollHeight;
}

function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'message-bubble assistant-message';
  errorDiv.innerHTML = `<p style="color: #c62828;">${message}</p>`;
  elements.assistantOutput.appendChild(errorDiv);
  elements.assistantOutput.scrollTop = elements.assistantOutput.scrollHeight;
  console.error('[ERROR]', message);
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
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
          console.log('[VOICE] Final transcript:', transcript);
        } else {
          interim += transcript;
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
// CHAT API
// ============================================
async function sendMessage(message) {
  if (!message || !message.trim()) {
    console.error('[CHAT] Empty message received');
    return;
  }
  
  console.log('[CHAT] Sending message:', message);
  
  setStatus('processing', 'Thinking...');
  
  try {
    console.log('[CHAT] Calling /chat endpoint...');
    
    const response = await fetch('/chat', {
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
              elements.assistantOutput.scrollTop = elements.assistantOutput.scrollHeight;
            }
            
            if (data.done) {
              console.log(`[CHAT] Stream complete. ${chunkCount} chunks, ${fullResponse.length} chars`);
              setStatus('', 'Ready');
              
              if (fullResponse && window.speechSynthesis) {
                speakText(fullResponse);
              }
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
    setStatus('', 'Ready');
  }
}

// ============================================
// TEXT TO SPEECH
// ============================================
function speakText(text) {
  // if (!text || !window.speechSynthesis) {
  //   console.warn('[TTS] Text-to-speech not available');
  //   return;
  // }
  
  // console.log('[TTS] Speaking...');
  
  // speechSynthesis.cancel();
  
  // const utterance = new SpeechSynthesisUtterance(text);
  // utterance.rate = 1.1;
  // utterance.pitch = 1.0;
  // utterance.volume = 1.0;
  
  // utterance.onstart = () => {
  //   state.isSpeaking = true;
  // };
  
  // utterance.onend = () => {
  //   state.isSpeaking = false;
  // };
  
  // utterance.onerror = () => {
  //   state.isSpeaking = false;
  // };
  
  // speechSynthesis.speak(utterance);
}

// ============================================
// WAKE WORD
// ============================================
function initWakeWord() {
  console.log('[WAKE] Initializing wake word detection...');
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[WAKE] Speech recognition not supported');
    return;
  }
  
  state.wakeRecognition = new SpeechRecognition();
  state.wakeRecognition.continuous = true;
  state.wakeRecognition.interimResults = true;
  state.wakeRecognition.lang = 'en-US';
  
  state.wakeRecognition.onresult = async (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase();
      
      if (state.wakeWordActive && 
          (transcript.includes('hey light') || transcript.includes('hey lite')) &&
          !state.isRecording && !state.isSpeaking) {
        
        console.log('[WAKE] Wake word detected');
        
        try {
          state.isRecording = true;
          elements.btnPushToTalk.classList.add('recording');
          setStatus('recording', 'Listening...');
          
          const text = await recordVoice();
          
          if (text) {
            showUserInput(text);
            await sendMessage(text);
          }
        } catch (err) {
          console.error('[WAKE] Error:', err);
          showError(err.message);
        } finally {
          state.isRecording = false;
          elements.btnPushToTalk.classList.remove('recording');
          setStatus('', 'Ready');
        }
      }
    }
  };
  
  state.wakeRecognition.onerror = (event) => {
    console.warn('[WAKE] Error:', event.error);
  };
  
  state.wakeRecognition.onend = () => {
    if (state.wakeWordActive) {
      console.log('[WAKE] Recognition ended, restarting...');
      setTimeout(() => {
        try {
          state.wakeRecognition.start();
        } catch (e) {
          console.error('[WAKE] Restart failed:', e);
        }
      }, 500);
    }
  };
  
  console.log('[WAKE] Wake word detection initialized');
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

// Wake Word Toggle
elements.btnWakeWord.addEventListener('click', () => {
  if (!state.wakeRecognition) {
    console.error('[WAKE] Wake word not supported');
    alert('Wake word not supported in your browser');
    return;
  }
  
  state.wakeWordActive = !state.wakeWordActive;
  console.log('[WAKE] Toggle clicked, now:', state.wakeWordActive);
  
  if (state.wakeWordActive) {
    elements.wakeWordText.textContent = 'Wake ON';
    elements.btnWakeWord.classList.add('active');
    
    try {
      state.wakeRecognition.start();
      console.log('[WAKE] Started');
    } catch (e) {
      console.log('[WAKE] Already started');
    }
  } else {
    elements.wakeWordText.textContent = 'Wake Word';
    elements.btnWakeWord.classList.remove('active');
    
    state.wakeRecognition.stop();
    console.log('[WAKE] Stopped');
  }
});

// Clear History
elements.btnClearHistory.addEventListener('click', async () => {
  if (!confirm('Clear conversation history?')) {
    return;
  }
  
  console.log('[HISTORY] Clearing conversation...');
  
  try {
    const response = await fetch('/clear_history', {
      method: 'POST'
    });
    
    if (response.ok) {
      elements.assistantOutput.innerHTML = `
        <div class="welcome-message">
          <p>Conversation cleared!</p>
          <p class="welcome-sub">Start a new conversation.</p>
        </div>
      `;
      console.log('[HISTORY] History cleared successfully');
    } else {
      throw new Error('Failed to clear history');
    }
  } catch (err) {
    console.error('[HISTORY] Error:', err);
    showError('Failed to clear history');
  }
});

// ============================================
// INITIALIZATION
// ============================================
console.log('[INIT] Setting up event handlers...');
initWakeWord();
setStatus('', 'Ready');

console.log('[INIT] Light Assistant Ready');
console.log('[INIT] Try typing a message or clicking Push to Talk!');

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